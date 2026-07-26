create or replace function public.create_camp(
  p_organization_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  new_camp_id uuid;
begin
  if actor_user_id is null
    or not public.is_org_admin(p_organization_id) then
    raise exception 'Organization administrator required'
      using errcode = '42501';
  end if;

  if public.current_authentication_assurance_level() <> 'aal2' then
    raise exception 'Two-step verification required'
      using errcode = '42501';
  end if;

  if length(trim(coalesce(p_name, ''))) not between 2 and 160
    or p_starts_on is null
    or p_ends_on is null
    or p_ends_on < p_starts_on then
    raise exception 'Camp parameters failed validation'
      using errcode = '22023';
  end if;

  if p_timezone is null
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names
      where name = p_timezone
    ) then
    raise exception 'Unknown camp timezone'
      using errcode = '22023';
  end if;

  insert into public.camps (
    organization_id,
    name,
    starts_on,
    ends_on,
    timezone,
    status,
    created_by
  ) values (
    p_organization_id,
    trim(p_name),
    p_starts_on,
    p_ends_on,
    p_timezone,
    'draft',
    actor_user_id
  )
  returning id into new_camp_id;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    p_organization_id,
    actor_user_id,
    'camp_created',
    'camp',
    new_camp_id::text,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'starts_on', p_starts_on,
      'ends_on', p_ends_on
    )
  );

  return new_camp_id;
end;
$$;

create function public.export_participant_privacy_data(
  p_participant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  participant_record public.participants%rowtype;
  export_data jsonb;
begin
  select participant.*
  into participant_record
  from public.participants as participant
  where participant.id = p_participant_id;

  if not found then
    raise exception 'Participant not found'
      using errcode = '22023';
  end if;

  if actor_user_id is null
    or not public.is_org_admin(participant_record.organization_id) then
    raise exception 'Organization administrator required'
      using errcode = '42501';
  end if;

  if public.current_authentication_assurance_level() <> 'aal2' then
    raise exception 'Two-step verification required'
      using errcode = '42501';
  end if;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    participant_record.organization_id,
    actor_user_id,
    'participant_privacy_exported',
    'participant',
    participant_record.id::text,
    jsonb_build_object('camp_id', participant_record.camp_id)
  );

  select jsonb_build_object(
    'schema_version', 1,
    'exported_at', now(),
    'organization', jsonb_build_object(
      'id', organization.id,
      'name', organization.name
    ),
    'camp', jsonb_build_object(
      'id', camp.id,
      'name', camp.name,
      'starts_on', camp.starts_on,
      'ends_on', camp.ends_on,
      'timezone', camp.timezone
    ),
    'participant', jsonb_build_object(
      'id', participant.id,
      'display_name', participant.display_name,
      'food_factor', participant.food_factor,
      'source_reference', participant.source_reference,
      'created_at', participant.created_at,
      'updated_at', participant.updated_at,
      'groups', jsonb_build_object(
        'division', division.name,
        'patrol', patrol.name,
        'meal_group', meal_group.name
      )
    ),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', attendance.id,
        'starts_at', attendance.starts_at,
        'ends_at', attendance.ends_at,
        'created_at', attendance.created_at,
        'updated_at', attendance.updated_at
      ) order by attendance.starts_at, attendance.id)
      from public.participant_attendance as attendance
      where attendance.organization_id = participant.organization_id
        and attendance.camp_id = participant.camp_id
        and attendance.participant_id = participant.id
    ), '[]'::jsonb),
    'dietary_needs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', dietary_need.id,
        'raw_food_note', dietary_need.raw_food_note,
        'review_status', dietary_need.review_status,
        'reviewed_at', dietary_need.reviewed_at,
        'created_at', dietary_need.created_at,
        'updated_at', dietary_need.updated_at,
        'tags', coalesce((
          select jsonb_agg(jsonb_build_object(
            'label', tag.label,
            'description', tag.description
          ) order by lower(tag.label), tag.id)
          from public.dietary_need_tags as link
          join public.dietary_tags as tag
            on tag.organization_id = link.organization_id
           and tag.camp_id = link.camp_id
           and tag.id = link.dietary_tag_id
          where link.organization_id = dietary_need.organization_id
            and link.camp_id = dietary_need.camp_id
            and link.dietary_need_id = dietary_need.id
        ), '[]'::jsonb)
      ) order by dietary_need.created_at, dietary_need.id)
      from public.participant_dietary_needs as dietary_need
      where dietary_need.organization_id = participant.organization_id
        and dietary_need.camp_id = participant.camp_id
        and dietary_need.participant_id = participant.id
    ), '[]'::jsonb),
    'import_source', case
      when import_batch.id is null then null
      else jsonb_build_object(
        'id', import_batch.id,
        'source_filename', import_batch.source_filename,
        'source_kind', import_batch.source_kind,
        'created_at', import_batch.created_at,
        'completed_at', import_batch.completed_at
      )
    end,
    'audit_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', audit_event.id,
        'event_type', audit_event.event_type,
        'entity_type', audit_event.entity_type,
        'entity_id', audit_event.entity_id,
        'payload', audit_event.payload,
        'created_at', audit_event.created_at
      ) order by audit_event.created_at, audit_event.id)
      from public.audit_events as audit_event
      where audit_event.organization_id = participant.organization_id
        and audit_event.entity_type = 'participant'
        and audit_event.entity_id = participant.id::text
    ), '[]'::jsonb)
  )
  into export_data
  from public.participants as participant
  join public.organizations as organization
    on organization.id = participant.organization_id
  join public.camps as camp
    on camp.organization_id = participant.organization_id
   and camp.id = participant.camp_id
  left join public.camp_groups as division
    on division.organization_id = participant.organization_id
   and division.camp_id = participant.camp_id
   and division.id = participant.division_id
  left join public.camp_groups as patrol
    on patrol.organization_id = participant.organization_id
   and patrol.camp_id = participant.camp_id
   and patrol.id = participant.patrol_id
  left join public.camp_groups as meal_group
    on meal_group.organization_id = participant.organization_id
   and meal_group.camp_id = participant.camp_id
   and meal_group.id = participant.meal_group_id
  left join public.import_batches as import_batch
    on import_batch.organization_id = participant.organization_id
   and import_batch.camp_id = participant.camp_id
   and import_batch.id = participant.import_batch_id
  where participant.id = p_participant_id;

  return export_data;
end;
$$;

create function public.delete_participant_for_privacy(
  p_participant_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  participant_record public.participants%rowtype;
  attendance_count integer;
  dietary_need_count integer;
begin
  select participant.*
  into participant_record
  from public.participants as participant
  where participant.id = p_participant_id
  for update;

  if not found then
    raise exception 'Participant not found'
      using errcode = '22023';
  end if;

  if actor_user_id is null
    or not public.is_org_admin(participant_record.organization_id) then
    raise exception 'Organization administrator required'
      using errcode = '42501';
  end if;

  if public.current_authentication_assurance_level() <> 'aal2' then
    raise exception 'Two-step verification required'
      using errcode = '42501';
  end if;

  select count(*)::integer
  into attendance_count
  from public.participant_attendance as attendance
  where attendance.organization_id = participant_record.organization_id
    and attendance.camp_id = participant_record.camp_id
    and attendance.participant_id = participant_record.id;

  select count(*)::integer
  into dietary_need_count
  from public.participant_dietary_needs as dietary_need
  where dietary_need.organization_id = participant_record.organization_id
    and dietary_need.camp_id = participant_record.camp_id
    and dietary_need.participant_id = participant_record.id;

  delete from public.participants
  where id = participant_record.id;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    participant_record.organization_id,
    actor_user_id,
    'participant_privacy_deleted',
    'privacy_request',
    'deleted-participant',
    jsonb_build_object(
      'camp_id', participant_record.camp_id,
      'deleted_attendance_count', attendance_count,
      'deleted_dietary_need_count', dietary_need_count
    )
  );
end;
$$;

revoke all on function public.create_camp(
  uuid, text, date, date, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_camp(
  uuid, text, date, date, text
) to authenticated;

revoke all on function public.export_participant_privacy_data(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.export_participant_privacy_data(uuid)
  to authenticated;

revoke all on function public.delete_participant_for_privacy(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_participant_for_privacy(uuid)
  to authenticated;
