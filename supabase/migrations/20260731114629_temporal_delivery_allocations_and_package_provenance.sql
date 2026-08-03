-- Keep the human description of a whole-camp manual order distinct from the
-- machine-calculated quantity assigned to one dated delivery.
alter table public.supply_list_items
  add column order_package_note text,
  add column supplier_order_synthetic_fixture boolean not null default false;

alter table public.supply_list_items
  add constraint supply_list_items_order_package_note_source
  check (
    order_source_kind in ('manual_purchase', 'supplier_purchase')
    or order_package_note is null
  ),
  add constraint supply_list_items_supplier_order_fixture_source
  check (
    not supplier_order_synthetic_fixture
    or order_source_kind = 'supplier_purchase'
  );

create function public.clear_order_package_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_source_kind not in ('manual_purchase', 'supplier_purchase') then
    new.order_package_note := null;
  end if;
  if new.order_source_kind is distinct from 'supplier_purchase' then
    new.supplier_order_synthetic_fixture := false;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_order_package_note()
  from public, anon, authenticated;

create trigger supply_list_items_clear_order_package_note
before insert or update on public.supply_list_items
for each row execute function public.clear_order_package_note();

-- Production catalogue rows remain public-webshop records.  Local acceptance
-- may use only the explicit synthetic ICA fixture marker; an arbitrary import
-- or generic demo supplier must never become a trusted ICA product.
create function public.ica_supplier_product_has_allowed_provenance(
  p_source_metadata jsonb,
  p_store_id text
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    p_source_metadata @> jsonb_build_object(
      'source', 'ica_public_webshop',
      'store_id', p_store_id
    )
    or p_source_metadata @> jsonb_build_object(
      'source', 'ica_local_fixture',
      'store_id', p_store_id,
      'synthetic_local_fixture', true
    );
$$;

revoke all on function public.ica_supplier_product_has_allowed_provenance(
  jsonb, text
) from public, anon, authenticated;

create or replace function public.enforce_ica_supplier_product_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  supplier_provider_key text;
  supplier_location_id text;
begin
  select account.provider_key, account.provider_location_id
  into supplier_provider_key, supplier_location_id
  from public.supplier_accounts as account
  where account.organization_id = new.organization_id
    and account.id = new.supplier_account_id;

  if supplier_provider_key = 'ica'
    and new.active
    and (
      new.product_data_source <> 'import:api'
      or not coalesce(public.ica_supplier_product_has_allowed_provenance(
        new.source_metadata,
        supplier_location_id
      ), false)
    ) then
    raise exception
      'ICA supplier products must come from the configured store catalogue'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_ica_supplier_product_provenance()
  from public, anon, authenticated;

-- Keep the old functions only as migration history.  They use a global
-- largest-remainder split and are unsafe once a dated manual override exists.
alter function public.sync_manual_purchase_delivery_allocations(uuid, uuid, text)
  rename to sync_manual_purchase_delivery_allocations_proportional_legacy;

revoke all on function
  public.sync_manual_purchase_delivery_allocations_proportional_legacy(
    uuid, uuid, text
  ) from public, anon, authenticated;

-- Both manual and verified-supplier orders use this same dated row stream.
-- Each JSON row contains a requirement in the order's unit, plus either a
-- fixed override or an automatic slot.  Automatic stock is placed early
-- enough to cover every cumulative need.  Any genuine surplus is assigned to
-- the final automatic slot; fixed overrides are returned unchanged.
create function public.temporal_delivery_allocation_plan(
  p_total_amount numeric,
  p_allocation_scale integer,
  p_rows jsonb
)
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $$
  with input_rows as (
    select
      row_data.item_id,
      row_data.allocation_position,
      row_data.required_amount,
      row_data.override_amount,
      row_data.is_automatic
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row_data(
      item_id uuid,
      allocation_position integer,
      required_amount numeric,
      override_amount numeric,
      is_automatic boolean
    )
  ),
  parameters as (
    select
      power(10::numeric, p_allocation_scale) as quantum_factor,
      p_total_amount * power(10::numeric, p_allocation_scale)
        as total_quanta
  ),
  row_metrics as (
    select
      input_rows.*,
      parameters.quantum_factor,
      parameters.total_quanta,
      count(*) filter (where input_rows.is_automatic) over (
        order by input_rows.allocation_position
        rows between unbounded preceding and current row
      )::integer as automatic_group,
      count(*) filter (where input_rows.is_automatic) over ()::integer
        as automatic_count,
      sum(input_rows.required_amount) over (
        order by input_rows.allocation_position
        rows between unbounded preceding and current row
      ) as cumulative_required_amount,
      sum(
        case when input_rows.is_automatic then 0
          else input_rows.override_amount * parameters.quantum_factor end
      ) over (
        order by input_rows.allocation_position
        rows between unbounded preceding and current row
      ) as cumulative_override_quanta,
      sum(
        case when input_rows.is_automatic then 0
          else input_rows.override_amount * parameters.quantum_factor end
      ) over () as total_override_quanta
    from input_rows
    cross join parameters
  ),
  row_requirements as (
    select
      row_metrics.*,
      max(greatest(
        ceil(
          row_metrics.cumulative_required_amount
            * row_metrics.quantum_factor
        ) - row_metrics.cumulative_override_quanta,
        0
      )) over (
        order by row_metrics.allocation_position
        rows between unbounded preceding and current row
      ) as minimum_cumulative_automatic_quanta
    from row_metrics
  ),
  automatic_group_requirements as (
    select
      automatic_group,
      max(automatic_count) as automatic_count,
      max(total_quanta - total_override_quanta) as automatic_budget_quanta,
      max(minimum_cumulative_automatic_quanta)
        as required_cumulative_automatic_quanta
    from row_requirements
    where automatic_group > 0
    group by automatic_group
  ),
  automatic_group_goals as (
    select
      automatic_group,
      case
        when automatic_group = automatic_count then automatic_budget_quanta
        else required_cumulative_automatic_quanta
      end as cumulative_automatic_goal_quanta
    from automatic_group_requirements
  ),
  automatic_allocations as (
    select
      automatic_row.item_id,
      goal.cumulative_automatic_goal_quanta
        - lag(goal.cumulative_automatic_goal_quanta, 1, 0::numeric) over (
            order by goal.automatic_group
          ) as allocated_quanta
    from automatic_group_goals as goal
    join row_requirements as automatic_row
      on automatic_row.automatic_group = goal.automatic_group
     and automatic_row.is_automatic
  ),
  planned_rows as (
    select
      row_requirements.*,
      case
        when row_requirements.is_automatic then automatic.allocated_quanta
        else row_requirements.override_amount * row_requirements.quantum_factor
      end as planned_quanta
    from row_requirements
    left join automatic_allocations as automatic
      on automatic.item_id = row_requirements.item_id
  ),
  cumulative_plan as (
    select
      planned_rows.*,
      sum(planned_rows.planned_quanta) over (
        order by planned_rows.allocation_position
        rows between unbounded preceding and current row
      ) as cumulative_planned_quanta
    from planned_rows
  ),
  input_summary as (
    select
      count(*) as row_count,
      count(distinct item_id) as distinct_item_count,
      count(distinct allocation_position) as distinct_position_count,
      coalesce(bool_and(
        item_id is not null
        and allocation_position is not null
        and required_amount is not null
        and required_amount >= 0
        and is_automatic is not null
        and (
          (is_automatic and override_amount is null)
          or (not is_automatic and override_amount is not null and override_amount >= 0)
        )
      ), false) as rows_are_valid
    from input_rows
  ),
  plan_summary as (
    select
      coalesce(bool_and(
        planned_quanta is not null
        and planned_quanta >= 0
        and planned_quanta = trunc(planned_quanta)
        and cumulative_planned_quanta >= ceil(
          cumulative_required_amount * quantum_factor
        )
      ), false) as rows_are_covered,
      coalesce(sum(planned_quanta), 0) as planned_total_quanta,
      coalesce(max(total_quanta), 0) as total_quanta,
      coalesce(max(total_override_quanta), 0) as total_override_quanta,
      coalesce(max(automatic_count), 0) as automatic_count,
      coalesce(max(quantum_factor), 0) as quantum_factor
    from cumulative_plan
  ),
  validity as (
    select
      input_summary.row_count > 0
      and input_summary.row_count = input_summary.distinct_item_count
      and input_summary.row_count = input_summary.distinct_position_count
      and input_summary.rows_are_valid
      and p_total_amount is not null
      and p_total_amount >= 0
      and p_allocation_scale between 0 and 6
      and plan_summary.quantum_factor > 0
      and plan_summary.total_quanta = trunc(plan_summary.total_quanta)
      and plan_summary.total_override_quanta
        = trunc(plan_summary.total_override_quanta)
      and plan_summary.total_override_quanta <= plan_summary.total_quanta
      and (
        plan_summary.automatic_count > 0
        or plan_summary.total_override_quanta = plan_summary.total_quanta
      )
      and plan_summary.rows_are_covered
      and plan_summary.planned_total_quanta = plan_summary.total_quanta
        as is_viable
    from input_summary
    cross join plan_summary
  )
  select jsonb_build_object(
    'viable', validity.is_viable,
    'allocations', case when validity.is_viable then coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'item_id', planned.item_id,
          'allocated_amount',
            planned.planned_quanta / planned.quantum_factor
        ) order by planned.allocation_position
      )
      from cumulative_plan as planned
      where planned.is_automatic
    ), '[]'::jsonb) else '[]'::jsonb end
  )
  from validity;
$$;

revoke all on function public.temporal_delivery_allocation_plan(
  numeric, integer, jsonb
) from public, anon, authenticated;

create function public.sync_manual_purchase_delivery_allocations(
  p_organization_id uuid,
  p_camp_id uuid,
  p_canonical_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_order record;
  stream_rows jsonb;
  stream_compatible boolean;
  override_total numeric;
  allocation_scale integer;
  allocation_plan jsonb;
  changed_count integer := 0;
  cleared_count integer := 0;
  allocated_count integer := 0;
  unresolved_count integer := 0;
begin
  -- First remove provenance whose exact source order no longer exists.  Valid
  -- rows stay untouched, so an identical sync remains idempotent.
  update public.supply_list_items as delivery_item
  set
    ordered_amount = null,
    ordered_unit = null,
    package_note = null,
    order_package_note = null,
    order_source_kind = null,
    manual_order_source_item_id = null,
    manual_order_total_amount = null,
    manual_order_unit = null,
    row_version = delivery_item.row_version + 1,
    updated_by = (select auth.uid())
  from public.supply_lists as delivery_list
  where delivery_item.organization_id = p_organization_id
    and delivery_item.camp_id = p_camp_id
    and delivery_item.order_source_kind = 'manual_purchase'
    and (p_canonical_key is null or delivery_item.canonical_key = p_canonical_key)
    and delivery_list.id = delivery_item.supply_list_id
    and delivery_list.kind = 'delivery'
    and delivery_list.status <> 'complete'
    and not delivery_item.completed
    and not exists (
      select 1
      from public.supply_list_items as source_item
      join public.supply_lists as source_list
        on source_list.id = source_item.supply_list_id
       and source_list.organization_id = source_item.organization_id
       and source_list.camp_id = source_item.camp_id
      where source_item.id = delivery_item.manual_order_source_item_id
        and source_item.organization_id = delivery_item.organization_id
        and source_item.camp_id = delivery_item.camp_id
        and source_list.kind = 'purchase'
        and source_list.source_present
        and source_item.source_present
        and source_item.order_source_kind = 'manual'
        and source_item.ordered_amount = delivery_item.manual_order_total_amount
        and lower(trim(coalesce(source_item.ordered_unit, '')))
          = lower(trim(delivery_item.manual_order_unit))
        and public.manual_purchase_unit_dimension(source_item.ordered_unit)
          is not null
        and (
          public.manual_purchase_unit_dimension(source_item.ordered_unit) <> 'count'
          or source_item.ordered_amount = trunc(source_item.ordered_amount)
        )
        and not exists (
          select 1
          from public.supplier_accounts as account
          join public.preferred_supplier_matches as preferred
            on preferred.organization_id = source_item.organization_id
           and preferred.canonical_key = source_item.canonical_key
           and preferred.supplier_account_id = account.id
          join public.ingredient_supplier_matches as ingredient_match
            on ingredient_match.organization_id = preferred.organization_id
           and ingredient_match.id = preferred.ingredient_supplier_match_id
           and ingredient_match.approved_by is not null
           and ingredient_match.approved_at is not null
          join public.supplier_products as product
            on product.organization_id = preferred.organization_id
           and product.id = preferred.supplier_product_id
           and product.id = ingredient_match.supplier_product_id
           and product.active
           and product.product_fingerprint
             = ingredient_match.approved_product_fingerprint
          where account.organization_id = source_item.organization_id
            and account.provider_key = 'ica'
            and account.provider_location_id = '1004021'
            and account.active
            and lower(trim(product.purchase_unit))
              = lower(trim(source_item.ordered_unit))
        )
    );
  get diagnostics changed_count = row_count;
  cleared_count := cleared_count + changed_count;

  for source_order in
    select
      source_item.id as source_item_id,
      source_item.canonical_key,
      source_item.ordered_amount as total_amount,
      source_item.ordered_unit as order_unit,
      source_item.package_note as source_package_note,
      public.manual_purchase_unit_dimension(source_item.ordered_unit)
        as unit_dimension,
      public.manual_purchase_unit_family(source_item.ordered_unit)
        as unit_family,
      public.manual_purchase_unit_factor(source_item.ordered_unit)
        as unit_factor,
      source_list.calculation_revision_id
    from public.supply_lists as source_list
    join public.supply_list_items as source_item
      on source_item.supply_list_id = source_list.id
     and source_item.organization_id = source_list.organization_id
     and source_item.camp_id = source_list.camp_id
    join public.calculation_revisions as revision
      on revision.id = source_list.calculation_revision_id
     and revision.organization_id = source_list.organization_id
     and revision.camp_id = source_list.camp_id
     and revision.status = 'current'
    where source_list.organization_id = p_organization_id
      and source_list.camp_id = p_camp_id
      and source_list.kind = 'purchase'
      and source_list.source_present
      and source_item.source_present
      and source_item.order_source_kind = 'manual'
      and source_item.ordered_amount is not null
      and source_item.ordered_amount > 0
      and source_item.ordered_unit is not null
      and public.manual_purchase_unit_dimension(source_item.ordered_unit) is not null
      and (
        public.manual_purchase_unit_dimension(source_item.ordered_unit) <> 'count'
        or source_item.ordered_amount = trunc(source_item.ordered_amount)
      )
      and (p_canonical_key is null or source_item.canonical_key = p_canonical_key)
      and not exists (
        select 1
        from public.supplier_accounts as account
        join public.preferred_supplier_matches as preferred
          on preferred.organization_id = source_item.organization_id
         and preferred.canonical_key = source_item.canonical_key
         and preferred.supplier_account_id = account.id
        join public.ingredient_supplier_matches as ingredient_match
          on ingredient_match.organization_id = preferred.organization_id
         and ingredient_match.id = preferred.ingredient_supplier_match_id
         and ingredient_match.approved_by is not null
         and ingredient_match.approved_at is not null
        join public.supplier_products as product
          on product.organization_id = preferred.organization_id
         and product.id = preferred.supplier_product_id
         and product.id = ingredient_match.supplier_product_id
         and product.active
         and product.product_fingerprint = ingredient_match.approved_product_fingerprint
        where account.organization_id = source_item.organization_id
          and account.provider_key = 'ica'
          and account.provider_location_id = '1004021'
          and account.active
          and lower(trim(product.purchase_unit)) = lower(trim(source_item.ordered_unit))
      )
  loop
    select
      jsonb_agg(
        jsonb_build_object(
          'item_id', dated.item_id,
          'allocation_position', dated.allocation_position,
          'required_amount', dated.required_in_order_unit,
          'override_amount', dated.override_in_order_unit,
          'is_automatic', dated.is_automatic
        ) order by dated.allocation_position
      ),
      coalesce(bool_and(dated.row_is_compatible), false),
      coalesce(sum(dated.override_in_order_unit) filter (
        where not dated.is_automatic
      ), 0)
    into stream_rows, stream_compatible, override_total
    from (
      select
        delivery_item.id as item_id,
        row_number() over (
          order by
            delivery_list.range_start,
            case when delivery_list.status = 'complete'
              or delivery_item.completed
              or delivery_item.order_source_kind = 'manual'
              then 1 else 0 end,
            delivery_item.item_key
        )::integer as allocation_position,
        delivery_item.required_amount
          * public.manual_purchase_unit_factor(delivery_item.required_unit)
          / source_order.unit_factor as required_in_order_unit,
        case when delivery_list.status = 'complete'
          or delivery_item.completed
          or delivery_item.order_source_kind = 'manual' then
          delivery_item.ordered_amount
            * public.manual_purchase_unit_factor(delivery_item.ordered_unit)
            / source_order.unit_factor
          else null
        end as override_in_order_unit,
        case when delivery_list.status = 'complete'
          or delivery_item.completed
          or delivery_item.order_source_kind = 'manual'
          then false else true end as is_automatic,
        delivery_list.range_start is not null
        and public.manual_purchase_unit_dimension(delivery_item.required_unit)
          = source_order.unit_dimension
        and (
          source_order.unit_dimension <> 'count'
          or public.manual_purchase_unit_family(delivery_item.required_unit)
            = source_order.unit_family
        )
        and case
          when delivery_list.status = 'complete'
            or delivery_item.completed
            or delivery_item.order_source_kind = 'manual' then
            delivery_item.ordered_amount is not null
            and delivery_item.ordered_amount >= 0
            and delivery_item.ordered_unit is not null
            and public.manual_purchase_unit_dimension(delivery_item.ordered_unit)
              = source_order.unit_dimension
            and (
              source_order.unit_dimension <> 'count'
              or public.manual_purchase_unit_family(delivery_item.ordered_unit)
                = source_order.unit_family
            )
            and (
              source_order.unit_dimension <> 'count'
              or delivery_item.ordered_amount = trunc(delivery_item.ordered_amount)
            )
          when delivery_item.order_source_kind = 'manual_purchase' then true
          when delivery_item.order_source_kind is null then
            delivery_item.ordered_amount is null
            and delivery_item.ordered_unit is null
            and delivery_item.package_note is null
          else false
        end as row_is_compatible
      from public.supply_lists as delivery_list
      join public.supply_list_items as delivery_item
        on delivery_item.supply_list_id = delivery_list.id
       and delivery_item.organization_id = delivery_list.organization_id
       and delivery_item.camp_id = delivery_list.camp_id
      where delivery_list.organization_id = p_organization_id
        and delivery_list.camp_id = p_camp_id
        and delivery_list.kind = 'delivery'
        and (
          delivery_list.status = 'complete'
          or delivery_item.completed
          or delivery_list.source_present
        )
        and (
          delivery_list.status = 'complete'
          or delivery_item.completed
          or delivery_list.calculation_revision_id
            = source_order.calculation_revision_id
        )
        and delivery_item.canonical_key = source_order.canonical_key
        and (
          delivery_list.status = 'complete'
          or delivery_item.completed
          or delivery_item.source_present
        )
        and delivery_item.required_amount > 0
    ) as dated;

    if stream_rows is not null and stream_compatible then
      allocation_scale := least(6, scale(trim_scale(
        source_order.total_amount - override_total
      )));
      allocation_plan := public.temporal_delivery_allocation_plan(
        source_order.total_amount,
        allocation_scale,
        stream_rows
      );
    else
      allocation_plan := jsonb_build_object(
        'viable', false,
        'allocations', '[]'::jsonb
      );
    end if;

    if coalesce((allocation_plan ->> 'viable')::boolean, false) then
      update public.supply_list_items as delivery_item
      set
        ordered_amount = allocation.allocated_amount,
        ordered_unit = source_order.order_unit,
        package_note = null,
        order_package_note = source_order.source_package_note,
        order_source_kind = 'manual_purchase',
        manual_order_source_item_id = source_order.source_item_id,
        manual_order_total_amount = source_order.total_amount,
        manual_order_unit = source_order.order_unit,
        row_version = delivery_item.row_version + 1,
        updated_by = (select auth.uid())
      from jsonb_to_recordset(
        allocation_plan -> 'allocations'
      ) as allocation(item_id uuid, allocated_amount numeric)
      where delivery_item.id = allocation.item_id
        and (
          delivery_item.ordered_amount is distinct from allocation.allocated_amount
          or delivery_item.ordered_unit is distinct from source_order.order_unit
          or delivery_item.package_note is not null
          or delivery_item.order_package_note is distinct from source_order.source_package_note
          or delivery_item.order_source_kind is distinct from 'manual_purchase'
          or delivery_item.manual_order_source_item_id is distinct from source_order.source_item_id
          or delivery_item.manual_order_total_amount is distinct from source_order.total_amount
          or delivery_item.manual_order_unit is distinct from source_order.order_unit
        );
      get diagnostics changed_count = row_count;
      allocated_count := allocated_count + changed_count;
    else
      unresolved_count := unresolved_count + 1;
      update public.supply_list_items as delivery_item
      set
        ordered_amount = null,
        ordered_unit = null,
        package_note = null,
        order_package_note = null,
        order_source_kind = null,
        manual_order_source_item_id = null,
        manual_order_total_amount = null,
        manual_order_unit = null,
        row_version = delivery_item.row_version + 1,
        updated_by = (select auth.uid())
      from public.supply_lists as delivery_list
      where delivery_item.organization_id = p_organization_id
        and delivery_item.camp_id = p_camp_id
        and delivery_item.canonical_key = source_order.canonical_key
        and delivery_item.order_source_kind = 'manual_purchase'
        and delivery_list.id = delivery_item.supply_list_id
        and delivery_list.kind = 'delivery'
        and delivery_list.status <> 'complete'
        and not delivery_item.completed
        and delivery_list.calculation_revision_id = source_order.calculation_revision_id;
      get diagnostics changed_count = row_count;
      cleared_count := cleared_count + changed_count;
    end if;
  end loop;

  if cleared_count + allocated_count > 0 then
    insert into public.audit_events (
      organization_id, actor_user_id, event_type, entity_type, entity_id, payload
    ) values (
      p_organization_id,
      (select auth.uid()),
      'manual_purchase_allocated_to_deliveries',
      'camp',
      p_camp_id::text,
      jsonb_build_object(
        'canonical_key', p_canonical_key,
        'cleared_delivery_item_count', cleared_count,
        'allocated_delivery_item_count', allocated_count,
        'unresolved_source_count', unresolved_count
      )
    );
  end if;

  return jsonb_build_object(
    'cleared_delivery_item_count', cleared_count,
    'allocated_delivery_item_count', allocated_count,
    'temporal_delivery_item_count', allocated_count,
    'unresolved_source_count', unresolved_count
  );
end;
$$;

revoke all on function public.sync_manual_purchase_delivery_allocations(uuid, uuid, text)
  from public, anon, authenticated;

alter function public.sync_supplier_order_delivery_allocations(uuid, uuid, text)
  rename to sync_supplier_order_delivery_allocations_proportional_legacy;

revoke all on function
  public.sync_supplier_order_delivery_allocations_proportional_legacy(
    uuid, uuid, text
  ) from public, anon, authenticated;

-- Convert an explicit delivery override to verified supplier purchase units.
-- Only a known exact purchase unit or a known required-unit dimension is safe;
-- package-to-weight, weight-to-volume and unknown dimensions remain unresolved.
create function public.supplier_delivery_override_purchase_units(
  p_amount numeric,
  p_unit text,
  p_purchase_unit text,
  p_required_unit text,
  p_amount_per_purchase_unit numeric
)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_amount is null or p_amount < 0
      or p_amount_per_purchase_unit is null or p_amount_per_purchase_unit <= 0
      or public.manual_purchase_unit_dimension(p_unit) is null
      then null
    when lower(trim(p_unit)) = lower(trim(p_purchase_unit))
      and public.manual_purchase_unit_dimension(p_purchase_unit) is not null
      then p_amount
    when public.manual_purchase_unit_dimension(p_unit)
        = public.manual_purchase_unit_dimension(p_required_unit)
      and public.manual_purchase_unit_dimension(p_required_unit) is not null
      and (
        public.manual_purchase_unit_dimension(p_required_unit) <> 'count'
        or public.manual_purchase_unit_family(p_unit)
          = public.manual_purchase_unit_family(p_required_unit)
      )
      then p_amount
        * public.manual_purchase_unit_factor(p_unit)
        / public.manual_purchase_unit_factor(p_required_unit)
        / p_amount_per_purchase_unit
    else null
  end;
$$;

revoke all on function public.supplier_delivery_override_purchase_units(
  numeric, text, text, text, numeric
) from public, anon, authenticated;

create function public.sync_supplier_order_delivery_allocations(
  p_organization_id uuid,
  p_camp_id uuid,
  p_canonical_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_order record;
  stream_rows jsonb;
  stream_compatible boolean;
  allocation_plan jsonb;
  changed_count integer := 0;
  cleared_count integer := 0;
  allocated_count integer := 0;
  unresolved_count integer := 0;
begin
  for source_order in
    with ica_account as (
      select account.id
      from public.supplier_accounts as account
      where account.organization_id = p_organization_id
        and account.provider_key = 'ica'
        and account.provider_location_id = '1004021'
        and account.active
      limit 1
    )
    select
      purchase_item.id as source_item_id,
      purchase_item.canonical_key,
      purchase_item.ordered_amount as total_purchase_units,
      purchase_item.ordered_unit as purchase_unit,
      purchase_item.package_note as source_package_note,
      ingredient_match.amount_per_purchase_unit,
      ingredient_match.required_unit,
      account.id as supplier_account_id,
      product.id as supplier_product_id,
      product.product_fingerprint,
      product.source_metadata @> jsonb_build_object(
        'source', 'ica_local_fixture',
        'store_id', '1004021',
        'synthetic_local_fixture', true
      ) as supplier_order_synthetic_fixture,
      purchase_list.calculation_revision_id
    from public.supply_lists as purchase_list
    join public.supply_list_items as purchase_item
      on purchase_item.organization_id = purchase_list.organization_id
     and purchase_item.camp_id = purchase_list.camp_id
     and purchase_item.supply_list_id = purchase_list.id
     and purchase_item.source_present
    join ica_account as account on true
    join public.preferred_supplier_matches as preferred
      on preferred.organization_id = purchase_item.organization_id
     and preferred.canonical_key = purchase_item.canonical_key
     and preferred.supplier_account_id = account.id
    join public.ingredient_supplier_matches as ingredient_match
      on ingredient_match.organization_id = preferred.organization_id
     and ingredient_match.id = preferred.ingredient_supplier_match_id
     and ingredient_match.canonical_key = preferred.canonical_key
     and ingredient_match.supplier_account_id = preferred.supplier_account_id
     and ingredient_match.supplier_product_id = preferred.supplier_product_id
     and ingredient_match.approved_by is not null
     and ingredient_match.approved_at is not null
    join public.supplier_products as product
      on product.organization_id = preferred.organization_id
     and product.supplier_account_id = preferred.supplier_account_id
     and product.id = preferred.supplier_product_id
     and product.id = ingredient_match.supplier_product_id
     and product.active
     and product.product_fingerprint = ingredient_match.approved_product_fingerprint
     and product.product_data_source = 'import:api'
     and public.ica_supplier_product_has_allowed_provenance(
       product.source_metadata,
       '1004021'
     )
     and product.packaging_metadata @> jsonb_build_object(
       'normalization_version', 'ica-public-catalogue-v2'
     )
    join public.calculation_revisions as revision
      on revision.organization_id = purchase_list.organization_id
     and revision.camp_id = purchase_list.camp_id
     and revision.id = purchase_list.calculation_revision_id
     and revision.status = 'current'
    where purchase_list.organization_id = p_organization_id
      and purchase_list.camp_id = p_camp_id
      and purchase_list.kind = 'purchase'
      and purchase_list.source_present
      and (p_canonical_key is null or purchase_item.canonical_key = p_canonical_key)
      and purchase_item.ordered_amount is not null
      and purchase_item.ordered_amount > 0
      and purchase_item.ordered_amount = trunc(purchase_item.ordered_amount)
      and lower(trim(purchase_item.ordered_unit)) = lower(trim(product.purchase_unit))
  loop
    select
      jsonb_agg(
        jsonb_build_object(
          'item_id', dated.item_id,
          'allocation_position', dated.allocation_position,
          'required_amount', dated.required_purchase_units,
          'override_amount', dated.override_purchase_units,
          'is_automatic', dated.is_automatic
        ) order by dated.allocation_position
      ),
      coalesce(bool_and(dated.row_is_compatible), false)
    into stream_rows, stream_compatible
    from (
      select
        delivery_item.id as item_id,
        row_number() over (
          order by
            delivery_list.range_start,
            case when delivery_list.status = 'complete'
              or delivery_item.completed
              or delivery_item.order_source_kind = 'manual'
              then 1 else 0 end,
            delivery_item.item_key
        )::integer as allocation_position,
        delivery_item.required_amount
          * public.manual_purchase_unit_factor(delivery_item.required_unit)
          / public.manual_purchase_unit_factor(source_order.required_unit)
          / source_order.amount_per_purchase_unit as required_purchase_units,
        case when delivery_list.status = 'complete'
          or delivery_item.completed
          or delivery_item.order_source_kind = 'manual' then
          public.supplier_delivery_override_purchase_units(
            delivery_item.ordered_amount,
            delivery_item.ordered_unit,
            source_order.purchase_unit,
            source_order.required_unit,
            source_order.amount_per_purchase_unit
          ) else null end as override_purchase_units,
        case when delivery_list.status = 'complete'
          or delivery_item.completed
          or delivery_item.order_source_kind = 'manual'
          then false else true end as is_automatic,
        delivery_list.range_start is not null
        and public.manual_purchase_unit_dimension(delivery_item.required_unit)
          = public.manual_purchase_unit_dimension(source_order.required_unit)
        and public.manual_purchase_unit_dimension(source_order.required_unit)
          is not null
        and (
          public.manual_purchase_unit_dimension(source_order.required_unit) <> 'count'
          or public.manual_purchase_unit_family(delivery_item.required_unit)
            = public.manual_purchase_unit_family(source_order.required_unit)
        )
        and case
          when delivery_list.status = 'complete'
            or delivery_item.completed
            or delivery_item.order_source_kind = 'manual' then
            public.supplier_delivery_override_purchase_units(
              delivery_item.ordered_amount,
              delivery_item.ordered_unit,
              source_order.purchase_unit,
              source_order.required_unit,
              source_order.amount_per_purchase_unit
            ) is not null
            and public.supplier_delivery_override_purchase_units(
              delivery_item.ordered_amount,
              delivery_item.ordered_unit,
              source_order.purchase_unit,
              source_order.required_unit,
              source_order.amount_per_purchase_unit
            ) = trunc(public.supplier_delivery_override_purchase_units(
              delivery_item.ordered_amount,
              delivery_item.ordered_unit,
              source_order.purchase_unit,
              source_order.required_unit,
              source_order.amount_per_purchase_unit
            ))
          when delivery_item.order_source_kind = 'supplier_purchase' then true
          when delivery_item.order_source_kind is null then
            delivery_item.ordered_amount is null
            and delivery_item.ordered_unit is null
            and delivery_item.package_note is null
          else false
        end as row_is_compatible
      from public.supply_lists as delivery_list
      join public.supply_list_items as delivery_item
        on delivery_item.supply_list_id = delivery_list.id
       and delivery_item.organization_id = delivery_list.organization_id
       and delivery_item.camp_id = delivery_list.camp_id
      where delivery_list.organization_id = p_organization_id
        and delivery_list.camp_id = p_camp_id
        and delivery_list.kind = 'delivery'
        and (
          delivery_list.status = 'complete'
          or delivery_item.completed
          or delivery_list.source_present
        )
        and (
          delivery_list.status = 'complete'
          or delivery_item.completed
          or delivery_list.calculation_revision_id
            = source_order.calculation_revision_id
        )
        and delivery_item.canonical_key = source_order.canonical_key
        and (
          delivery_list.status = 'complete'
          or delivery_item.completed
          or delivery_item.source_present
        )
        and delivery_item.required_amount > 0
    ) as dated;

    if stream_rows is not null and stream_compatible then
      allocation_plan := public.temporal_delivery_allocation_plan(
        source_order.total_purchase_units,
        0,
        stream_rows
      );
    else
      allocation_plan := jsonb_build_object(
        'viable', false,
        'allocations', '[]'::jsonb
      );
    end if;

    if coalesce((allocation_plan ->> 'viable')::boolean, false) then
      update public.supply_list_items as delivery_item
      set
        ordered_amount = allocation.allocated_amount,
        ordered_unit = source_order.purchase_unit,
        package_note = null,
        order_package_note = source_order.source_package_note,
        order_source_kind = 'supplier_purchase',
        supplier_order_source_item_id = source_order.source_item_id,
        supplier_order_account_id = source_order.supplier_account_id,
        supplier_order_product_id = source_order.supplier_product_id,
        supplier_order_total_units = source_order.total_purchase_units,
        supplier_order_product_fingerprint = source_order.product_fingerprint,
        supplier_order_synthetic_fixture = source_order.supplier_order_synthetic_fixture,
        row_version = delivery_item.row_version + 1,
        updated_by = (select auth.uid())
      from jsonb_to_recordset(
        allocation_plan -> 'allocations'
      ) as allocation(item_id uuid, allocated_amount numeric)
      where delivery_item.id = allocation.item_id
        and (
          delivery_item.ordered_amount is distinct from allocation.allocated_amount
          or delivery_item.ordered_unit is distinct from source_order.purchase_unit
          or delivery_item.package_note is not null
          or delivery_item.order_package_note is distinct from source_order.source_package_note
          or delivery_item.order_source_kind is distinct from 'supplier_purchase'
          or delivery_item.supplier_order_source_item_id is distinct from source_order.source_item_id
          or delivery_item.supplier_order_account_id is distinct from source_order.supplier_account_id
          or delivery_item.supplier_order_product_id is distinct from source_order.supplier_product_id
          or delivery_item.supplier_order_total_units is distinct from source_order.total_purchase_units
          or delivery_item.supplier_order_product_fingerprint is distinct from source_order.product_fingerprint
          or delivery_item.supplier_order_synthetic_fixture
            is distinct from source_order.supplier_order_synthetic_fixture
        );
      get diagnostics changed_count = row_count;
      allocated_count := allocated_count + changed_count;
    else
      unresolved_count := unresolved_count + 1;
      update public.supply_list_items as delivery_item
      set
        ordered_amount = null,
        ordered_unit = null,
        package_note = null,
        order_package_note = null,
        order_source_kind = null,
        supplier_order_source_item_id = null,
        supplier_order_account_id = null,
        supplier_order_product_id = null,
        supplier_order_total_units = null,
        supplier_order_product_fingerprint = null,
        supplier_order_synthetic_fixture = false,
        row_version = delivery_item.row_version + 1,
        updated_by = (select auth.uid())
      from public.supply_lists as delivery_list
      where delivery_item.organization_id = p_organization_id
        and delivery_item.camp_id = p_camp_id
        and delivery_item.canonical_key = source_order.canonical_key
        and delivery_item.order_source_kind = 'supplier_purchase'
        and delivery_list.id = delivery_item.supply_list_id
        and delivery_list.kind = 'delivery'
        and delivery_list.status <> 'complete'
        and not delivery_item.completed
        and delivery_list.calculation_revision_id = source_order.calculation_revision_id;
      get diagnostics changed_count = row_count;
      cleared_count := cleared_count + changed_count;
    end if;
  end loop;

  -- Clear old supplier allocations when their verified source has disappeared.
  update public.supply_list_items as delivery_item
  set
    ordered_amount = null,
    ordered_unit = null,
    package_note = null,
    order_package_note = null,
    order_source_kind = null,
    supplier_order_source_item_id = null,
    supplier_order_account_id = null,
    supplier_order_product_id = null,
    supplier_order_total_units = null,
    supplier_order_product_fingerprint = null,
    supplier_order_synthetic_fixture = false,
    row_version = delivery_item.row_version + 1,
    updated_by = (select auth.uid())
  from public.supply_lists as delivery_list
  where delivery_item.organization_id = p_organization_id
    and delivery_item.camp_id = p_camp_id
    and delivery_item.order_source_kind = 'supplier_purchase'
    and (p_canonical_key is null or delivery_item.canonical_key = p_canonical_key)
    and delivery_list.id = delivery_item.supply_list_id
    and delivery_list.kind = 'delivery'
    and delivery_list.status <> 'complete'
    and not delivery_item.completed
    and not exists (
      select 1
      from public.supply_list_items as source_item
      join public.supply_lists as source_list
        on source_list.id = source_item.supply_list_id
       and source_list.organization_id = source_item.organization_id
       and source_list.camp_id = source_item.camp_id
       and source_list.calculation_revision_id
         = delivery_list.calculation_revision_id
      join public.supplier_accounts as account
        on account.id = delivery_item.supplier_order_account_id
       and account.organization_id = delivery_item.organization_id
       and account.provider_key = 'ica'
       and account.provider_location_id = '1004021'
       and account.active
      join public.preferred_supplier_matches as preferred
        on preferred.organization_id = delivery_item.organization_id
       and preferred.canonical_key = delivery_item.canonical_key
       and preferred.supplier_account_id = account.id
       and preferred.supplier_product_id
         = delivery_item.supplier_order_product_id
      join public.ingredient_supplier_matches as ingredient_match
        on ingredient_match.organization_id = delivery_item.organization_id
       and ingredient_match.id = preferred.ingredient_supplier_match_id
       and ingredient_match.canonical_key = delivery_item.canonical_key
       and ingredient_match.supplier_account_id = delivery_item.supplier_order_account_id
       and ingredient_match.supplier_product_id = delivery_item.supplier_order_product_id
       and ingredient_match.approved_by is not null
       and ingredient_match.approved_at is not null
       and ingredient_match.approved_product_fingerprint
         = delivery_item.supplier_order_product_fingerprint
      join public.supplier_products as product
        on product.organization_id = delivery_item.organization_id
       and product.supplier_account_id = delivery_item.supplier_order_account_id
       and product.id = delivery_item.supplier_order_product_id
       and product.active
       and product.product_fingerprint
         = delivery_item.supplier_order_product_fingerprint
       and product.product_data_source = 'import:api'
       and public.ica_supplier_product_has_allowed_provenance(
         product.source_metadata,
         '1004021'
       )
       and product.packaging_metadata @> jsonb_build_object(
         'normalization_version', 'ica-public-catalogue-v2'
       )
      where source_item.id = delivery_item.supplier_order_source_item_id
        and source_item.organization_id = delivery_item.organization_id
        and source_item.camp_id = delivery_item.camp_id
        and source_list.kind = 'purchase'
        and source_list.source_present
        and source_item.source_present
        and source_item.ordered_amount = delivery_item.supplier_order_total_units
        and source_item.ordered_amount = trunc(source_item.ordered_amount)
        and lower(trim(source_item.ordered_unit))
          = lower(trim(product.purchase_unit))
    );
  get diagnostics changed_count = row_count;
  cleared_count := cleared_count + changed_count;

  if cleared_count + allocated_count > 0 then
    insert into public.audit_events (
      organization_id, actor_user_id, event_type, entity_type, entity_id, payload
    ) values (
      p_organization_id,
      (select auth.uid()),
      'supplier_order_allocated_to_deliveries',
      'camp',
      p_camp_id::text,
      jsonb_build_object(
        'canonical_key', p_canonical_key,
        'delivery_item_count', allocated_count,
        'cleared_delivery_item_count', cleared_count,
        'unresolved_source_count', unresolved_count
      )
    );
  end if;

  return jsonb_build_object(
    'delivery_item_count', allocated_count,
    'package_provenance_item_count', allocated_count,
    'cleared_delivery_item_count', cleared_count,
    'unresolved_source_count', unresolved_count
  );
end;
$$;

revoke all on function public.sync_supplier_order_delivery_allocations(uuid, uuid, text)
  from public, anon, authenticated;

-- Readiness must use the same narrow provenance boundary as import and dated
-- allocation, otherwise a locally approved synthetic ICA row appears to be an
-- incomplete order even though it is intentionally usable in local testing.
create or replace function public.get_supplier_procurement_readiness(
  p_organization_id uuid,
  p_camp_id uuid
)
returns table (
  supplier_items_total bigint,
  supplier_ready_items bigint,
  supplier_safe_suggestions bigint,
  supplier_review_suggestions bigint,
  supplier_pending_items bigint,
  supplier_no_match bigint,
  supplier_order_incomplete bigint,
  supplier_unresolved_items bigint,
  procurement_ready boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with ica_account as (
    select account.id
    from public.supplier_accounts as account
    where account.organization_id = p_organization_id
      and account.provider_key = 'ica'
      and account.provider_location_id = '1004021'
      and account.active
    limit 1
  ),
  purchase_items as (
    select item.*
    from public.supply_lists as list
    join public.calculation_revisions as revision
      on revision.organization_id = list.organization_id
     and revision.camp_id = list.camp_id
     and revision.id = list.calculation_revision_id
     and revision.status = 'current'
    join public.supply_list_items as item
      on item.organization_id = list.organization_id
     and item.camp_id = list.camp_id
     and item.supply_list_id = list.id
    where list.organization_id = p_organization_id
      and list.camp_id = p_camp_id
      and list.kind = 'purchase'
      and list.source_present
      and item.source_present
      and item.required_amount > 0
  ),
  item_state as (
    select
      item.id,
      product.id is not null as has_preferred,
      coalesce(candidate.has_safe, false) as has_safe,
      coalesce(candidate.has_review, false) as has_review,
      coalesce(search.status = 'complete', false) as search_complete,
      product.id is not null
        and item.ordered_amount is not null
        and item.ordered_amount > 0
        and nullif(trim(item.ordered_unit), '') is not null
        and lower(trim(item.ordered_unit))
          = lower(trim(product.purchase_unit)) as ready
    from purchase_items as item
    left join ica_account as account on true
    left join public.supplier_catalogue_search_states as search
      on search.organization_id = item.organization_id
     and search.camp_id = item.camp_id
     and search.supplier_account_id = account.id
     and search.canonical_key = item.canonical_key
     and lower(trim(search.search_query)) = lower(trim(item.item_name))
     and search.search_date =
       (now() at time zone 'Europe/Stockholm')::date
    left join public.preferred_supplier_matches as preferred
      on preferred.organization_id = item.organization_id
     and preferred.canonical_key = item.canonical_key
     and preferred.supplier_account_id = account.id
    left join public.ingredient_supplier_matches as match
      on match.organization_id = preferred.organization_id
     and match.id = preferred.ingredient_supplier_match_id
     and match.canonical_key = preferred.canonical_key
     and match.supplier_account_id = preferred.supplier_account_id
     and match.supplier_product_id = preferred.supplier_product_id
     and match.approved_by is not null
     and match.approved_at is not null
    left join public.supplier_products as product
      on product.organization_id = preferred.organization_id
     and product.supplier_account_id = preferred.supplier_account_id
     and product.id = preferred.supplier_product_id
     and product.id = match.supplier_product_id
     and product.active
     and search.status = 'complete'
     and product.product_fingerprint = match.approved_product_fingerprint
     and product.product_data_source = 'import:api'
     and public.ica_supplier_product_has_allowed_provenance(
       product.source_metadata,
       '1004021'
     )
     and product.packaging_metadata @> jsonb_build_object(
       'normalization_version', 'ica-public-catalogue-v2'
     )
     and (product.source_updated_at at time zone 'Europe/Stockholm')::date
       = search.search_date
     and exists (
       select 1
       from jsonb_array_elements(
         coalesce(product.source_metadata -> 'ica_search_matches', '[]'::jsonb)
       ) as product_search(value)
       where jsonb_typeof(product_search.value) = 'object'
         and lower(trim(product_search.value ->> 'query'))
           = lower(trim(search.search_query))
     )
    left join lateral (
      select
        coalesce(bool_or(open.status = 'safe'), false) as has_safe,
        coalesce(bool_or(open.status = 'review'), false) as has_review
      from public.supplier_match_candidates as open
      join public.supplier_products as candidate_product
        on candidate_product.organization_id = open.organization_id
       and candidate_product.supplier_account_id = open.supplier_account_id
       and candidate_product.id = open.supplier_product_id
       and candidate_product.active
       and candidate_product.product_fingerprint = open.product_fingerprint
       and candidate_product.product_data_source = 'import:api'
       and public.ica_supplier_product_has_allowed_provenance(
         candidate_product.source_metadata,
         '1004021'
       )
       and candidate_product.packaging_metadata @> jsonb_build_object(
         'normalization_version', 'ica-public-catalogue-v2'
       )
       and (candidate_product.source_updated_at at time zone 'Europe/Stockholm')::date
         = search.search_date
       and exists (
         select 1
         from jsonb_array_elements(
           coalesce(
             candidate_product.source_metadata -> 'ica_search_matches',
             '[]'::jsonb
           )
         ) as candidate_search(value)
         where jsonb_typeof(candidate_search.value) = 'object'
           and lower(trim(candidate_search.value ->> 'query'))
             = lower(trim(search.search_query))
       )
      where open.organization_id = item.organization_id
        and open.supplier_account_id = account.id
        and open.canonical_key = item.canonical_key
        and open.status in ('safe', 'review')
        and search.status = 'complete'
    ) as candidate on true
  ),
  readiness as (
    select
      count(*) as supplier_items_total,
      count(*) filter (where state.ready) as supplier_ready_items,
      count(*) filter (
        where not state.has_preferred and state.has_safe
      ) as supplier_safe_suggestions,
      count(*) filter (
        where not state.has_preferred
          and not state.has_safe
          and state.has_review
      ) as supplier_review_suggestions,
      count(*) filter (
        where not state.has_preferred
          and not state.has_safe
          and not state.has_review
          and not state.search_complete
      ) as supplier_pending_items,
      count(*) filter (
        where not state.has_preferred
          and not state.has_safe
          and not state.has_review
          and state.search_complete
      ) as supplier_no_match,
      count(*) filter (
        where state.has_preferred and not state.ready
      ) as supplier_order_incomplete,
      count(*) filter (where not state.ready) as supplier_unresolved_items
    from item_state as state
  )
  select
    readiness.supplier_items_total,
    readiness.supplier_ready_items,
    readiness.supplier_safe_suggestions,
    readiness.supplier_review_suggestions,
    readiness.supplier_pending_items,
    readiness.supplier_no_match,
    readiness.supplier_order_incomplete,
    readiness.supplier_unresolved_items,
    readiness.supplier_items_total = 0
      or readiness.supplier_unresolved_items = 0
  from readiness
  where public.is_org_member(p_organization_id);
$$;

revoke all on function public.get_supplier_procurement_readiness(uuid, uuid)
  from public, anon;
grant execute on function public.get_supplier_procurement_readiness(uuid, uuid)
  to authenticated;
