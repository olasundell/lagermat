create type public.participant_lifecycle_status
  as enum ('active', 'withdrawn');
create type public.scoutnet_registration_status
  as enum ('confirmed', 'unconfirmed', 'cancelled');
create type public.participant_data_source
  as enum ('local', 'scoutnet');

alter table public.participants
  add column lifecycle_status public.participant_lifecycle_status
    not null default 'active',
  add column scoutnet_source_reference text,
  add column scoutnet_registration_status public.scoutnet_registration_status,
  add column scoutnet_synced_at timestamptz,
  add column withdrawn_at timestamptz,
  add column pre_scoutnet_display_name text,
  add column pre_scoutnet_division_id uuid,
  add column pre_scoutnet_patrol_id uuid,
  add constraint participants_scoutnet_source_reference_format check (
    scoutnet_source_reference is null
    or scoutnet_source_reference ~ '^scoutnet:v1:[A-Za-z0-9_-]{43}$'
  ),
  add constraint participants_withdrawn_at_consistent check (
    (lifecycle_status = 'active' and withdrawn_at is null)
    or (lifecycle_status = 'withdrawn' and withdrawn_at is not null)
  ),
  add constraint participants_pre_scoutnet_division_fk
    foreign key (organization_id, camp_id, pre_scoutnet_division_id)
    references public.camp_groups (organization_id, camp_id, id)
    on delete set null,
  add constraint participants_pre_scoutnet_patrol_fk
    foreign key (organization_id, camp_id, pre_scoutnet_patrol_id)
    references public.camp_groups (organization_id, camp_id, id)
    on delete set null;

create unique index participants_scoutnet_source_reference_unique
  on public.participants (
    organization_id,
    camp_id,
    scoutnet_source_reference
  )
  where scoutnet_source_reference is not null;

create index participants_active_org_camp_idx
  on public.participants (organization_id, camp_id, display_name)
  where lifecycle_status = 'active';

create index participants_pre_scoutnet_division_fk_idx
  on public.participants (
    organization_id,
    camp_id,
    pre_scoutnet_division_id
  );

create index participants_pre_scoutnet_patrol_fk_idx
  on public.participants (
    organization_id,
    camp_id,
    pre_scoutnet_patrol_id
  );

alter table public.camp_groups
  add column scoutnet_source_reference text,
  add constraint camp_groups_scoutnet_source_reference_format check (
    scoutnet_source_reference is null
    or scoutnet_source_reference ~ '^scoutnet:v1:[A-Za-z0-9_-]{43}$'
  );

create unique index camp_groups_scoutnet_source_reference_unique
  on public.camp_groups (
    organization_id,
    camp_id,
    kind,
    scoutnet_source_reference
  )
  where scoutnet_source_reference is not null;

alter table public.participant_attendance
  add column source public.participant_data_source not null default 'local',
  add column active boolean not null default true,
  add column superseded_at timestamptz,
  add constraint participant_attendance_supersession_consistent check (
    (active and superseded_at is null)
    or (not active and superseded_at is not null)
  );

create index participant_attendance_active_participant_idx
  on public.participant_attendance (
    organization_id,
    camp_id,
    participant_id,
    starts_at
  )
  where active;

alter table public.participant_dietary_needs
  add column scoutnet_managed boolean not null default false;

create unique index participant_dietary_needs_one_scoutnet_managed
  on public.participant_dietary_needs (
    organization_id,
    camp_id,
    participant_id
  )
  where scoutnet_managed;

alter table public.dietary_need_tags
  add column active boolean not null default true,
  add column superseded_at timestamptz,
  add constraint dietary_need_tags_supersession_consistent check (
    (active and superseded_at is null)
    or (not active and superseded_at is not null)
  );

create index dietary_need_tags_active_need_idx
  on public.dietary_need_tags (
    organization_id,
    camp_id,
    dietary_need_id
  )
  where active;

create table app_private.scoutnet_reconciliation_applications (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  snapshot_digest text not null
    check (snapshot_digest ~ '^[0-9a-f]{64}$'),
  decision_digest text not null
    check (decision_digest ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (organization_id, camp_id, idempotency_key),
  constraint scoutnet_reconciliation_applications_camp_fk
    foreign key (organization_id, camp_id)
    references public.camps (organization_id, id) on delete cascade
);

create index scoutnet_reconciliation_applications_actor_idx
  on app_private.scoutnet_reconciliation_applications (
    actor_user_id,
    created_at desc
  );

alter table app_private.scoutnet_reconciliation_applications
  enable row level security;
alter table app_private.scoutnet_reconciliation_applications
  force row level security;

create policy scoutnet_reconciliation_applications_deny_all
  on app_private.scoutnet_reconciliation_applications
  as restrictive
  for all
  to public
  using (false)
  with check (false);

revoke all on table app_private.scoutnet_reconciliation_applications
  from public, anon, authenticated, service_role;

comment on column public.participants.scoutnet_source_reference is
  'Stable server-HMAC identity. Never derived from a participant name.';
comment on column public.participants.lifecycle_status is
  'Withdrawn participants remain recoverable but are excluded from planning.';
comment on column public.participants.pre_scoutnet_display_name is
  'Recoverable local value captured only when a planner explicitly links a row.';
comment on column public.camp_groups.scoutnet_source_reference is
  'Stable server-HMAC group identity. Display names are not identities.';
comment on table app_private.scoutnet_reconciliation_applications is
  'Redacted idempotency receipts only; no participant names or diet text.';

create function app_private.scoutnet_participant_source_kind(
  p_source_reference text,
  p_import_batch_id uuid,
  p_scoutnet_source_reference text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_scoutnet_source_reference is not null then 'scoutnet'
    when p_import_batch_id is not null
      or p_source_reference like 'import:%' then 'import'
    when p_source_reference like 'manual:%' then 'manual'
    else 'legacy'
  end;
$$;

create function app_private.scoutnet_reconciliation_state_digest(
  p_organization_id uuid,
  p_camp_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', group_row.id,
        'parent', group_row.parent_group_id,
        'kind', group_row.kind,
        'name', group_row.name,
        'scoutnet', group_row.scoutnet_source_reference
      ) order by group_row.id)
      from public.camp_groups as group_row
      where group_row.organization_id = p_organization_id
        and group_row.camp_id = p_camp_id
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', participant.id,
        'name', participant.display_name,
        'division', participant.division_id,
        'patrol', participant.patrol_id,
        'meal_group', participant.meal_group_id,
        'food_factor', participant.food_factor,
        'source_reference', participant.source_reference,
        'import_batch', participant.import_batch_id,
        'scoutnet', participant.scoutnet_source_reference,
        'registration', participant.scoutnet_registration_status,
        'lifecycle', participant.lifecycle_status,
        'withdrawn_at', participant.withdrawn_at
      ) order by participant.id)
      from public.participants as participant
      where participant.organization_id = p_organization_id
        and participant.camp_id = p_camp_id
    ), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', attendance.id,
        'participant', attendance.participant_id,
        'starts', attendance.starts_at,
        'ends', attendance.ends_at,
        'source', attendance.source,
        'active', attendance.active
      ) order by attendance.participant_id, attendance.starts_at,
        attendance.ends_at, attendance.id)
      from public.participant_attendance as attendance
      where attendance.organization_id = p_organization_id
        and attendance.camp_id = p_camp_id
    ), '[]'::jsonb),
    'dietary', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', need.id,
        'participant', need.participant_id,
        'raw', need.raw_food_note,
        'review', need.review_status,
        'reviewed_by', need.reviewed_by,
        'reviewed_at', need.reviewed_at,
        'scoutnet_managed', need.scoutnet_managed,
        'tags', coalesce(tags.rows, '[]'::jsonb)
      ) order by need.participant_id, need.id)
      from public.participant_dietary_needs as need
      left join lateral (
        select jsonb_agg(jsonb_build_object(
          'id', link.dietary_tag_id,
          'active', link.active
        ) order by link.dietary_tag_id) as rows
        from public.dietary_need_tags as link
        where link.organization_id = need.organization_id
          and link.camp_id = need.camp_id
          and link.dietary_need_id = need.id
      ) as tags on true
      where need.organization_id = p_organization_id
        and need.camp_id = p_camp_id
    ), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex');
$$;

create function app_private.scoutnet_reconciliation_context_json(
  p_organization_id uuid,
  p_camp_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'campId', p_camp_id,
    'stateDigest', app_private.scoutnet_reconciliation_state_digest(
      p_organization_id,
      p_camp_id
    ),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', participant.id,
        'displayName', participant.display_name,
        'sourceKind', app_private.scoutnet_participant_source_kind(
          participant.source_reference,
          participant.import_batch_id,
          participant.scoutnet_source_reference
        ),
        'sourceReference', participant.scoutnet_source_reference,
        'lifecycleStatus', participant.lifecycle_status,
        'registrationStatus', participant.scoutnet_registration_status,
        'division', jsonb_build_object(
          'reference', division.scoutnet_source_reference,
          'name', division.name
        ),
        'patrol', jsonb_build_object(
          'reference', patrol.scoutnet_source_reference,
          'name', patrol.name
        ),
        'attendance', coalesce(attendance.rows, '[]'::jsonb),
        'specialDietRaw', dietary.raw_food_note,
        'dietaryReviewStatus', dietary.review_status,
        'dietaryTagCount', coalesce(dietary.tag_count, 0)
      ) order by participant.display_name, participant.id)
      from public.participants as participant
      left join public.camp_groups as division
        on division.organization_id = participant.organization_id
       and division.camp_id = participant.camp_id
       and division.id = participant.division_id
      left join public.camp_groups as patrol
        on patrol.organization_id = participant.organization_id
       and patrol.camp_id = participant.camp_id
       and patrol.id = participant.patrol_id
      left join lateral (
        select jsonb_agg(jsonb_build_object(
          'startsAt', row.starts_at,
          'endsAt', row.ends_at
        ) order by row.starts_at, row.ends_at, row.id) as rows
        from public.participant_attendance as row
        where row.organization_id = participant.organization_id
          and row.camp_id = participant.camp_id
          and row.participant_id = participant.id
          and row.active
      ) as attendance on true
      left join lateral (
        select
          need.raw_food_note,
          need.review_status,
          (
            select count(*)
            from public.dietary_need_tags as link
            where link.organization_id = need.organization_id
              and link.camp_id = need.camp_id
              and link.dietary_need_id = need.id
              and link.active
          ) as tag_count
        from public.participant_dietary_needs as need
        where need.organization_id = participant.organization_id
          and need.camp_id = participant.camp_id
          and need.participant_id = participant.id
        order by need.scoutnet_managed desc, need.created_at, need.id
        limit 1
      ) as dietary on true
      where participant.organization_id = p_organization_id
        and participant.camp_id = p_camp_id
    ), '[]'::jsonb)
  );
$$;

create function public.get_scoutnet_reconciliation_context(
  p_actor_user_id uuid,
  p_camp_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
begin
  target_organization_id := app_private.require_scoutnet_admin(
    p_actor_user_id,
    p_camp_id
  );
  return app_private.scoutnet_reconciliation_context_json(
    target_organization_id,
    p_camp_id
  );
end;
$$;

revoke all on function public.get_scoutnet_reconciliation_context(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_scoutnet_reconciliation_context(uuid, uuid)
  to service_role;

revoke all on function app_private.scoutnet_participant_source_kind(
  text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function app_private.scoutnet_reconciliation_state_digest(
  uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function app_private.scoutnet_reconciliation_context_json(
  uuid, uuid
) from public, anon, authenticated, service_role;

create function app_private.valid_scoutnet_reconciliation_snapshot(
  p_snapshot jsonb
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  participant jsonb;
  group_value jsonb;
  attendance_value jsonb;
  warning_value jsonb;
  diet_value jsonb;
  starts_at_value timestamptz;
  ends_at_value timestamptz;
begin
  if p_snapshot is null
    or jsonb_typeof(p_snapshot) <> 'object'
    or p_snapshot - array['complete', 'participantCount', 'participants']
      <> '{}'::jsonb
    or p_snapshot -> 'complete' <> 'true'::jsonb
    or jsonb_typeof(p_snapshot -> 'participantCount') <> 'number'
    or jsonb_typeof(p_snapshot -> 'participants') <> 'array'
    or jsonb_array_length(p_snapshot -> 'participants') not between 1 and 5000
    or (p_snapshot ->> 'participantCount')::integer
      <> jsonb_array_length(p_snapshot -> 'participants')
    or pg_column_size(p_snapshot) > 10000000 then
    return false;
  end if;

  for participant in
    select value from jsonb_array_elements(p_snapshot -> 'participants')
  loop
    if jsonb_typeof(participant) <> 'object'
      or participant - array[
        'sourceReference',
        'displayName',
        'registrationStatus',
        'group',
        'division',
        'patrol',
        'attendance',
        'attendanceWarnings',
        'specialDiet'
      ] <> '{}'::jsonb
      or coalesce(participant ->> 'sourceReference', '')
        !~ '^scoutnet:v1:[A-Za-z0-9_-]{43}$'
      or length(trim(coalesce(participant ->> 'displayName', '')))
        not between 1 and 160
      or coalesce(participant ->> 'registrationStatus', '')
        not in ('confirmed', 'unconfirmed', 'cancelled')
      or jsonb_typeof(participant -> 'attendance') <> 'array'
      or jsonb_array_length(participant -> 'attendance') > 16
      or jsonb_typeof(participant -> 'attendanceWarnings') <> 'array'
      or jsonb_array_length(participant -> 'attendanceWarnings') > 16
      or jsonb_typeof(participant -> 'specialDiet') <> 'array'
      or jsonb_array_length(participant -> 'specialDiet') > 8 then
      return false;
    end if;

    foreach group_value in array array[
      participant -> 'group',
      participant -> 'division',
      participant -> 'patrol'
    ]
    loop
      if jsonb_typeof(group_value) <> 'object'
        or group_value - array['reference', 'name'] <> '{}'::jsonb
        or not (
          group_value -> 'reference' = 'null'::jsonb
          or (
            jsonb_typeof(group_value -> 'reference') = 'string'
            and group_value ->> 'reference'
              ~ '^scoutnet:v1:[A-Za-z0-9_-]{43}$'
          )
        )
        or not (
          group_value -> 'name' = 'null'::jsonb
          or (
            jsonb_typeof(group_value -> 'name') = 'string'
            and length(trim(group_value ->> 'name')) between 1 and 120
          )
        ) then
        return false;
      end if;
    end loop;

    for attendance_value in
      select value from jsonb_array_elements(participant -> 'attendance')
    loop
      if jsonb_typeof(attendance_value) <> 'object'
        or attendance_value - array['startsAt', 'endsAt'] <> '{}'::jsonb
        or jsonb_typeof(attendance_value -> 'startsAt') <> 'string'
        or jsonb_typeof(attendance_value -> 'endsAt') <> 'string'
        or length(attendance_value ->> 'startsAt') > 64
        or length(attendance_value ->> 'endsAt') > 64 then
        return false;
      end if;
      starts_at_value := (attendance_value ->> 'startsAt')::timestamptz;
      ends_at_value := (attendance_value ->> 'endsAt')::timestamptz;
      if ends_at_value <= starts_at_value then return false; end if;
    end loop;

    for warning_value in
      select value
      from jsonb_array_elements(participant -> 'attendanceWarnings')
    loop
      if jsonb_typeof(warning_value) <> 'string'
        or warning_value #>> '{}' not in (
          'attendance_mapping_missing',
          'attendance_answer_missing',
          'attendance_answer_incomplete',
          'attendance_answer_invalid',
          'attendance_no_days_selected'
        ) then
        return false;
      end if;
    end loop;

    for diet_value in
      select value from jsonb_array_elements(participant -> 'specialDiet')
    loop
      if jsonb_typeof(diet_value) <> 'string'
        or length(trim(diet_value #>> '{}')) not between 1 and 2000 then
        return false;
      end if;
    end loop;

    if coalesce((
      select sum(length(trim(value #>> '{}')))
        + greatest(count(*) - 1, 0)
      from jsonb_array_elements(participant -> 'specialDiet')
    ), 0) > 2000 then
      return false;
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_snapshot -> 'participants')
      as source_row(value)
    group by source_row.value ->> 'sourceReference'
    having count(*) > 1
  ) then
    return false;
  end if;

  return true;
exception
  when others then return false;
end;
$$;

create function app_private.scoutnet_special_diet_raw(
  p_special_diet jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    string_agg(trim(value #>> '{}'), E'\n' order by ordinality),
    ''
  )
  from jsonb_array_elements(p_special_diet) with ordinality
    as item(value, ordinality);
$$;

create function app_private.upsert_scoutnet_group(
  p_organization_id uuid,
  p_camp_id uuid,
  p_kind public.group_kind,
  p_group jsonb,
  p_parent_group_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_reference text := nullif(p_group ->> 'reference', '');
  target_name text := nullif(trim(p_group ->> 'name'), '');
  target_group_id uuid;
begin
  if target_reference is null or target_name is null then return null; end if;

  select group_row.id
  into target_group_id
  from public.camp_groups as group_row
  where group_row.organization_id = p_organization_id
    and group_row.camp_id = p_camp_id
    and group_row.kind = p_kind
    and group_row.scoutnet_source_reference = target_reference;

  if target_group_id is null then
    insert into public.camp_groups (
      organization_id,
      camp_id,
      kind,
      name,
      parent_group_id,
      scoutnet_source_reference
    ) values (
      p_organization_id,
      p_camp_id,
      p_kind,
      target_name,
      p_parent_group_id,
      target_reference
    )
    returning id into target_group_id;
  else
    update public.camp_groups
    set
      name = target_name,
      parent_group_id = case
        when p_kind = 'patrol' then p_parent_group_id
        else parent_group_id
      end
    where organization_id = p_organization_id
      and camp_id = p_camp_id
      and id = target_group_id
      and (
        name,
        parent_group_id
      ) is distinct from (
        target_name,
        case
          when p_kind = 'patrol' then p_parent_group_id
          else parent_group_id
        end
      );
  end if;

  return target_group_id;
end;
$$;

create function app_private.apply_scoutnet_dietary_note(
  p_organization_id uuid,
  p_camp_id uuid,
  p_participant_id uuid,
  p_special_diet jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_need_id uuid;
  previous_note text;
  next_note text := app_private.scoutnet_special_diet_raw(p_special_diet);
begin
  select need.id, nullif(trim(need.raw_food_note), '')
  into target_need_id, previous_note
  from public.participant_dietary_needs as need
  where need.organization_id = p_organization_id
    and need.camp_id = p_camp_id
    and need.participant_id = p_participant_id
  order by need.scoutnet_managed desc, need.created_at, need.id
  limit 1;

  if target_need_id is null and next_note is null then return false; end if;

  if target_need_id is null then
    insert into public.participant_dietary_needs (
      organization_id,
      camp_id,
      participant_id,
      raw_food_note,
      review_status,
      scoutnet_managed
    ) values (
      p_organization_id,
      p_camp_id,
      p_participant_id,
      next_note,
      'unreviewed',
      true
    );
    return true;
  end if;

  if previous_note is not distinct from next_note then
    update public.participant_dietary_needs
    set scoutnet_managed = true
    where organization_id = p_organization_id
      and camp_id = p_camp_id
      and id = target_need_id
      and not scoutnet_managed;
    return false;
  end if;

  update public.dietary_need_tags as link
  set
    active = false,
    superseded_at = now()
  from public.participant_dietary_needs as need
  where need.organization_id = p_organization_id
    and need.camp_id = p_camp_id
    and need.participant_id = p_participant_id
    and link.organization_id = need.organization_id
    and link.camp_id = need.camp_id
    and link.dietary_need_id = need.id
    and link.active;

  update public.participant_dietary_needs
  set
    review_status = 'unreviewed',
    reviewed_by = null,
    reviewed_at = null
  where organization_id = p_organization_id
    and camp_id = p_camp_id
    and participant_id = p_participant_id;

  update public.participant_dietary_needs
  set
    raw_food_note = next_note,
    scoutnet_managed = true
  where organization_id = p_organization_id
    and camp_id = p_camp_id
    and id = target_need_id;

  return true;
end;
$$;

revoke all on function app_private.valid_scoutnet_reconciliation_snapshot(
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function app_private.scoutnet_special_diet_raw(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_private.upsert_scoutnet_group(
  uuid, uuid, public.group_kind, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function app_private.apply_scoutnet_dietary_note(
  uuid, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.review_dietary_need(
  p_dietary_need_id uuid,
  p_tag_labels text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_camp_id uuid;
begin
  select need.organization_id, need.camp_id
  into target_organization_id, target_camp_id
  from public.participant_dietary_needs as need
  join public.participants as participant
    on participant.organization_id = need.organization_id
   and participant.camp_id = need.camp_id
   and participant.id = need.participant_id
   and participant.lifecycle_status = 'active'
  where need.id = p_dietary_need_id;

  if not found or not public.is_org_member(target_organization_id) then
    raise exception 'Dietary need not found' using errcode = '42501';
  end if;
  if coalesce(array_length(p_tag_labels, 1), 0) > 20
    or exists (
      select 1
      from unnest(coalesce(p_tag_labels, array[]::text[])) as label
      where length(trim(label)) not between 1 and 80
    ) then
    raise exception 'Dietary tags failed validation' using errcode = '22023';
  end if;

  insert into public.dietary_tags (organization_id, camp_id, label)
  select target_organization_id, target_camp_id, source.label
  from (
    select min(trim(label)) as label
    from unnest(coalesce(p_tag_labels, array[]::text[])) as label
    group by lower(trim(label))
  ) as source
  where not exists (
    select 1
    from public.dietary_tags as existing
    where existing.organization_id = target_organization_id
      and existing.camp_id = target_camp_id
      and lower(trim(existing.label)) = lower(source.label)
  );

  update public.dietary_need_tags
  set
    active = false,
    superseded_at = now()
  where organization_id = target_organization_id
    and camp_id = target_camp_id
    and dietary_need_id = p_dietary_need_id
    and active;

  insert into public.dietary_need_tags (
    organization_id,
    camp_id,
    dietary_need_id,
    dietary_tag_id,
    active,
    superseded_at
  )
  select
    target_organization_id,
    target_camp_id,
    p_dietary_need_id,
    tag.id,
    true,
    null
  from public.dietary_tags as tag
  where tag.organization_id = target_organization_id
    and tag.camp_id = target_camp_id
    and lower(trim(tag.label)) in (
      select lower(trim(label))
      from unnest(coalesce(p_tag_labels, array[]::text[])) as label
    )
  on conflict (
    organization_id,
    camp_id,
    dietary_need_id,
    dietary_tag_id
  ) do update
  set
    active = true,
    superseded_at = null;

  update public.participant_dietary_needs
  set
    review_status = 'resolved',
    reviewed_by = (select auth.uid()),
    reviewed_at = now()
  where id = p_dietary_need_id;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    target_organization_id,
    (select auth.uid()),
    'dietary_need_reviewed',
    'participant_dietary_need',
    p_dietary_need_id::text,
    jsonb_build_object(
      'camp_id',
      target_camp_id,
      'tag_count',
      coalesce(array_length(p_tag_labels, 1), 0)
    )
  );
end;
$$;

create or replace function public.camp_input_digest_pre_slots(
  p_organization_id uuid,
  p_camp_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'camp', coalesce((
      select jsonb_build_object(
        'starts_on', camp.starts_on,
        'ends_on', camp.ends_on,
        'timezone', camp.timezone
      )
      from public.camps as camp
      where camp.organization_id = p_organization_id
        and camp.id = p_camp_id
    ), '{}'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', group_row.id,
        'parent_id', group_row.parent_group_id,
        'kind', group_row.kind,
        'name', group_row.name,
        'sort_order', group_row.sort_order
      ) order by group_row.id)
      from public.camp_groups as group_row
      where group_row.organization_id = p_organization_id
        and group_row.camp_id = p_camp_id
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', participant.id,
        'factor', participant.food_factor,
        'division_id', participant.division_id,
        'patrol_id', participant.patrol_id,
        'meal_group_id', participant.meal_group_id
      ) order by participant.id)
      from public.participants as participant
      where participant.organization_id = p_organization_id
        and participant.camp_id = p_camp_id
        and participant.lifecycle_status = 'active'
    ), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', attendance.id,
        'participant_id', attendance.participant_id,
        'starts_at', attendance.starts_at,
        'ends_at', attendance.ends_at
      ) order by attendance.participant_id, attendance.starts_at,
        attendance.id)
      from public.participant_attendance as attendance
      join public.participants as participant
        on participant.organization_id = attendance.organization_id
       and participant.camp_id = attendance.camp_id
       and participant.id = attendance.participant_id
       and participant.lifecycle_status = 'active'
      where attendance.organization_id = p_organization_id
        and attendance.camp_id = p_camp_id
        and attendance.active
    ), '[]'::jsonb),
    'dietary', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', need.id,
        'participant_id', need.participant_id,
        'raw_food_note', need.raw_food_note,
        'status', need.review_status,
        'tags', coalesce(tags.labels, array[]::text[])
      ) order by need.id)
      from public.participant_dietary_needs as need
      join public.participants as participant
        on participant.organization_id = need.organization_id
       and participant.camp_id = need.camp_id
       and participant.id = need.participant_id
       and participant.lifecycle_status = 'active'
      left join lateral (
        select array_agg(tag.label order by lower(tag.label), tag.id)
          as labels
        from public.dietary_need_tags as link
        join public.dietary_tags as tag
          on tag.organization_id = link.organization_id
         and tag.camp_id = link.camp_id
         and tag.id = link.dietary_tag_id
        where link.organization_id = need.organization_id
          and link.camp_id = need.camp_id
          and link.dietary_need_id = need.id
          and link.active
      ) as tags on true
      where need.organization_id = p_organization_id
        and need.camp_id = p_camp_id
    ), '[]'::jsonb),
    'meals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', meal.id,
        'starts_at', meal.starts_at,
        'meal_type', meal.meal_type,
        'title', meal.title,
        'status', meal.status,
        'copy_id', meal.camp_recipe_copy_id,
        'version_key', copy.version_key,
        'snapshot', copy.frozen_snapshot,
        'reserves', coalesce(reserves.rows, '[]'::jsonb)
      ) order by meal.starts_at, meal.id)
      from public.meals as meal
      left join public.camp_recipe_copies as copy
        on copy.organization_id = meal.organization_id
       and copy.camp_id = meal.camp_id
       and copy.id = meal.camp_recipe_copy_id
      left join lateral (
        select jsonb_agg(jsonb_build_object(
          'label', reserve.dietary_label,
          'portions', reserve.portions
        ) order by lower(reserve.dietary_label), reserve.id) as rows
        from public.meal_reserves as reserve
        where reserve.organization_id = meal.organization_id
          and reserve.camp_id = meal.camp_id
          and reserve.meal_id = meal.id
      ) as reserves on true
      where meal.organization_id = p_organization_id
        and meal.camp_id = p_camp_id
    ), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.get_camp_readiness(
  p_organization_id uuid,
  p_camp_id uuid
)
returns table (
  meal_plan_confirmed boolean,
  required_slots bigint,
  planned_slots bigint,
  unplanned_slots bigint,
  no_service_slots bigint,
  unresolved_dietary_needs bigint,
  meals_without_recipe bigint,
  calculation_stale boolean,
  supplier_items_total bigint,
  supplier_ready_items bigint,
  supplier_safe_suggestions bigint,
  supplier_review_suggestions bigint,
  supplier_no_match bigint,
  supplier_order_incomplete bigint,
  supplier_unresolved_items bigint,
  procurement_ready boolean,
  can_finalize boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with counts as (
    select
      camp.meal_plan_confirmed_at is not null as meal_plan_confirmed,
      (select count(*)
       from public.camp_meal_slots as slot
       where slot.organization_id = p_organization_id
         and slot.camp_id = p_camp_id
         and slot.service_status = 'required') as required_slots,
      (select count(*)
       from public.camp_meal_slots as slot
       where slot.organization_id = p_organization_id
         and slot.camp_id = p_camp_id
         and slot.service_status = 'required'
         and exists (
           select 1 from public.meals as meal
           where meal.organization_id = slot.organization_id
             and meal.camp_id = slot.camp_id
             and meal.meal_slot_id = slot.id
         )) as planned_slots,
      (select count(*)
       from public.camp_meal_slots as slot
       where slot.organization_id = p_organization_id
         and slot.camp_id = p_camp_id
         and slot.service_status = 'required'
         and not exists (
           select 1 from public.meals as meal
           where meal.organization_id = slot.organization_id
             and meal.camp_id = slot.camp_id
             and meal.meal_slot_id = slot.id
         )) as unplanned_slots,
      (select count(*)
       from public.camp_meal_slots as slot
       where slot.organization_id = p_organization_id
         and slot.camp_id = p_camp_id
         and slot.service_status = 'no_service') as no_service_slots,
      (select count(*)
       from public.participant_dietary_needs as need
       join public.participants as participant
         on participant.organization_id = need.organization_id
        and participant.camp_id = need.camp_id
        and participant.id = need.participant_id
        and participant.lifecycle_status = 'active'
       where need.organization_id = p_organization_id
         and need.camp_id = p_camp_id
         and need.review_status <> 'resolved') as unresolved_dietary_needs,
      (select count(*)
       from public.meals as meal
       join public.camp_meal_slots as slot
         on slot.organization_id = meal.organization_id
        and slot.camp_id = meal.camp_id
        and slot.id = meal.meal_slot_id
       where meal.organization_id = p_organization_id
         and meal.camp_id = p_camp_id
         and slot.service_status = 'required'
         and meal.camp_recipe_copy_id is null) as meals_without_recipe,
      not exists (
        select 1
        from public.calculation_revisions as revision
        where revision.organization_id = p_organization_id
          and revision.camp_id = p_camp_id
          and revision.status = 'current'
          and revision.input_digest = public.camp_input_digest(
            p_organization_id,
            p_camp_id
          )
      ) as calculation_stale
    from public.camps as camp
    where camp.organization_id = p_organization_id
      and camp.id = p_camp_id
  )
  select
    counts.meal_plan_confirmed,
    counts.required_slots,
    counts.planned_slots,
    counts.unplanned_slots,
    counts.no_service_slots,
    counts.unresolved_dietary_needs,
    counts.meals_without_recipe,
    counts.calculation_stale,
    supplier.supplier_items_total,
    supplier.supplier_ready_items,
    supplier.supplier_safe_suggestions,
    supplier.supplier_review_suggestions,
    supplier.supplier_no_match,
    supplier.supplier_order_incomplete,
    supplier.supplier_unresolved_items,
    supplier.procurement_ready,
    counts.meal_plan_confirmed
      and counts.required_slots > 0
      and counts.unplanned_slots = 0
      and counts.unresolved_dietary_needs = 0
      and counts.meals_without_recipe = 0
      and not counts.calculation_stale
      and supplier.procurement_ready
  from counts
  cross join public.get_supplier_procurement_readiness(
    p_organization_id,
    p_camp_id
  ) as supplier
  where public.is_org_member(p_organization_id);
$$;
