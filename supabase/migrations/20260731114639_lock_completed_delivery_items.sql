-- A checked delivery row represents a physical hand-off in its current delivery.
-- It must be explicitly reopened before its operational details or placement can
-- be corrected; a completed delivery is immutable.

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
  target_status public.supply_list_status;
  next_version bigint;
  next_order_source_kind text;
  order_fields_changed boolean;
  normalized_ordered_unit text := nullif(trim(p_ordered_unit), '');
  normalized_package_note text := nullif(trim(p_package_note), '');
  normalized_comment text := nullif(trim(p_comment), '');
begin
  select item.* into target_item
  from public.supply_list_items as item
  where item.id = p_item_id
  for update;

  if not found or not public.is_org_member(target_item.organization_id) then
    raise exception 'Supply item not found' using errcode = '42501';
  end if;
  select list.kind, list.status into target_kind, target_status
  from public.supply_lists as list
  where list.id = target_item.supply_list_id
    and list.organization_id = target_item.organization_id
    and list.camp_id = target_item.camp_id
  for update;
  if not found then
    raise exception 'Supply item not found' using errcode = '42501';
  end if;
  if target_kind = 'delivery' and target_status = 'complete' then
    raise exception 'Completed delivery cannot be changed' using errcode = '22023';
  end if;
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
  if target_kind = 'delivery' and target_item.completed then
    if p_completed is distinct from false
      or target_item.ordered_amount is distinct from p_ordered_amount
      or target_item.ordered_unit is distinct from normalized_ordered_unit
      or target_item.package_note is distinct from normalized_package_note
      or target_item.comment is distinct from normalized_comment then
      raise exception 'Completed delivery item must be reopened before it can be changed' using errcode = '22023';
    end if;
  end if;

  order_fields_changed := target_item.ordered_amount is distinct from p_ordered_amount
    or target_item.ordered_unit is distinct from normalized_ordered_unit
    or target_item.package_note is distinct from normalized_package_note;

  if target_kind = 'delivery' and target_item.completed and not p_completed then
    perform set_config('app.reopen_supply_item_id', p_item_id::text, true);
  end if;

  update public.supply_list_items
  set
    ordered_amount = p_ordered_amount,
    ordered_unit = normalized_ordered_unit,
    package_note = normalized_package_note,
    comment = normalized_comment,
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
    supplier_order_synthetic_fixture = case when order_fields_changed and target_kind = 'delivery' then false else supplier_order_synthetic_fixture end,
    manual_order_source_item_id = case when order_fields_changed and target_kind = 'delivery' then null else manual_order_source_item_id end,
    manual_order_total_amount = case when order_fields_changed and target_kind = 'delivery' then null else manual_order_total_amount end,
    manual_order_unit = case when order_fields_changed and target_kind = 'delivery' then null else manual_order_unit end,
    row_version = row_version + 1,
    updated_by = (select auth.uid())
  where id = p_item_id
  returning row_version, order_source_kind
  into next_version, next_order_source_kind;
  perform set_config('app.reopen_supply_item_id', '', true);
  if next_version is null then
    raise exception 'Completed delivery item write was rejected' using errcode = '22023';
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    target_item.organization_id, (select auth.uid()), 'supply_item_updated',
    'supply_list_item', p_item_id::text,
    jsonb_build_object(
      'camp_id', target_item.camp_id,
      'base_version', p_expected_version,
      'new_version', next_version,
      'completed', p_completed,
      'previous_completed', target_item.completed,
      'order_source_kind', next_order_source_kind
    )
  );
  return next_version;
end;
$$;

create or replace function public.move_delivery_item(
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
  select item.organization_id, item.camp_id into target_organization_id, target_camp_id
  from public.supply_list_items as item where item.id = p_item_id;
  if not found or not public.is_org_member(target_organization_id) then
    raise exception 'Supply item not found' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'supply:' || target_organization_id::text || ':' || target_camp_id::text
  ));
  select item.* into target_item from public.supply_list_items as item
  where item.id = p_item_id for update;
  if not found or target_item.organization_id <> target_organization_id
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
  if target_item.completed or p_completed then
    raise exception 'Completed delivery item must be reopened before moving' using errcode = '22023';
  end if;
  if p_ordered_amount is not null and p_ordered_amount < 0 then
    raise exception 'Ordered amount must be non-negative' using errcode = '22023';
  end if;
  if length(coalesce(p_ordered_unit, '')) > 40
    or length(coalesce(p_package_note, '')) > 240
    or length(coalesce(p_comment, '')) > 1000 then
    raise exception 'Supply item text is too long' using errcode = '22023';
  end if;

  perform 1 from public.supply_lists as list
  where list.id in (target_item.supply_list_id, p_target_list_id)
  order by list.id for update;
  select list.* into source_list from public.supply_lists as list where list.id = target_item.supply_list_id;
  select list.* into target_list from public.supply_lists as list where list.id = p_target_list_id;
  if source_list.id is null or source_list.kind <> 'delivery'
    or target_list.id is null or target_list.kind <> 'delivery'
    or target_list.organization_id <> target_item.organization_id
    or target_list.camp_id <> target_item.camp_id or not target_list.source_present then
    raise exception 'Target delivery not found' using errcode = '22023';
  end if;
  if source_list.status = 'complete' then
    raise exception 'Completed source delivery cannot be changed' using errcode = '22023';
  end if;
  if target_list.status = 'complete' then
    raise exception 'Completed target delivery cannot receive items' using errcode = '22023';
  end if;

  select exists (select 1 from public.supply_list_items as existing
    where existing.supply_list_id = p_target_list_id and existing.id <> p_item_id
      and existing.source_present and existing.canonical_key = target_item.canonical_key)
  into target_had_same_canonical;
  order_fields_changed := target_item.ordered_amount is distinct from p_ordered_amount
    or target_item.ordered_unit is distinct from normalized_ordered_unit
    or target_item.package_note is distinct from normalized_package_note;

  update public.supply_list_items set
    supply_list_id = p_target_list_id, ordered_amount = p_ordered_amount,
    ordered_unit = normalized_ordered_unit, package_note = normalized_package_note,
    comment = normalized_comment, completed = false, manually_moved = true,
    order_source_kind = case when order_fields_changed then case when p_ordered_amount is null
      and normalized_ordered_unit is null and normalized_package_note is null then null else 'manual' end
      else order_source_kind end,
    supplier_order_source_item_id = case when order_fields_changed then null else supplier_order_source_item_id end,
    supplier_order_account_id = case when order_fields_changed then null else supplier_order_account_id end,
    supplier_order_product_id = case when order_fields_changed then null else supplier_order_product_id end,
    supplier_order_total_units = case when order_fields_changed then null else supplier_order_total_units end,
    supplier_order_product_fingerprint = case when order_fields_changed then null else supplier_order_product_fingerprint end,
    supplier_order_synthetic_fixture = case when order_fields_changed then false else supplier_order_synthetic_fixture end,
    manual_order_source_item_id = case when order_fields_changed then null else manual_order_source_item_id end,
    manual_order_total_amount = case when order_fields_changed then null else manual_order_total_amount end,
    manual_order_unit = case when order_fields_changed then null else manual_order_unit end,
    row_version = row_version + 1, updated_by = (select auth.uid())
  where id = p_item_id returning row_version into next_version;

  insert into public.audit_events (organization_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (target_item.organization_id, (select auth.uid()), 'delivery_item_moved', 'supply_list_item', p_item_id::text,
    jsonb_build_object('camp_id', target_item.camp_id, 'item_key', target_item.item_key,
      'canonical_key', target_item.canonical_key, 'source_line_count', jsonb_array_length(target_item.source_line_keys),
      'from_list_id', source_list.id, 'from_list_key', source_list.list_key,
      'to_list_id', target_list.id, 'to_list_key', target_list.list_key,
      'target_had_same_canonical', target_had_same_canonical, 'order_fields_changed', order_fields_changed,
      'base_version', p_expected_version, 'new_version', next_version, 'completed', false));
  return next_version;
end;
$$;

create or replace function public.move_delivery_item(
  p_item_id uuid, p_target_list_id uuid, p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare target_item public.supply_list_items%rowtype;
begin
  select item.* into target_item from public.supply_list_items as item where item.id = p_item_id;
  if not found then raise exception 'Supply item not found' using errcode = '42501'; end if;
  return public.move_delivery_item(p_item_id, p_target_list_id, p_expected_version,
    target_item.ordered_amount, target_item.ordered_unit, target_item.package_note,
    target_item.comment, target_item.completed);
end;
$$;

create or replace function public.apply_supply_item_mutation(
  p_organization_id uuid, p_camp_id uuid, p_item_id uuid, p_client_mutation_id uuid,
  p_base_version bigint, p_base_values jsonb, p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_mutation public.supply_item_mutations%rowtype;
  target_item public.supply_list_items%rowtype;
  target_kind public.supply_list_kind;
  target_status public.supply_list_status;
  request_digest text;
  current_values jsonb;
  conflict_fields jsonb;
  mutation_result jsonb;
  next_version bigint;
  next_ordered_amount numeric;
  next_ordered_unit text;
  next_package_note text;
  next_comment text;
  next_completed boolean;
  order_fields_changed boolean;
  policy_reason text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  request_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id', p_organization_id, 'camp_id', p_camp_id, 'item_id', p_item_id,
    'base_version', p_base_version, 'base_values', p_base_values, 'changes', p_changes
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(pg_catalog.hashtext('supply-mutation:' || p_client_mutation_id::text));
  select mutation.* into existing_mutation from public.supply_item_mutations mutation
  where mutation.client_mutation_id = p_client_mutation_id;
  if found then
    if existing_mutation.actor_user_id <> (select auth.uid()) or existing_mutation.request_digest <> request_digest then
      raise exception 'Client mutation id was already used for another request' using errcode = '22023';
    end if;
    return existing_mutation.result || jsonb_build_object('replayed', true);
  end if;
  if p_base_version is null or p_base_version < 1 or p_base_values is null
    or jsonb_typeof(p_base_values) <> 'object'
    or not (p_base_values ?& array['ordered_amount', 'ordered_unit', 'package_note', 'comment', 'completed'])
    or p_base_values - array['ordered_amount', 'ordered_unit', 'package_note', 'comment', 'completed'] <> '{}'::jsonb
    or p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb
    or p_changes - array['ordered_amount', 'ordered_unit', 'package_note', 'comment', 'completed'] <> '{}'::jsonb then
    raise exception 'Mutation shape failed validation' using errcode = '22023';
  end if;
  if p_changes ? 'ordered_amount' and jsonb_typeof(p_changes -> 'ordered_amount') not in ('number', 'null') then
    raise exception 'Ordered amount failed validation' using errcode = '22023'; end if;
  if p_changes ? 'ordered_amount' and (p_changes ->> 'ordered_amount')::numeric < 0 then
    raise exception 'Ordered amount must be non-negative' using errcode = '22023'; end if;
  if p_changes ? 'completed' and jsonb_typeof(p_changes -> 'completed') <> 'boolean' then
    raise exception 'Completed failed validation' using errcode = '22023'; end if;
  if length(coalesce(p_changes ->> 'ordered_unit', '')) > 40 or length(coalesce(p_changes ->> 'package_note', '')) > 240
    or length(coalesce(p_changes ->> 'comment', '')) > 1000 then
    raise exception 'Mutation text is too long' using errcode = '22023'; end if;
  select item.* into target_item from public.supply_list_items item
  where item.id = p_item_id and item.organization_id = p_organization_id and item.camp_id = p_camp_id for update;
  if not found or not public.is_org_member(p_organization_id) then
    raise exception 'Supply item not found' using errcode = '42501'; end if;
  select list.kind, list.status into target_kind, target_status from public.supply_lists list
  where list.id = target_item.supply_list_id and list.organization_id = p_organization_id and list.camp_id = p_camp_id for update;
  if not found then raise exception 'Supply item not found' using errcode = '42501'; end if;
  current_values := jsonb_build_object('ordered_amount', target_item.ordered_amount, 'ordered_unit', target_item.ordered_unit,
    'package_note', target_item.package_note, 'comment', target_item.comment, 'completed', target_item.completed);
  if target_kind = 'delivery' and target_status = 'complete' then
    policy_reason := 'finalised_delivery';
  elsif target_kind = 'delivery' and target_item.completed
    and p_changes is distinct from '{"completed":false}'::jsonb then
    policy_reason := 'reopen_required';
  end if;
  if policy_reason is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'field', changed_field,
      'base', p_base_values -> changed_field,
      'server', current_values -> changed_field,
      'client', p_changes -> changed_field
    ) order by changed_field), '[]'::jsonb)
    into conflict_fields
    from jsonb_object_keys(p_changes) changed_field;
    mutation_result := jsonb_build_object(
      'status', 'conflict',
      'replayed', false,
      'policy_reason', policy_reason,
      'item_id', p_item_id,
      'server_version', target_item.row_version,
      'server_values', current_values,
      'conflicts', conflict_fields
    );
    insert into public.supply_item_mutations (
      client_mutation_id, organization_id, camp_id, item_id, actor_user_id,
      request_digest, base_version, base_values, changes, status, result
    ) values (
      p_client_mutation_id, p_organization_id, p_camp_id, p_item_id,
      (select auth.uid()), request_digest, p_base_version, p_base_values,
      p_changes, 'conflict', mutation_result
    );
    return mutation_result;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('field', changed_field, 'base', p_base_values -> changed_field,
    'server', current_values -> changed_field, 'client', p_changes -> changed_field) order by changed_field), '[]'::jsonb)
  into conflict_fields from jsonb_object_keys(p_changes) changed_field
  where current_values -> changed_field is distinct from p_base_values -> changed_field
    and current_values -> changed_field is distinct from p_changes -> changed_field;
  if jsonb_array_length(conflict_fields) > 0 then
    mutation_result := jsonb_build_object('status', 'conflict', 'replayed', false, 'item_id', p_item_id,
      'server_version', target_item.row_version, 'server_values', current_values, 'conflicts', conflict_fields);
    insert into public.supply_item_mutations (client_mutation_id, organization_id, camp_id, item_id, actor_user_id,
      request_digest, base_version, base_values, changes, status, result)
    values (p_client_mutation_id, p_organization_id, p_camp_id, p_item_id, (select auth.uid()), request_digest,
      p_base_version, p_base_values, p_changes, 'conflict', mutation_result);
    return mutation_result;
  end if;
  next_ordered_amount := case when p_changes ? 'ordered_amount' then (p_changes ->> 'ordered_amount')::numeric else target_item.ordered_amount end;
  next_ordered_unit := case when p_changes ? 'ordered_unit' then nullif(trim(p_changes ->> 'ordered_unit'), '') else target_item.ordered_unit end;
  next_package_note := case when p_changes ? 'package_note' then nullif(trim(p_changes ->> 'package_note'), '') else target_item.package_note end;
  next_comment := case when p_changes ? 'comment' then nullif(trim(p_changes ->> 'comment'), '') else target_item.comment end;
  next_completed := case when p_changes ? 'completed' then (p_changes ->> 'completed')::boolean else target_item.completed end;
  order_fields_changed := target_item.ordered_amount is distinct from next_ordered_amount
    or target_item.ordered_unit is distinct from next_ordered_unit
    or target_item.package_note is distinct from next_package_note;
  if target_kind = 'delivery' and target_item.completed and not next_completed then
    perform set_config('app.reopen_supply_item_id', p_item_id::text, true);
  end if;
  update public.supply_list_items set
    ordered_amount = next_ordered_amount,
    ordered_unit = next_ordered_unit,
    package_note = next_package_note,
    comment = next_comment,
    completed = next_completed,
    order_source_kind = case
      when order_fields_changed and target_kind = 'purchase'
        and next_ordered_amount is not null then 'manual'
      when order_fields_changed and target_kind = 'purchase' then null
      when order_fields_changed and target_kind = 'delivery' then
        case when next_ordered_amount is null and next_ordered_unit is null
          and next_package_note is null then null else 'manual' end
      else order_source_kind
    end,
    supplier_order_source_item_id = case when order_fields_changed and target_kind = 'delivery' then null else supplier_order_source_item_id end,
    supplier_order_account_id = case when order_fields_changed and target_kind = 'delivery' then null else supplier_order_account_id end,
    supplier_order_product_id = case when order_fields_changed and target_kind = 'delivery' then null else supplier_order_product_id end,
    supplier_order_total_units = case when order_fields_changed and target_kind = 'delivery' then null else supplier_order_total_units end,
    supplier_order_product_fingerprint = case when order_fields_changed and target_kind = 'delivery' then null else supplier_order_product_fingerprint end,
    supplier_order_synthetic_fixture = case when order_fields_changed and target_kind = 'delivery' then false else supplier_order_synthetic_fixture end,
    manual_order_source_item_id = case when order_fields_changed and target_kind = 'delivery' then null else manual_order_source_item_id end,
    manual_order_total_amount = case when order_fields_changed and target_kind = 'delivery' then null else manual_order_total_amount end,
    manual_order_unit = case when order_fields_changed and target_kind = 'delivery' then null else manual_order_unit end,
    row_version = target_item.row_version + 1, updated_by = (select auth.uid()) where id = p_item_id
  returning row_version into next_version;
  perform set_config('app.reopen_supply_item_id', '', true);
  if next_version is null then
    raise exception 'Completed delivery item write was rejected' using errcode = '22023';
  end if;
  select jsonb_build_object('ordered_amount', item.ordered_amount, 'ordered_unit', item.ordered_unit,
    'package_note', item.package_note, 'comment', item.comment, 'completed', item.completed) into current_values
  from public.supply_list_items item where item.id = p_item_id;
  mutation_result := jsonb_build_object('status', 'applied', 'replayed', false, 'item_id', p_item_id,
    'server_version', next_version, 'server_values', current_values, 'conflicts', '[]'::jsonb);
  insert into public.supply_item_mutations (client_mutation_id, organization_id, camp_id, item_id, actor_user_id,
    request_digest, base_version, base_values, changes, status, result)
  values (p_client_mutation_id, p_organization_id, p_camp_id, p_item_id, (select auth.uid()), request_digest,
    p_base_version, p_base_values, p_changes, 'applied', mutation_result);
  insert into public.audit_events (organization_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (p_organization_id, (select auth.uid()), 'supply_item_mutation_applied', 'supply_list_item', p_item_id::text,
    jsonb_build_object('camp_id', p_camp_id, 'client_mutation_id', p_client_mutation_id,
      'base_version', p_base_version, 'new_version', next_version,
      'previous_completed', target_item.completed,
      'completed', next_completed,
      'reopened', target_item.completed and not next_completed,
      'changed_fields', (select jsonb_agg(field order by field) from jsonb_object_keys(p_changes) field)));
  return mutation_result;
end;
$$;

revoke all on function public.update_supply_item(uuid, bigint, numeric, text, text, text, boolean) from public, anon;
revoke all on function public.move_delivery_item(uuid, uuid, bigint, numeric, text, text, text, boolean) from public, anon;
revoke all on function public.move_delivery_item(uuid, uuid, bigint) from public, anon;
revoke all on function public.apply_supply_item_mutation(uuid, uuid, uuid, uuid, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.update_supply_item(uuid, bigint, numeric, text, text, text, boolean) to authenticated;
grant execute on function public.move_delivery_item(uuid, uuid, bigint, numeric, text, text, text, boolean) to authenticated;
grant execute on function public.move_delivery_item(uuid, uuid, bigint) to authenticated;
grant execute on function public.apply_supply_item_mutation(uuid, uuid, uuid, uuid, bigint, jsonb, jsonb) to authenticated;

-- Regeneration and allocation are set-based background writers.  They must
-- keep progressing for active/future deliveries, but may not rewrite an
-- already finalised delivery (including source presence and generated rows).
-- Returning NULL skips only that row; it does not abort the camp-wide writer.
create function public.skip_completed_delivery_background_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_kind public.supply_list_kind;
  source_status public.supply_list_status;
  target_kind public.supply_list_kind;
  target_status public.supply_list_status;
begin
  if tg_table_name = 'supply_lists' then
    if old.kind = 'delivery' and old.status = 'complete' then
      return null;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    select list.kind, list.status into source_kind, source_status
    from public.supply_lists as list
    where list.id = old.supply_list_id
      and list.organization_id = old.organization_id
      and list.camp_id = old.camp_id
    for share;
    -- A cascading parent delete has already made the parent invisible; allow
    -- that cleanup. Direct writers cannot remove receipt history.
    if found and source_kind = 'delivery'
      and (source_status = 'complete' or old.completed) then
      return null;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    select list.kind, list.status into target_kind, target_status
    from public.supply_lists as list
    where list.id = new.supply_list_id
      and list.organization_id = new.organization_id
      and list.camp_id = new.camp_id
    for share;
    if found and target_kind = 'delivery' and target_status = 'complete' then
      return null;
    end if;
  elsif tg_op = 'UPDATE' then
    select list.kind, list.status into source_kind, source_status
    from public.supply_lists as list
    where list.id = old.supply_list_id
      and list.organization_id = old.organization_id
      and list.camp_id = old.camp_id
    for share;

    if found and source_kind = 'delivery' and source_status = 'complete' then
      return null;
    end if;

    if found and source_kind = 'delivery' and old.completed then
      -- The only permitted change to a checked row is an explicit reopen. The
      -- public RPC validates and audits it; set-based writers trying to alter
      -- receipt history are skipped row by row.
      if current_setting('app.reopen_supply_item_id', true) = old.id::text
        and not new.completed then
        return new;
      end if;
      return null;
    end if;

    if new.supply_list_id = old.supply_list_id
      and new.organization_id = old.organization_id
      and new.camp_id = old.camp_id then
      target_kind := source_kind;
      target_status := source_status;
    else
      select list.kind, list.status into target_kind, target_status
      from public.supply_lists as list
      where list.id = new.supply_list_id
        and list.organization_id = new.organization_id
        and list.camp_id = new.camp_id
      for share;
    end if;
    if target_kind = 'delivery' and target_status = 'complete' then
      return null;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.skip_completed_delivery_background_write()
  from public, anon, authenticated;

create trigger supply_lists_skip_completed_delivery_background_write
before update on public.supply_lists
for each row execute function public.skip_completed_delivery_background_write();

create trigger supply_list_items_skip_completed_delivery_background_write
before insert or update or delete on public.supply_list_items
for each row execute function public.skip_completed_delivery_background_write();

-- A completed delivery can be inspected and exported, but not silently
-- reopened through the generic status RPC.  Keep the no-op idempotent and make
-- an attempted backwards transition explicit.
alter function public.set_supply_list_status(
  uuid, bigint, public.supply_list_status
) rename to set_supply_list_status_pre_completed_delivery_lock;
revoke all on function public.set_supply_list_status_pre_completed_delivery_lock(
  uuid, bigint, public.supply_list_status
) from public, anon, authenticated;

create function public.set_supply_list_status(
  p_list_id uuid,
  p_expected_version bigint,
  p_status public.supply_list_status
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_list public.supply_lists%rowtype;
begin
  select list.* into target_list
  from public.supply_lists as list
  where list.id = p_list_id;

  if not found or not public.is_org_member(target_list.organization_id) then
    raise exception 'Supply list not found' using errcode = '42501';
  end if;
  if target_list.version <> p_expected_version then
    raise exception 'Supply list has changed' using errcode = '40001';
  end if;
  if target_list.kind = 'delivery' and target_list.status = 'complete' then
    if p_status = 'complete' then return target_list.version; end if;
    raise exception 'Completed delivery cannot be reopened' using errcode = '22023';
  end if;

  return public.set_supply_list_status_pre_completed_delivery_lock(
    p_list_id, p_expected_version, p_status
  );
end;
$$;

revoke all on function public.set_supply_list_status(
  uuid, bigint, public.supply_list_status
) from public, anon;
grant execute on function public.set_supply_list_status(
  uuid, bigint, public.supply_list_status
) to authenticated;
