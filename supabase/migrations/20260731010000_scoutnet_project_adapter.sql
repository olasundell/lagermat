-- Extend the secure Scoutnet connection with the bounded mapping variants and
-- camp context needed by the server-only Project API adapter.

create or replace function app_private.valid_scoutnet_question_mapping(
  mapping jsonb
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  allowed_keys constant text[] := array[
    'group_question_id',
    'division_question_id',
    'patrol_question_id',
    'special_diet_question_id',
    'special_diet_question_ids',
    'attendance_intervals',
    'attendance_days'
  ];
  scalar_keys constant text[] := array[
    'group_question_id',
    'division_question_id',
    'patrol_question_id',
    'special_diet_question_id'
  ];
  mapping_key text;
  question_id text;
  interval_entry jsonb;
  day_entry jsonb;
  seen_question_ids text[] := array[]::text[];
  seen_dates text[] := array[]::text[];
begin
  if mapping is null
    or jsonb_typeof(mapping) <> 'object'
    or octet_length(mapping::text) > 16384 then
    return false;
  end if;

  for mapping_key in
    select key_entry.key
    from jsonb_object_keys(mapping) as key_entry(key)
  loop
    if not (mapping_key = any(allowed_keys)) then
      return false;
    end if;
  end loop;

  foreach mapping_key in array scalar_keys
  loop
    if mapping ? mapping_key then
      if jsonb_typeof(mapping -> mapping_key) <> 'string' then
        return false;
      end if;
      question_id := mapping ->> mapping_key;
      if question_id !~ '^[0-9]{1,20}$'
        or question_id = any(seen_question_ids) then
        return false;
      end if;
      seen_question_ids := array_append(seen_question_ids, question_id);
    end if;
  end loop;

  if mapping ? 'special_diet_question_id'
    and mapping ? 'special_diet_question_ids' then
    return false;
  end if;

  if mapping ? 'special_diet_question_ids' then
    if jsonb_typeof(mapping -> 'special_diet_question_ids') <> 'array'
      or jsonb_array_length(mapping -> 'special_diet_question_ids')
        not between 1 and 8 then
      return false;
    end if;
    for interval_entry in
      select value
      from jsonb_array_elements(
        mapping -> 'special_diet_question_ids'
      ) as diet_entry(value)
    loop
      if jsonb_typeof(interval_entry) <> 'string' then
        return false;
      end if;
      question_id := trim(both '"' from interval_entry::text);
      if question_id !~ '^[0-9]{1,20}$'
        or question_id = any(seen_question_ids) then
        return false;
      end if;
      seen_question_ids := array_append(seen_question_ids, question_id);
    end loop;
  end if;

  if mapping ? 'attendance_intervals'
    and mapping ? 'attendance_days' then
    return false;
  end if;

  if mapping ? 'attendance_intervals' then
    if jsonb_typeof(mapping -> 'attendance_intervals') <> 'array'
      or jsonb_array_length(mapping -> 'attendance_intervals')
        not between 1 and 8 then
      return false;
    end if;

    for interval_entry in
      select value
      from jsonb_array_elements(
        mapping -> 'attendance_intervals'
      ) as attendance_entry(value)
    loop
      if jsonb_typeof(interval_entry) <> 'object'
        or (
          select count(*)
          from jsonb_object_keys(interval_entry)
        ) <> 2
        or not (
          interval_entry ? 'starts_at_question_id'
          and interval_entry ? 'ends_at_question_id'
        )
        or jsonb_typeof(
          interval_entry -> 'starts_at_question_id'
        ) <> 'string'
        or jsonb_typeof(
          interval_entry -> 'ends_at_question_id'
        ) <> 'string' then
        return false;
      end if;

      question_id := interval_entry ->> 'starts_at_question_id';
      if question_id !~ '^[0-9]{1,20}$'
        or question_id = any(seen_question_ids) then
        return false;
      end if;
      seen_question_ids := array_append(seen_question_ids, question_id);

      question_id := interval_entry ->> 'ends_at_question_id';
      if question_id !~ '^[0-9]{1,20}$'
        or question_id = any(seen_question_ids) then
        return false;
      end if;
      seen_question_ids := array_append(seen_question_ids, question_id);
    end loop;
  end if;

  if mapping ? 'attendance_days' then
    if jsonb_typeof(mapping -> 'attendance_days') <> 'array'
      or jsonb_array_length(mapping -> 'attendance_days')
        not between 1 and 62 then
      return false;
    end if;

    for day_entry in
      select value
      from jsonb_array_elements(
        mapping -> 'attendance_days'
      ) as attendance_day(value)
    loop
      if jsonb_typeof(day_entry) <> 'object'
        or (
          select count(*)
          from jsonb_object_keys(day_entry)
        ) <> 2
        or not (
          day_entry ? 'question_id'
          and day_entry ? 'date'
        )
        or jsonb_typeof(day_entry -> 'question_id') <> 'string'
        or jsonb_typeof(day_entry -> 'date') <> 'string' then
        return false;
      end if;

      question_id := day_entry ->> 'question_id';
      if question_id !~ '^[0-9]{1,20}$'
        or question_id = any(seen_question_ids) then
        return false;
      end if;
      seen_question_ids := array_append(seen_question_ids, question_id);

      mapping_key := day_entry ->> 'date';
      if mapping_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or to_char(to_date(mapping_key, 'YYYY-MM-DD'), 'YYYY-MM-DD')
          <> mapping_key
        or mapping_key = any(seen_dates) then
        return false;
      end if;
      seen_dates := array_append(seen_dates, mapping_key);
    end loop;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

-- PostgreSQL cannot replace a table-returning function when its result columns
-- change, so recreate this private server boundary with the camp date context
-- required for conservative attendance fallback.
drop function public.get_scoutnet_connection_credentials(uuid, uuid);

create function public.get_scoutnet_connection_credentials(
  p_actor_user_id uuid,
  p_camp_id uuid
)
returns table (
  connection_id uuid,
  organization_id uuid,
  camp_id uuid,
  project_id text,
  participants_api_key text,
  questions_api_key text,
  question_mapping jsonb,
  starts_on date,
  ends_on date,
  timezone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
begin
  target_organization_id := app_private.require_scoutnet_member(
    p_actor_user_id,
    p_camp_id
  );

  return query
  select
    connection.id,
    connection.organization_id,
    connection.camp_id,
    connection.project_id,
    participants_secret.decrypted_secret,
    questions_secret.decrypted_secret,
    connection.question_mapping,
    camp.starts_on,
    camp.ends_on,
    camp.timezone
  from app_private.scoutnet_connections as connection
  join public.camps as camp
    on camp.organization_id = connection.organization_id
    and camp.id = connection.camp_id
  join vault.decrypted_secrets as participants_secret
    on participants_secret.id = connection.participants_secret_id
  join vault.decrypted_secrets as questions_secret
    on questions_secret.id = connection.questions_secret_id
  where connection.organization_id = target_organization_id
    and connection.camp_id = p_camp_id;

  if not found then
    raise exception 'Scoutnet connection credentials not found'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function app_private.valid_scoutnet_question_mapping(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.get_scoutnet_connection_credentials(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_scoutnet_connection_credentials(uuid, uuid)
  to service_role;
