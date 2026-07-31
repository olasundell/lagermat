-- A camp-level order entered without a verified supplier article is still an
-- operational decision.  Keep that exact order total and split it only when
-- the delivery units can be compared without guessing at a package size.
alter table public.supply_list_items
  drop constraint if exists supply_list_items_order_source_kind_check,
  add constraint supply_list_items_order_source_kind_check
    check (order_source_kind in ('manual', 'supplier_purchase', 'manual_purchase')),
  add column manual_order_source_item_id uuid,
  add column manual_order_total_amount numeric(20, 6)
    check (manual_order_total_amount is null or manual_order_total_amount >= 0),
  add column manual_order_unit text;

alter table public.supply_list_items
  add constraint supply_list_items_manual_order_metadata
    check (
      (
        order_source_kind = 'manual_purchase'
        and manual_order_source_item_id is not null
        and manual_order_total_amount is not null
        and manual_order_unit is not null
      )
      or (
        order_source_kind is distinct from 'manual_purchase'
        and manual_order_source_item_id is null
        and manual_order_total_amount is null
        and manual_order_unit is null
      )
    );

create index supply_list_items_manual_order_source_idx
  on public.supply_list_items (
    organization_id,
    camp_id,
    manual_order_source_item_id
  )
  where order_source_kind = 'manual_purchase';

create function public.manual_purchase_unit_dimension(p_unit text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case lower(trim(coalesce(p_unit, '')))
    when 'g' then 'mass' when 'hg' then 'mass' when 'kg' then 'mass'
    when 'ml' then 'volume' when 'cl' then 'volume' when 'dl' then 'volume'
    when 'l' then 'volume'
    when 'st' then 'count' when 'styck' then 'count' when 'stycke' then 'count'
    when 'stycken' then 'count' when 'burk' then 'count' when 'burkar' then 'count'
    when 'flaska' then 'count' when 'flaskor' then 'count' when 'ask' then 'count'
    when 'askar' then 'count' when 'förpackning' then 'count'
    when 'förpackningar' then 'count' when 'paket' then 'count'
    when 'kartong' then 'count' when 'kartonger' then 'count'
    when 'påse' then 'count' when 'påsar' then 'count'
    when 'rulle' then 'count' when 'rullar' then 'count'
    when 'säck' then 'count' when 'säckar' then 'count'
    when 'tub' then 'count' when 'tuber' then 'count'
    else null
  end;
$$;

create function public.manual_purchase_unit_family(p_unit text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case lower(trim(coalesce(p_unit, '')))
    when 'g' then 'mass' when 'hg' then 'mass' when 'kg' then 'mass'
    when 'ml' then 'volume' when 'cl' then 'volume' when 'dl' then 'volume'
    when 'l' then 'volume'
    when 'st' then 'piece' when 'styck' then 'piece' when 'stycke' then 'piece'
    when 'stycken' then 'piece' when 'burk' then 'tin' when 'burkar' then 'tin'
    when 'flaska' then 'bottle' when 'flaskor' then 'bottle'
    when 'ask' then 'box' when 'askar' then 'box'
    when 'förpackning' then 'package' when 'förpackningar' then 'package'
    when 'paket' then 'package' when 'kartong' then 'carton'
    when 'kartonger' then 'carton' when 'påse' then 'bag' when 'påsar' then 'bag'
    when 'rulle' then 'roll' when 'rullar' then 'roll'
    when 'säck' then 'sack' when 'säckar' then 'sack'
    when 'tub' then 'tube' when 'tuber' then 'tube'
    else null
  end;
$$;

create function public.manual_purchase_unit_factor(p_unit text)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case lower(trim(coalesce(p_unit, '')))
    when 'g' then 1::numeric when 'hg' then 100::numeric when 'kg' then 1000::numeric
    when 'ml' then 1::numeric when 'cl' then 10::numeric when 'dl' then 100::numeric
    when 'l' then 1000::numeric
    when 'st' then 1::numeric when 'styck' then 1::numeric when 'stycke' then 1::numeric
    when 'stycken' then 1::numeric when 'burk' then 1::numeric when 'burkar' then 1::numeric
    when 'flaska' then 1::numeric when 'flaskor' then 1::numeric when 'ask' then 1::numeric
    when 'askar' then 1::numeric when 'förpackning' then 1::numeric
    when 'förpackningar' then 1::numeric when 'paket' then 1::numeric
    when 'kartong' then 1::numeric when 'kartonger' then 1::numeric
    when 'påse' then 1::numeric when 'påsar' then 1::numeric
    when 'rulle' then 1::numeric when 'rullar' then 1::numeric
    when 'säck' then 1::numeric when 'säckar' then 1::numeric
    when 'tub' then 1::numeric when 'tuber' then 1::numeric
    else null
  end;
$$;

revoke all on function public.manual_purchase_unit_dimension(text) from public, anon, authenticated;
revoke all on function public.manual_purchase_unit_family(text) from public, anon, authenticated;
revoke all on function public.manual_purchase_unit_factor(text) from public, anon, authenticated;

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
  cleared_count integer := 0;
  allocated_count integer := 0;
begin
  -- Clear only provenance that is no longer backed by the exact global order.
  -- Valid rows are updated in place below, which makes repeated generation a no-op.
  update public.supply_list_items as delivery_item
  set
    ordered_amount = null,
    ordered_unit = null,
    package_note = null,
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
        and lower(trim(coalesce(source_item.ordered_unit, ''))) = lower(trim(delivery_item.manual_order_unit))
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
    );

  get diagnostics cleared_count = row_count;

  with manual_orders as (
    select
      source_item.id as source_item_id,
      source_item.canonical_key,
      source_item.ordered_amount as total_amount,
      source_item.ordered_unit as order_unit,
      public.manual_purchase_unit_dimension(source_item.ordered_unit) as unit_dimension,
      public.manual_purchase_unit_family(source_item.ordered_unit) as unit_family,
      public.manual_purchase_unit_factor(source_item.ordered_unit) as unit_factor,
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
      -- A verified ICA purchase remains exclusively owned by the existing allocator.
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
  ),
  manual_overrides as (
    select
      manual.source_item_id,
      count(delivery_item.id) filter (
        where delivery_item.order_source_kind = 'manual'
      ) as override_count,
      count(delivery_item.id) filter (
        where delivery_item.order_source_kind = 'manual'
          and (
            delivery_item.ordered_amount is null
            or delivery_item.ordered_unit is null
            or public.manual_purchase_unit_dimension(delivery_item.ordered_unit) is distinct from manual.unit_dimension
            or (
              manual.unit_dimension = 'count'
              and public.manual_purchase_unit_family(delivery_item.ordered_unit) is distinct from manual.unit_family
            )
          )
      ) as incompatible_override_count,
      coalesce(sum(
        delivery_item.ordered_amount
          * public.manual_purchase_unit_factor(delivery_item.ordered_unit)
          / manual.unit_factor
      ) filter (where delivery_item.order_source_kind = 'manual'), 0) as overridden_amount
    from manual_orders as manual
    join public.supply_lists as delivery_list
      on delivery_list.organization_id = p_organization_id
     and delivery_list.camp_id = p_camp_id
     and delivery_list.kind = 'delivery'
     and delivery_list.source_present
     and delivery_list.calculation_revision_id = manual.calculation_revision_id
    join public.supply_list_items as delivery_item
      on delivery_item.supply_list_id = delivery_list.id
     and delivery_item.organization_id = delivery_list.organization_id
     and delivery_item.camp_id = delivery_list.camp_id
     and delivery_item.canonical_key = manual.canonical_key
     and delivery_item.source_present
    group by manual.source_item_id, manual.unit_factor
  ),
  delivery_weights as (
    select
      manual.*,
      delivery_item.id,
      delivery_item.item_key,
      delivery_list.range_start,
      delivery_item.required_amount
        * public.manual_purchase_unit_factor(delivery_item.required_unit)
        / manual.unit_factor as required_in_order_unit,
      coalesce(overrides.overridden_amount, 0) as overridden_amount,
      coalesce(overrides.incompatible_override_count, 0) as incompatible_override_count,
      sum(
        delivery_item.required_amount
          * public.manual_purchase_unit_factor(delivery_item.required_unit)
          / manual.unit_factor
      ) over (partition by manual.source_item_id) as total_required_in_order_unit
    from manual_orders as manual
    left join manual_overrides as overrides on overrides.source_item_id = manual.source_item_id
    join public.supply_lists as delivery_list
      on delivery_list.organization_id = p_organization_id
     and delivery_list.camp_id = p_camp_id
     and delivery_list.kind = 'delivery'
     and delivery_list.source_present
     and delivery_list.calculation_revision_id = manual.calculation_revision_id
    join public.supply_list_items as delivery_item
      on delivery_item.supply_list_id = delivery_list.id
     and delivery_item.organization_id = delivery_list.organization_id
     and delivery_item.camp_id = delivery_list.camp_id
     and delivery_item.canonical_key = manual.canonical_key
     and delivery_item.source_present
     and delivery_item.required_amount > 0
     and (
       delivery_item.order_source_kind = 'manual_purchase'
       or (
         delivery_item.order_source_kind is null
         and delivery_item.ordered_amount is null
         and delivery_item.ordered_unit is null
         and delivery_item.package_note is null
       )
     )
     and public.manual_purchase_unit_dimension(delivery_item.required_unit) = manual.unit_dimension
     and (
       manual.unit_dimension <> 'count'
       or public.manual_purchase_unit_family(delivery_item.required_unit) = manual.unit_family
     )
    where coalesce(overrides.incompatible_override_count, 0) = 0
      and manual.total_amount >= coalesce(overrides.overridden_amount, 0)
  ),
  allocation_base as (
    select
      delivery.*,
      least(6, scale(trim_scale(delivery.total_amount - delivery.overridden_amount))) as allocation_scale,
      (delivery.total_amount - delivery.overridden_amount)
        * power(
          10::numeric,
          least(6, scale(trim_scale(delivery.total_amount - delivery.overridden_amount)))
        ) as total_quanta
    from delivery_weights as delivery
    where delivery.total_required_in_order_unit > 0
  ),
  allocation_ranked as (
    select
      allocation.*,
      floor(allocation.total_quanta * allocation.required_in_order_unit / allocation.total_required_in_order_unit) as base_quanta,
      (allocation.total_quanta * allocation.required_in_order_unit / allocation.total_required_in_order_unit)
        - floor(allocation.total_quanta * allocation.required_in_order_unit / allocation.total_required_in_order_unit) as fractional_quanta
    from allocation_base as allocation
    where allocation.total_quanta = trunc(allocation.total_quanta)
  ),
  allocation_with_rank as (
    select
      ranked.*,
      ranked.total_quanta - sum(ranked.base_quanta) over (partition by ranked.source_item_id) as remaining_quanta,
      row_number() over (
        partition by ranked.source_item_id
        order by ranked.fractional_quanta desc, ranked.range_start, ranked.item_key
      ) as allocation_rank
    from allocation_ranked as ranked
  ),
  allocations as (
    select
      ranked.*,
      (ranked.base_quanta + case when ranked.allocation_rank <= ranked.remaining_quanta then 1 else 0 end)
        / power(10::numeric, ranked.allocation_scale) as allocated_amount
    from allocation_with_rank as ranked
  )
  update public.supply_list_items as delivery_item
  set
    ordered_amount = allocation.allocated_amount,
    ordered_unit = allocation.order_unit,
    package_note = left(
      replace(trim(to_char(allocation.allocated_amount, 'FM999999999999990.999999')), '.', ',')
        || ' av totalt '
        || replace(trim(to_char(allocation.total_amount, 'FM999999999999990.999999')), '.', ',')
        || ' '
        || public.supplier_order_unit_label(allocation.order_unit, allocation.total_amount)
        || ' för hela lägret',
      240
    ),
    order_source_kind = 'manual_purchase',
    manual_order_source_item_id = allocation.source_item_id,
    manual_order_total_amount = allocation.total_amount,
    manual_order_unit = allocation.order_unit,
    row_version = delivery_item.row_version + 1,
    updated_by = (select auth.uid())
  from allocations as allocation
  where delivery_item.id = allocation.id
    and (
      delivery_item.ordered_amount is distinct from allocation.allocated_amount
      or delivery_item.ordered_unit is distinct from allocation.order_unit
      or delivery_item.order_source_kind is distinct from 'manual_purchase'
      or delivery_item.manual_order_source_item_id is distinct from allocation.source_item_id
      or delivery_item.manual_order_total_amount is distinct from allocation.total_amount
      or delivery_item.manual_order_unit is distinct from allocation.order_unit
    );

  get diagnostics allocated_count = row_count;

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
        'allocated_delivery_item_count', allocated_count
      )
    );
  end if;

  return jsonb_build_object(
    'cleared_delivery_item_count', cleared_count,
    'allocated_delivery_item_count', allocated_count
  );
end;
$$;

revoke all on function public.sync_manual_purchase_delivery_allocations(uuid, uuid, text)
  from public, anon, authenticated;

create or replace function public.sync_supplier_order_delivery_allocations_after_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected record;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  for affected in
    select distinct changed.organization_id, changed.camp_id
    from new_supply_items as changed
    join public.supply_lists as list
      on list.id = changed.supply_list_id
     and list.organization_id = changed.organization_id
     and list.camp_id = changed.camp_id
     and list.kind in ('purchase', 'delivery')
  loop
    perform public.sync_manual_purchase_delivery_allocations(
      affected.organization_id, affected.camp_id, null
    );
    perform public.sync_supplier_order_delivery_allocations(
      affected.organization_id, affected.camp_id, null
    );
  end loop;
  return null;
end;
$$;

-- Existing manual purchase rows predate the provenance column.  This runs only
-- after the statement trigger knows about manual allocation, so upgrade-time
-- backfill immediately produces the same delivery shares as a new edit.
update public.supply_list_items as source_item
set order_source_kind = 'manual'
from public.supply_lists as source_list
where source_list.id = source_item.supply_list_id
  and source_list.kind = 'purchase'
  and source_item.order_source_kind is null
  and source_item.ordered_amount is not null;

-- Online edits travel through apply_supply_item_mutation so that the same UI
-- also works offline.  That RPC predates order provenance and only writes the
-- five editable fields.  Reconcile the provenance in the same transaction as
-- the durable mutation record, then run the allocators explicitly: the normal
-- supply-item statement trigger is intentionally recursion-guarded here.
create function public.reconcile_offline_supply_order_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_item public.supply_list_items%rowtype;
  target_kind public.supply_list_kind;
begin
  if new.status <> 'applied'
    or not (new.changes ?| array[
      'ordered_amount', 'ordered_unit', 'package_note'
    ]) then
    return new;
  end if;

  select item.*
  into target_item
  from public.supply_list_items as item
  where item.id = new.item_id
    and item.organization_id = new.organization_id
    and item.camp_id = new.camp_id
  for update;

  if not found then
    return new;
  end if;

  select list.kind
  into target_kind
  from public.supply_lists as list
  where list.id = target_item.supply_list_id
    and list.organization_id = target_item.organization_id
    and list.camp_id = target_item.camp_id;

  if target_kind not in ('purchase', 'delivery') then
    return new;
  end if;

  update public.supply_list_items as item
  set
    order_source_kind = case
      when target_kind = 'purchase' and item.ordered_amount is not null
        then 'manual'
      when target_kind = 'delivery'
        and (
          item.ordered_amount is not null
          or item.ordered_unit is not null
          or item.package_note is not null
        ) then 'manual'
      else null
    end,
    supplier_order_source_item_id = null,
    supplier_order_account_id = null,
    supplier_order_product_id = null,
    supplier_order_total_units = null,
    supplier_order_product_fingerprint = null,
    manual_order_source_item_id = null,
    manual_order_total_amount = null,
    manual_order_unit = null
  where item.id = target_item.id;

  perform public.sync_manual_purchase_delivery_allocations(
    target_item.organization_id,
    target_item.camp_id,
    target_item.canonical_key
  );
  perform public.sync_supplier_order_delivery_allocations(
    target_item.organization_id,
    target_item.camp_id,
    target_item.canonical_key
  );

  return new;
end;
$$;

revoke all on function public.reconcile_offline_supply_order_source()
  from public, anon, authenticated;

create trigger supply_item_mutations_reconcile_order_source
after insert on public.supply_item_mutations
for each row
execute function public.reconcile_offline_supply_order_source();

create or replace function public.update_supply_item(
  p_item_id uuid,
  p_expected_version bigint,
  p_ordered_amount numeric,
  p_ordered_unit text,
  p_package_note text,
  p_comment text,
  p_completed boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_item public.supply_list_items%rowtype;
  target_kind public.supply_list_kind;
  next_version bigint;
  order_fields_changed boolean;
  normalized_ordered_unit text := nullif(trim(p_ordered_unit), '');
  normalized_package_note text := nullif(trim(p_package_note), '');
begin
  select item.* into target_item
  from public.supply_list_items as item
  where item.id = p_item_id
  for update;

  if not found or not public.is_org_member(target_item.organization_id) then
    raise exception 'Supply item not found' using errcode = '42501';
  end if;
  select list.kind into target_kind
  from public.supply_lists as list
  where list.id = target_item.supply_list_id
    and list.organization_id = target_item.organization_id
    and list.camp_id = target_item.camp_id;
  if target_item.row_version <> p_expected_version then
    raise exception 'Supply item has changed' using errcode = '40001';
  end if;
  if p_ordered_amount is not null and p_ordered_amount < 0 then
    raise exception 'Ordered amount must be non-negative' using errcode = '22023';
  end if;
  if length(coalesce(p_ordered_unit, '')) > 40
    or length(coalesce(p_package_note, '')) > 240
    or length(coalesce(p_comment, '')) > 1000 then
    raise exception 'Supply item text is too long' using errcode = '22023';
  end if;

  order_fields_changed := target_item.ordered_amount is distinct from p_ordered_amount
    or target_item.ordered_unit is distinct from normalized_ordered_unit
    or target_item.package_note is distinct from normalized_package_note;

  update public.supply_list_items
  set
    ordered_amount = p_ordered_amount,
    ordered_unit = normalized_ordered_unit,
    package_note = normalized_package_note,
    comment = nullif(trim(p_comment), ''),
    completed = p_completed,
    order_source_kind = case
      when order_fields_changed and target_kind = 'purchase'
        and p_ordered_amount is not null then 'manual'
      when order_fields_changed and target_kind = 'purchase' then null
      when order_fields_changed and target_kind = 'delivery' then
        case when p_ordered_amount is null and normalized_ordered_unit is null and normalized_package_note is null
          then null else 'manual' end
      else order_source_kind
    end,
    supplier_order_source_item_id = case when order_fields_changed and target_kind = 'delivery' then null else supplier_order_source_item_id end,
    supplier_order_account_id = case when order_fields_changed and target_kind = 'delivery' then null else supplier_order_account_id end,
    supplier_order_product_id = case when order_fields_changed and target_kind = 'delivery' then null else supplier_order_product_id end,
    supplier_order_total_units = case when order_fields_changed and target_kind = 'delivery' then null else supplier_order_total_units end,
    supplier_order_product_fingerprint = case when order_fields_changed and target_kind = 'delivery' then null else supplier_order_product_fingerprint end,
    manual_order_source_item_id = case when order_fields_changed and target_kind = 'delivery' then null else manual_order_source_item_id end,
    manual_order_total_amount = case when order_fields_changed and target_kind = 'delivery' then null else manual_order_total_amount end,
    manual_order_unit = case when order_fields_changed and target_kind = 'delivery' then null else manual_order_unit end,
    row_version = row_version + 1,
    updated_by = (select auth.uid())
  where id = p_item_id
  returning row_version into next_version;

  insert into public.audit_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    target_item.organization_id,
    (select auth.uid()),
    'supply_item_updated',
    'supply_list_item',
    p_item_id::text,
    jsonb_build_object(
      'camp_id', target_item.camp_id,
      'base_version', p_expected_version,
      'new_version', next_version,
      'completed', p_completed,
      'order_source_kind', case
        when order_fields_changed and target_kind in ('purchase', 'delivery') then 'manual'
        else target_item.order_source_kind
      end
    )
  );
  return next_version;
end;
$$;

revoke all on function public.update_supply_item(uuid, bigint, numeric, text, text, text, boolean)
  from public, anon;
grant execute on function public.update_supply_item(uuid, bigint, numeric, text, text, text, boolean)
  to authenticated;
