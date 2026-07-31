alter table public.supply_list_items
  add column order_source_kind text
    check (order_source_kind in ('manual', 'supplier_purchase')),
  add column supplier_order_source_item_id uuid,
  add column supplier_order_account_id uuid,
  add column supplier_order_product_id uuid,
  add column supplier_order_total_units numeric(20, 6)
    check (
      supplier_order_total_units is null
      or supplier_order_total_units >= 0
    ),
  add column supplier_order_product_fingerprint text
    check (
      supplier_order_product_fingerprint is null
      or supplier_order_product_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  add constraint supply_list_items_supplier_order_metadata
    check (
      (
        order_source_kind = 'supplier_purchase'
        and supplier_order_source_item_id is not null
        and supplier_order_account_id is not null
        and supplier_order_product_id is not null
        and supplier_order_total_units is not null
        and supplier_order_product_fingerprint is not null
      )
      or (
        order_source_kind is distinct from 'supplier_purchase'
        and supplier_order_source_item_id is null
        and supplier_order_account_id is null
        and supplier_order_product_id is null
        and supplier_order_total_units is null
        and supplier_order_product_fingerprint is null
      )
    );

create index supply_list_items_supplier_order_source_idx
  on public.supply_list_items (
    organization_id,
    camp_id,
    canonical_key,
    order_source_kind
  )
  where order_source_kind is not null;

comment on column public.supply_list_items.order_source_kind is
  'Whether order fields were entered on this row or allocated from a verified supplier purchase row.';
comment on column public.supply_list_items.supplier_order_source_item_id is
  'Purchase-list row whose verified whole-unit order was allocated to this delivery row.';

create function public.supplier_order_unit_label(
  p_unit text,
  p_amount numeric
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when abs(coalesce(p_amount, 0)) = 1 then trim(coalesce(p_unit, ''))
    else case lower(trim(coalesce(p_unit, '')))
      when 'ask' then 'askar'
      when 'burk' then 'burkar'
      when 'flaska' then 'flaskor'
      when 'förpackning' then 'förpackningar'
      when 'kartong' then 'kartonger'
      when 'påse' then 'påsar'
      when 'rulle' then 'rullar'
      when 'styck' then 'stycken'
      when 'stycke' then 'stycken'
      when 'säck' then 'säckar'
      when 'tub' then 'tuber'
      else trim(coalesce(p_unit, ''))
    end
  end;
$$;

revoke all on function public.supplier_order_unit_label(
  text,
  numeric
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
  synced_count integer := 0;
begin
  update public.supply_list_items as delivery_item
  set
    ordered_amount = null,
    ordered_unit = null,
    package_note = null,
    order_source_kind = null,
    supplier_order_source_item_id = null,
    supplier_order_account_id = null,
    supplier_order_product_id = null,
    supplier_order_total_units = null,
    supplier_order_product_fingerprint = null,
    row_version = delivery_item.row_version + 1,
    updated_by = (select auth.uid())
  from public.supply_lists as delivery_list
  where delivery_item.organization_id = p_organization_id
    and delivery_item.camp_id = p_camp_id
    and (
      p_canonical_key is null
      or delivery_item.canonical_key = p_canonical_key
    )
    and delivery_item.order_source_kind = 'supplier_purchase'
    and delivery_list.organization_id = delivery_item.organization_id
    and delivery_list.camp_id = delivery_item.camp_id
    and delivery_list.id = delivery_item.supply_list_id
    and delivery_list.kind = 'delivery';

  with ica_account as (
    select account.id
    from public.supplier_accounts as account
    where account.organization_id = p_organization_id
      and account.provider_key = 'ica'
      and account.provider_location_id = '1004021'
      and account.active
    limit 1
  ),
  verified_orders as (
    select
      purchase_item.id as source_item_id,
      purchase_item.canonical_key,
      purchase_item.ordered_amount as total_purchase_units,
      purchase_item.ordered_unit as purchase_unit,
      ingredient_match.amount_per_purchase_unit,
      ingredient_match.required_unit,
      account.id as supplier_account_id,
      product.id as supplier_product_id,
      product.product_fingerprint,
      product.display_name,
      product.supplier_article_number,
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
     and ingredient_match.supplier_account_id =
       preferred.supplier_account_id
     and ingredient_match.supplier_product_id =
       preferred.supplier_product_id
     and ingredient_match.approved_by is not null
     and ingredient_match.approved_at is not null
    join public.supplier_products as product
      on product.organization_id = preferred.organization_id
     and product.supplier_account_id = preferred.supplier_account_id
     and product.id = preferred.supplier_product_id
     and product.id = ingredient_match.supplier_product_id
     and product.active
     and product.product_fingerprint =
       ingredient_match.approved_product_fingerprint
     and product.product_data_source = 'import:api'
     and product.source_metadata @> jsonb_build_object(
       'source', 'ica_public_webshop',
       'store_id', '1004021'
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
      and (
        p_canonical_key is null
        or purchase_item.canonical_key = p_canonical_key
      )
      and purchase_item.ordered_amount is not null
      and purchase_item.ordered_amount > 0
      and purchase_item.ordered_amount =
        trunc(purchase_item.ordered_amount)
      and lower(trim(purchase_item.ordered_unit)) =
        lower(trim(product.purchase_unit))
  ),
  delivery_weights as (
    select
      delivery_item.id,
      delivery_item.item_key,
      delivery_item.required_amount,
      delivery_list.range_start,
      verified.*,
      sum(delivery_item.required_amount) over (
        partition by verified.source_item_id
      ) as total_required_amount
    from verified_orders as verified
    join public.supply_lists as delivery_list
      on delivery_list.organization_id = p_organization_id
     and delivery_list.camp_id = p_camp_id
     and delivery_list.kind = 'delivery'
     and delivery_list.source_present
     and delivery_list.calculation_revision_id =
       verified.calculation_revision_id
    join public.supply_list_items as delivery_item
      on delivery_item.organization_id = delivery_list.organization_id
     and delivery_item.camp_id = delivery_list.camp_id
     and delivery_item.supply_list_id = delivery_list.id
     and delivery_item.canonical_key = verified.canonical_key
     and delivery_item.source_present
     and delivery_item.required_amount > 0
     and (
       delivery_item.order_source_kind = 'supplier_purchase'
       or (
         delivery_item.order_source_kind is null
         and delivery_item.ordered_amount is null
         and delivery_item.ordered_unit is null
         and delivery_item.package_note is null
       )
     )
  ),
  allocation_base as (
    select
      delivery.*,
      floor(
        delivery.total_purchase_units
          * delivery.required_amount
          / delivery.total_required_amount
      ) as base_units,
      (
        delivery.total_purchase_units
          * delivery.required_amount
          / delivery.total_required_amount
      ) - floor(
        delivery.total_purchase_units
          * delivery.required_amount
          / delivery.total_required_amount
      ) as fractional_units
    from delivery_weights as delivery
    where delivery.total_required_amount > 0
  ),
  allocation_ranked as (
    select
      allocation.*,
      allocation.total_purchase_units
        - sum(allocation.base_units) over (
          partition by allocation.source_item_id
        ) as remaining_units,
      row_number() over (
        partition by allocation.source_item_id
        order by
          allocation.fractional_units desc,
          allocation.range_start,
          allocation.item_key
      ) as allocation_rank
    from allocation_base as allocation
  ),
  allocations as (
    select
      ranked.*,
      ranked.base_units
        + case
            when ranked.allocation_rank <= ranked.remaining_units
              then 1
            else 0
          end as allocated_units
    from allocation_ranked as ranked
  )
  update public.supply_list_items as delivery_item
  set
    ordered_amount = allocation.allocated_units,
    ordered_unit = allocation.purchase_unit,
    package_note = left(
      allocation.allocated_units::text
        || ' av totalt '
        || replace(
          trim(trailing '.' from trim(to_char(
            allocation.total_purchase_units,
            'FM999999999999990.999999'
          ))),
          '.',
          ','
        )
        || ' '
        || public.supplier_order_unit_label(
          allocation.purchase_unit,
          allocation.total_purchase_units
        )
        || ' · '
        || replace(
          trim(to_char(
            allocation.amount_per_purchase_unit,
            'FM999999999999990.999999'
          )),
          '.',
          ','
        )
        || ' '
        || allocation.required_unit
        || '/'
        || allocation.purchase_unit
        || ' · '
        || allocation.display_name
        || ' (ICA '
        || allocation.supplier_article_number
        || ')',
      240
    ),
    order_source_kind = 'supplier_purchase',
    supplier_order_source_item_id = allocation.source_item_id,
    supplier_order_account_id = allocation.supplier_account_id,
    supplier_order_product_id = allocation.supplier_product_id,
    supplier_order_total_units = allocation.total_purchase_units,
    supplier_order_product_fingerprint = allocation.product_fingerprint,
    row_version = delivery_item.row_version + 1,
    updated_by = (select auth.uid())
  from allocations as allocation
  where delivery_item.id = allocation.id;

  get diagnostics synced_count = row_count;

  if synced_count > 0 then
    insert into public.audit_events (
      organization_id,
      actor_user_id,
      event_type,
      entity_type,
      entity_id,
      payload
    ) values (
      p_organization_id,
      (select auth.uid()),
      'supplier_order_allocated_to_deliveries',
      'camp',
      p_camp_id::text,
      jsonb_build_object(
        'canonical_key', p_canonical_key,
        'delivery_item_count', synced_count
      )
    );
  end if;

  return jsonb_build_object('delivery_item_count', synced_count);
end;
$$;

revoke all on function public.sync_supplier_order_delivery_allocations(
  uuid,
  uuid,
  text
) from public, anon, authenticated;

create function public.sync_supplier_order_delivery_allocations_after_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected record;
begin
  for affected in
    select distinct
      changed.organization_id,
      changed.camp_id
    from new_supply_items as changed
    join public.supply_lists as list
      on list.organization_id = changed.organization_id
     and list.camp_id = changed.camp_id
     and list.id = changed.supply_list_id
     and list.kind = 'purchase'
  loop
    perform public.sync_supplier_order_delivery_allocations(
      affected.organization_id,
      affected.camp_id,
      null
    );
  end loop;

  return null;
end;
$$;

revoke all on function
  public.sync_supplier_order_delivery_allocations_after_items()
from public, anon, authenticated;

create trigger supply_items_sync_supplier_deliveries_after_insert
after insert on public.supply_list_items
referencing new table as new_supply_items
for each statement
execute function public.sync_supplier_order_delivery_allocations_after_items();

create trigger supply_items_sync_supplier_deliveries_after_update
after update on public.supply_list_items
referencing new table as new_supply_items
for each statement
execute function public.sync_supplier_order_delivery_allocations_after_items();

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
  select item.*
  into target_item
  from public.supply_list_items as item
  where item.id = p_item_id
  for update;

  if not found or not public.is_org_member(target_item.organization_id) then
    raise exception 'Supply item not found' using errcode = '42501';
  end if;

  select list.kind
  into target_kind
  from public.supply_lists as list
  where list.organization_id = target_item.organization_id
    and list.camp_id = target_item.camp_id
    and list.id = target_item.supply_list_id;

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

  order_fields_changed :=
    target_item.ordered_amount is distinct from p_ordered_amount
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
      when target_kind = 'delivery' and order_fields_changed then
        case
          when p_ordered_amount is null
            and normalized_ordered_unit is null
            and normalized_package_note is null
          then null
          else 'manual'
        end
      else order_source_kind
    end,
    supplier_order_source_item_id = case
      when target_kind = 'delivery' and order_fields_changed then null
      else supplier_order_source_item_id
    end,
    supplier_order_account_id = case
      when target_kind = 'delivery' and order_fields_changed then null
      else supplier_order_account_id
    end,
    supplier_order_product_id = case
      when target_kind = 'delivery' and order_fields_changed then null
      else supplier_order_product_id
    end,
    supplier_order_total_units = case
      when target_kind = 'delivery' and order_fields_changed then null
      else supplier_order_total_units
    end,
    supplier_order_product_fingerprint = case
      when target_kind = 'delivery' and order_fields_changed then null
      else supplier_order_product_fingerprint
    end,
    row_version = row_version + 1,
    updated_by = (select auth.uid())
  where id = p_item_id
  returning row_version into next_version;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
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
      'order_source_kind',
        case
          when target_kind = 'delivery' and order_fields_changed
            then 'manual'
          else target_item.order_source_kind
        end
    )
  );

  return next_version;
end;
$$;

revoke all on function public.update_supply_item(
  uuid,
  bigint,
  numeric,
  text,
  text,
  text,
  boolean
) from public, anon;
grant execute on function public.update_supply_item(
  uuid,
  bigint,
  numeric,
  text,
  text,
  text,
  boolean
) to authenticated;
