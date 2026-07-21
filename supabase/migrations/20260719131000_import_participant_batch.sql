alter table public.import_batches
  add constraint import_batches_org_camp_id_unique unique (organization_id, camp_id, id);

alter table public.participants
  add column import_batch_id uuid,
  add constraint participants_import_batch_fk
    foreign key (organization_id, camp_id, import_batch_id)
    references public.import_batches (organization_id, camp_id, id)
    on delete set null;

create index participants_import_batch_idx
  on public.participants (organization_id, camp_id, import_batch_id);

create function public.import_participant_batch(
  p_organization_id uuid,
  p_camp_id uuid,
  p_source_filename text,
  p_source_kind text,
  p_sheet_name text,
  p_column_mapping jsonb,
  p_discarded_columns text[],
  p_excluded_count integer,
  p_error_count integer,
  p_rows jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  new_batch_id uuid := extensions.gen_random_uuid();
  imported_count integer;
begin
  if (select auth.uid()) is null or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.camps camp
    where camp.id = p_camp_id
      and camp.organization_id = p_organization_id
  ) then
    raise exception 'Camp does not belong to organization' using errcode = '42501';
  end if;

  if p_source_kind not in ('xlsx', 'csv') then
    raise exception 'Unsupported import source kind' using errcode = '22023';
  end if;
  if length(trim(p_source_filename)) not between 1 and 255
    or p_source_filename ~ '[/\\]' then
    raise exception 'Invalid source filename' using errcode = '22023';
  end if;
  if length(coalesce(p_sheet_name, '')) > 160 then
    raise exception 'Invalid sheet name' using errcode = '22023';
  end if;
  if jsonb_typeof(p_column_mapping) <> 'array'
    or jsonb_array_length(p_column_mapping) > 250
    or pg_column_size(p_column_mapping) > 100000 then
    raise exception 'Invalid column mapping' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_column_mapping) mapping
    where jsonb_typeof(mapping) <> 'object'
      or (mapping - array['index', 'source', 'target']) <> '{}'::jsonb
      or length(coalesce(mapping ->> 'source', '')) > 200
      or coalesce(mapping ->> 'target', '') not in (
        'ignore', 'display_name', 'division', 'patrol', 'meal_group',
        'registered', 'attendance_days', 'attendance_start', 'attendance_end',
        'food_factor', 'diet_flag', 'diet_note'
      )
  ) then
    raise exception 'Invalid column mapping entry' using errcode = '22023';
  end if;
  if coalesce(array_length(p_discarded_columns, 1), 0) > 250
    or exists (select 1 from unnest(coalesce(p_discarded_columns, array[]::text[])) name where length(name) > 200) then
    raise exception 'Invalid discarded column list' using errcode = '22023';
  end if;
  if p_excluded_count < 0 or p_error_count < 0 then
    raise exception 'Invalid validation counts' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 5000
    or pg_column_size(p_rows) > 5000000 then
    raise exception 'Import must contain between 1 and 5000 sanitized rows' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) row_data
    cross join lateral jsonb_object_keys(row_data) key
    where key not in (
      'source_row', 'display_name', 'division', 'patrol', 'meal_group',
      'food_factor', 'attendance_start', 'attendance_end', 'dietary_note'
    )
  ) then
    raise exception 'Import rows contain a non-persistent field' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as row_data(
      source_row integer,
      display_name text,
      division text,
      patrol text,
      meal_group text,
      food_factor numeric,
      attendance_start timestamptz,
      attendance_end timestamptz,
      dietary_note text
    )
    where row_data.source_row is null
      or length(trim(coalesce(row_data.display_name, ''))) not between 1 and 160
      or length(trim(coalesce(row_data.division, ''))) > 120
      or length(trim(coalesce(row_data.patrol, ''))) > 120
      or length(trim(coalesce(row_data.meal_group, ''))) > 120
      or row_data.food_factor is null
      or row_data.food_factor <= 0
      or row_data.food_factor > 10
      or row_data.attendance_start is null
      or row_data.attendance_end is null
      or row_data.attendance_end <= row_data.attendance_start
      or length(coalesce(row_data.dietary_note, '')) > 2000
  ) then
    raise exception 'Import rows failed server validation' using errcode = '22023';
  end if;

  imported_count := jsonb_array_length(p_rows);

  insert into public.import_batches (
    id,
    organization_id,
    camp_id,
    source_filename,
    source_kind,
    column_mapping,
    validation_summary,
    status,
    imported_by
  ) values (
    new_batch_id,
    p_organization_id,
    p_camp_id,
    trim(p_source_filename),
    p_source_kind,
    p_column_mapping,
    jsonb_build_object(
      'sheet_name', p_sheet_name,
      'accepted', imported_count,
      'excluded', p_excluded_count,
      'errors', p_error_count,
      'discarded_columns', to_jsonb(coalesce(p_discarded_columns, array[]::text[]))
    ),
    'validated',
    (select auth.uid())
  );

  insert into public.camp_groups (organization_id, camp_id, kind, name)
  select p_organization_id, p_camp_id, 'division'::public.group_kind, source.name
  from (
    select min(trim(row_data.division)) as name
    from jsonb_to_recordset(p_rows) as row_data(division text)
    where nullif(trim(row_data.division), '') is not null
    group by lower(trim(row_data.division))
  ) source
  where not exists (
    select 1 from public.camp_groups existing
    where existing.organization_id = p_organization_id
      and existing.camp_id = p_camp_id
      and existing.kind = 'division'
      and lower(trim(existing.name)) = lower(source.name)
  );

  insert into public.camp_groups (organization_id, camp_id, kind, name)
  select p_organization_id, p_camp_id, 'patrol'::public.group_kind, source.name
  from (
    select min(trim(row_data.patrol)) as name
    from jsonb_to_recordset(p_rows) as row_data(patrol text)
    where nullif(trim(row_data.patrol), '') is not null
    group by lower(trim(row_data.patrol))
  ) source
  where not exists (
    select 1 from public.camp_groups existing
    where existing.organization_id = p_organization_id
      and existing.camp_id = p_camp_id
      and existing.kind = 'patrol'
      and lower(trim(existing.name)) = lower(source.name)
  );

  insert into public.camp_groups (organization_id, camp_id, kind, name)
  select p_organization_id, p_camp_id, 'meal_group'::public.group_kind, source.name
  from (
    select min(trim(row_data.meal_group)) as name
    from jsonb_to_recordset(p_rows) as row_data(meal_group text)
    where nullif(trim(row_data.meal_group), '') is not null
    group by lower(trim(row_data.meal_group))
  ) source
  where not exists (
    select 1 from public.camp_groups existing
    where existing.organization_id = p_organization_id
      and existing.camp_id = p_camp_id
      and existing.kind = 'meal_group'
      and lower(trim(existing.name)) = lower(source.name)
  );

  insert into public.participants (
    organization_id,
    camp_id,
    display_name,
    division_id,
    patrol_id,
    meal_group_id,
    food_factor,
    source_reference,
    import_batch_id
  )
  select
    p_organization_id,
    p_camp_id,
    trim(row_data.display_name),
    (select group_row.id from public.camp_groups group_row
      where group_row.organization_id = p_organization_id and group_row.camp_id = p_camp_id
        and group_row.kind = 'division' and lower(trim(group_row.name)) = lower(trim(row_data.division))
      order by group_row.created_at limit 1),
    (select group_row.id from public.camp_groups group_row
      where group_row.organization_id = p_organization_id and group_row.camp_id = p_camp_id
        and group_row.kind = 'patrol' and lower(trim(group_row.name)) = lower(trim(row_data.patrol))
      order by group_row.created_at limit 1),
    (select group_row.id from public.camp_groups group_row
      where group_row.organization_id = p_organization_id and group_row.camp_id = p_camp_id
        and group_row.kind = 'meal_group' and lower(trim(group_row.name)) = lower(trim(row_data.meal_group))
      order by group_row.created_at limit 1),
    row_data.food_factor,
    format('import:%s:row:%s', new_batch_id, row_data.source_row),
    new_batch_id
  from jsonb_to_recordset(p_rows) as row_data(
    source_row integer,
    display_name text,
    division text,
    patrol text,
    meal_group text,
    food_factor numeric
  );

  insert into public.participant_attendance (
    organization_id,
    camp_id,
    participant_id,
    starts_at,
    ends_at
  )
  select
    p_organization_id,
    p_camp_id,
    participant.id,
    row_data.attendance_start,
    row_data.attendance_end
  from jsonb_to_recordset(p_rows) as row_data(
    source_row integer,
    attendance_start timestamptz,
    attendance_end timestamptz
  )
  join public.participants participant
    on participant.import_batch_id = new_batch_id
    and participant.source_reference = format('import:%s:row:%s', new_batch_id, row_data.source_row);

  insert into public.participant_dietary_needs (
    organization_id,
    camp_id,
    participant_id,
    raw_food_note,
    review_status
  )
  select
    p_organization_id,
    p_camp_id,
    participant.id,
    trim(row_data.dietary_note),
    'unreviewed'
  from jsonb_to_recordset(p_rows) as row_data(source_row integer, dietary_note text)
  join public.participants participant
    on participant.import_batch_id = new_batch_id
    and participant.source_reference = format('import:%s:row:%s', new_batch_id, row_data.source_row)
  where nullif(trim(row_data.dietary_note), '') is not null;

  update public.import_batches
  set status = 'imported', completed_at = now()
  where id = new_batch_id;

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
    'participant_import_completed',
    'import_batch',
    new_batch_id::text,
    jsonb_build_object('camp_id', p_camp_id, 'accepted', imported_count, 'excluded', p_excluded_count)
  );

  return new_batch_id;
end;
$$;

revoke all on function public.import_participant_batch(
  uuid, uuid, text, text, text, jsonb, text[], integer, integer, jsonb
) from public, anon;
grant execute on function public.import_participant_batch(
  uuid, uuid, text, text, text, jsonb, text[], integer, integer, jsonb
) to authenticated;
