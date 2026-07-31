-- Move a delivery row and persist its currently edited operational fields in
-- one optimistic write. Rows with the same canonical ingredient deliberately
-- remain separate: item_key and source_line_keys retain the generated source
-- identity, while the client labels both sources when they share a delivery.

create function public.move_delivery_item(
  p_item_id uuid,
  p_target_list_id uuid,
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
  target_organization_id uuid;
  target_camp_id uuid;
  target_item public.supply_list_items%rowtype;
  source_list public.supply_lists%rowtype;
  target_list public.supply_lists%rowtype;
  next_version bigint;
  normalized_ordered_unit text := nullif(trim(p_ordered_unit), '');
  normalized_package_note text := nullif(trim(p_package_note), '');
  normalized_comment text := nullif(trim(p_comment), '');
  order_fields_changed boolean;
  target_had_same_canonical boolean;
begin
  -- Discover the camp before taking locks so moves and list regeneration use
  -- the same camp-level serialisation key.
  select item.organization_id, item.camp_id
  into target_organization_id, target_camp_id
  from public.supply_list_items as item
  where item.id = p_item_id;

  if not found or not public.is_org_member(target_organization_id) then
    raise exception 'Supply item not found' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      'supply:' || target_organization_id::text || ':' || target_camp_id::text
    )
  );

  select item.*
  into target_item
  from public.supply_list_items as item
  where item.id = p_item_id
  for update;

  if not found
    or target_item.organization_id <> target_organization_id
    or target_item.camp_id <> target_camp_id
    or not public.is_org_member(target_item.organization_id) then
    raise exception 'Supply item not found' using errcode = '42501';
  end if;
  if target_item.row_version <> p_expected_version then
    raise exception 'Supply item has changed' using errcode = '40001';
  end if;
  if not target_item.source_present then
    raise exception 'Supply item is no longer current' using errcode = '22023';
  end if;
  if target_item.supply_list_id = p_target_list_id then
    raise exception 'Target delivery is current delivery' using errcode = '22023';
  end if;
  if p_ordered_amount is not null and p_ordered_amount < 0 then
    raise exception 'Ordered amount must be non-negative' using errcode = '22023';
  end if;
  if length(coalesce(p_ordered_unit, '')) > 40
    or length(coalesce(p_package_note, '')) > 240
    or length(coalesce(p_comment, '')) > 1000 then
    raise exception 'Supply item text is too long' using errcode = '22023';
  end if;

  -- Serialise with final-status changes. Locking by id gives concurrent moves
  -- a deterministic list-lock order.
  perform 1
  from public.supply_lists as list
  where list.id in (target_item.supply_list_id, p_target_list_id)
  order by list.id
  for update;

  select list.*
  into source_list
  from public.supply_lists as list
  where list.id = target_item.supply_list_id;

  select list.*
  into target_list
  from public.supply_lists as list
  where list.id = p_target_list_id;

  if source_list.id is null
    or source_list.kind <> 'delivery'
    or target_list.id is null
    or target_list.kind <> 'delivery'
    or target_list.organization_id <> target_item.organization_id
    or target_list.camp_id <> target_item.camp_id
    or not target_list.source_present then
    raise exception 'Target delivery not found' using errcode = '22023';
  end if;
  if target_list.status = 'complete' then
    raise exception 'Completed target delivery cannot receive items' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.supply_list_items as existing
    where existing.supply_list_id = p_target_list_id
      and existing.id <> p_item_id
      and existing.source_present
      and existing.canonical_key = target_item.canonical_key
  ) into target_had_same_canonical;

  order_fields_changed :=
    target_item.ordered_amount is distinct from p_ordered_amount
    or target_item.ordered_unit is distinct from normalized_ordered_unit
    or target_item.package_note is distinct from normalized_package_note;

  update public.supply_list_items
  set
    supply_list_id = p_target_list_id,
    ordered_amount = p_ordered_amount,
    ordered_unit = normalized_ordered_unit,
    package_note = normalized_package_note,
    comment = normalized_comment,
    completed = p_completed,
    manually_moved = true,
    order_source_kind = case
      when order_fields_changed then
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
      when order_fields_changed then null
      else supplier_order_source_item_id
    end,
    supplier_order_account_id = case
      when order_fields_changed then null
      else supplier_order_account_id
    end,
    supplier_order_product_id = case
      when order_fields_changed then null
      else supplier_order_product_id
    end,
    supplier_order_total_units = case
      when order_fields_changed then null
      else supplier_order_total_units
    end,
    supplier_order_product_fingerprint = case
      when order_fields_changed then null
      else supplier_order_product_fingerprint
    end,
    manual_order_source_item_id = case
      when order_fields_changed then null
      else manual_order_source_item_id
    end,
    manual_order_total_amount = case
      when order_fields_changed then null
      else manual_order_total_amount
    end,
    manual_order_unit = case
      when order_fields_changed then null
      else manual_order_unit
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
    'delivery_item_moved',
    'supply_list_item',
    p_item_id::text,
    jsonb_build_object(
      'camp_id', target_item.camp_id,
      'item_key', target_item.item_key,
      'canonical_key', target_item.canonical_key,
      'source_line_count', jsonb_array_length(target_item.source_line_keys),
      'from_list_id', source_list.id,
      'from_list_key', source_list.list_key,
      'to_list_id', target_list.id,
      'to_list_key', target_list.list_key,
      'target_had_same_canonical', target_had_same_canonical,
      'order_fields_changed', order_fields_changed,
      'base_version', p_expected_version,
      'new_version', next_version,
      'completed', p_completed
    )
  );

  return next_version;
end;
$$;

revoke all on function public.move_delivery_item(
  uuid, uuid, bigint, numeric, text, text, text, boolean
) from public, anon;
grant execute on function public.move_delivery_item(
  uuid, uuid, bigint, numeric, text, text, text, boolean
) to authenticated;

-- Keep the original signature for clients that have not refreshed yet. It now
-- delegates to the atomic implementation and therefore keeps the same locking,
-- identity and audit behaviour.
create or replace function public.move_delivery_item(
  p_item_id uuid,
  p_target_list_id uuid,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_item public.supply_list_items%rowtype;
begin
  select item.*
  into target_item
  from public.supply_list_items as item
  where item.id = p_item_id;

  if not found then
    raise exception 'Supply item not found' using errcode = '42501';
  end if;

  return public.move_delivery_item(
    p_item_id,
    p_target_list_id,
    p_expected_version,
    target_item.ordered_amount,
    target_item.ordered_unit,
    target_item.package_note,
    target_item.comment,
    target_item.completed
  );
end;
$$;

revoke all on function public.move_delivery_item(uuid, uuid, bigint)
  from public, anon;
grant execute on function public.move_delivery_item(uuid, uuid, bigint)
  to authenticated;
