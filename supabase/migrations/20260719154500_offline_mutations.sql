create type public.supply_mutation_status as enum ('applied', 'conflict');

create table public.supply_item_mutations (
  client_mutation_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  camp_id uuid not null,
  item_id uuid not null references public.supply_list_items(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  request_digest text not null check (length(request_digest) = 64),
  base_version bigint not null check (base_version > 0),
  base_values jsonb not null check (jsonb_typeof(base_values) = 'object'),
  changes jsonb not null check (jsonb_typeof(changes) = 'object'),
  status public.supply_mutation_status not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  unique (organization_id, actor_user_id, client_mutation_id),
  constraint supply_item_mutations_camp_fk foreign key (organization_id, camp_id)
    references public.camps (organization_id, id) on delete cascade
);

create index supply_item_mutations_item_idx
  on public.supply_item_mutations (organization_id, camp_id, item_id, created_at);

alter table public.supply_item_mutations enable row level security;
revoke all on public.supply_item_mutations from authenticated, anon;
grant select on public.supply_item_mutations to authenticated;
create policy supply_item_mutations_select_own
  on public.supply_item_mutations for select to authenticated
  using (actor_user_id = (select auth.uid()) and public.is_org_member(organization_id));

create function public.apply_supply_item_mutation(
  p_organization_id uuid,
  p_camp_id uuid,
  p_item_id uuid,
  p_client_mutation_id uuid,
  p_base_version bigint,
  p_base_values jsonb,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_mutation public.supply_item_mutations%rowtype;
  target_item public.supply_list_items%rowtype;
  request_digest text;
  current_values jsonb;
  conflict_fields jsonb;
  mutation_result jsonb;
  next_version bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  request_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id', p_organization_id,
    'camp_id', p_camp_id,
    'item_id', p_item_id,
    'base_version', p_base_version,
    'base_values', p_base_values,
    'changes', p_changes
  )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtext('supply-mutation:' || p_client_mutation_id::text));

  select mutation.* into existing_mutation
  from public.supply_item_mutations mutation
  where mutation.client_mutation_id = p_client_mutation_id;

  if found then
    if existing_mutation.actor_user_id <> (select auth.uid())
      or existing_mutation.request_digest <> request_digest then
      raise exception 'Client mutation id was already used for another request' using errcode = '22023';
    end if;
    return existing_mutation.result || jsonb_build_object('replayed', true);
  end if;

  if p_base_version is null or p_base_version < 1
    or p_base_values is null or jsonb_typeof(p_base_values) <> 'object'
    or not (p_base_values ?& array['ordered_amount', 'ordered_unit', 'package_note', 'comment', 'completed'])
    or p_base_values - array['ordered_amount', 'ordered_unit', 'package_note', 'comment', 'completed'] <> '{}'::jsonb
    or p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb
    or p_changes - array['ordered_amount', 'ordered_unit', 'package_note', 'comment', 'completed'] <> '{}'::jsonb then
    raise exception 'Mutation shape failed validation' using errcode = '22023';
  end if;
  if p_changes ? 'ordered_amount'
    and jsonb_typeof(p_changes -> 'ordered_amount') not in ('number', 'null') then
    raise exception 'Ordered amount failed validation' using errcode = '22023';
  end if;
  if p_changes ? 'ordered_amount'
    and (p_changes ->> 'ordered_amount')::numeric < 0 then
    raise exception 'Ordered amount must be non-negative' using errcode = '22023';
  end if;
  if p_changes ? 'completed' and jsonb_typeof(p_changes -> 'completed') <> 'boolean' then
    raise exception 'Completed failed validation' using errcode = '22023';
  end if;
  if length(coalesce(p_changes ->> 'ordered_unit', '')) > 40
    or length(coalesce(p_changes ->> 'package_note', '')) > 240
    or length(coalesce(p_changes ->> 'comment', '')) > 1000 then
    raise exception 'Mutation text is too long' using errcode = '22023';
  end if;

  select item.* into target_item
  from public.supply_list_items item
  where item.id = p_item_id
    and item.organization_id = p_organization_id
    and item.camp_id = p_camp_id
  for update;

  if not found or not public.is_org_member(p_organization_id) then
    raise exception 'Supply item not found' using errcode = '42501';
  end if;

  current_values := jsonb_build_object(
    'ordered_amount', target_item.ordered_amount,
    'ordered_unit', target_item.ordered_unit,
    'package_note', target_item.package_note,
    'comment', target_item.comment,
    'completed', target_item.completed
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'field', changed_field,
    'base', p_base_values -> changed_field,
    'server', current_values -> changed_field,
    'client', p_changes -> changed_field
  ) order by changed_field), '[]'::jsonb)
  into conflict_fields
  from jsonb_object_keys(p_changes) changed_field
  where current_values -> changed_field is distinct from p_base_values -> changed_field
    and current_values -> changed_field is distinct from p_changes -> changed_field;

  if jsonb_array_length(conflict_fields) > 0 then
    mutation_result := jsonb_build_object(
      'status', 'conflict',
      'replayed', false,
      'item_id', p_item_id,
      'server_version', target_item.row_version,
      'server_values', current_values,
      'conflicts', conflict_fields
    );

    insert into public.supply_item_mutations (
      client_mutation_id, organization_id, camp_id, item_id, actor_user_id,
      request_digest, base_version, base_values, changes, status, result
    ) values (
      p_client_mutation_id, p_organization_id, p_camp_id, p_item_id, (select auth.uid()),
      request_digest, p_base_version, p_base_values, p_changes, 'conflict', mutation_result
    );

    return mutation_result;
  end if;

  update public.supply_list_items
  set ordered_amount = case when p_changes ? 'ordered_amount'
        then (p_changes ->> 'ordered_amount')::numeric else target_item.ordered_amount end,
      ordered_unit = case when p_changes ? 'ordered_unit'
        then nullif(trim(p_changes ->> 'ordered_unit'), '') else target_item.ordered_unit end,
      package_note = case when p_changes ? 'package_note'
        then nullif(trim(p_changes ->> 'package_note'), '') else target_item.package_note end,
      comment = case when p_changes ? 'comment'
        then nullif(trim(p_changes ->> 'comment'), '') else target_item.comment end,
      completed = case when p_changes ? 'completed'
        then (p_changes ->> 'completed')::boolean else target_item.completed end,
      row_version = target_item.row_version + 1,
      updated_by = (select auth.uid())
  where id = p_item_id
  returning row_version into next_version;

  select jsonb_build_object(
    'ordered_amount', item.ordered_amount,
    'ordered_unit', item.ordered_unit,
    'package_note', item.package_note,
    'comment', item.comment,
    'completed', item.completed
  ) into current_values
  from public.supply_list_items item
  where item.id = p_item_id;

  mutation_result := jsonb_build_object(
    'status', 'applied',
    'replayed', false,
    'item_id', p_item_id,
    'server_version', next_version,
    'server_values', current_values,
    'conflicts', '[]'::jsonb
  );

  insert into public.supply_item_mutations (
    client_mutation_id, organization_id, camp_id, item_id, actor_user_id,
    request_digest, base_version, base_values, changes, status, result
  ) values (
    p_client_mutation_id, p_organization_id, p_camp_id, p_item_id, (select auth.uid()),
    request_digest, p_base_version, p_base_values, p_changes, 'applied', mutation_result
  );

  insert into public.audit_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_organization_id, (select auth.uid()), 'supply_item_mutation_applied',
    'supply_list_item', p_item_id::text,
    jsonb_build_object(
      'camp_id', p_camp_id,
      'client_mutation_id', p_client_mutation_id,
      'base_version', p_base_version,
      'new_version', next_version,
      'changed_fields', (select jsonb_agg(field order by field) from jsonb_object_keys(p_changes) field)
    )
  );

  return mutation_result;
end;
$$;

revoke all on function public.apply_supply_item_mutation(uuid, uuid, uuid, uuid, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.apply_supply_item_mutation(uuid, uuid, uuid, uuid, bigint, jsonb, jsonb) to authenticated;
