create function public.create_participant(
  p_organization_id uuid,
  p_camp_id uuid,
  p_display_name text,
  p_division text,
  p_patrol text,
  p_meal_group text,
  p_food_factor numeric,
  p_attendance_start timestamptz,
  p_attendance_end timestamptz,
  p_dietary_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  target_division_id uuid;
  target_patrol_id uuid;
  target_meal_group_id uuid;
  new_participant_id uuid;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.camps camp
    where camp.id = p_camp_id
      and camp.organization_id = p_organization_id
  ) then
    raise exception 'Camp does not belong to organization'
      using errcode = '42501';
  end if;

  if length(trim(coalesce(p_display_name, ''))) not between 1 and 160
    or p_food_factor is null
    or p_food_factor <= 0
    or p_food_factor > 10
    or p_attendance_start is null
    or p_attendance_end is null
    or p_attendance_end <= p_attendance_start then
    raise exception 'Participant parameters failed validation'
      using errcode = '22023';
  end if;

  if length(trim(coalesce(p_division, ''))) > 120
    or length(trim(coalesce(p_patrol, ''))) > 120
    or length(trim(coalesce(p_meal_group, ''))) > 120 then
    raise exception 'Participant group name is too long'
      using errcode = '22023';
  end if;

  if length(coalesce(p_dietary_note, '')) > 2000 then
    raise exception 'Dietary note is too long'
      using errcode = '22023';
  end if;

  if nullif(trim(p_division), '') is not null then
    select group_row.id
    into target_division_id
    from public.camp_groups group_row
    where group_row.organization_id = p_organization_id
      and group_row.camp_id = p_camp_id
      and group_row.kind = 'division'
      and lower(trim(group_row.name)) = lower(trim(p_division))
    order by group_row.created_at
    limit 1;

    if target_division_id is null then
      insert into public.camp_groups (
        organization_id,
        camp_id,
        kind,
        name
      ) values (
        p_organization_id,
        p_camp_id,
        'division',
        trim(p_division)
      )
      returning id into target_division_id;
    end if;
  end if;

  if nullif(trim(p_patrol), '') is not null then
    select group_row.id
    into target_patrol_id
    from public.camp_groups group_row
    where group_row.organization_id = p_organization_id
      and group_row.camp_id = p_camp_id
      and group_row.kind = 'patrol'
      and lower(trim(group_row.name)) = lower(trim(p_patrol))
    order by group_row.created_at
    limit 1;

    if target_patrol_id is null then
      insert into public.camp_groups (
        organization_id,
        camp_id,
        kind,
        name,
        parent_group_id
      ) values (
        p_organization_id,
        p_camp_id,
        'patrol',
        trim(p_patrol),
        target_division_id
      )
      returning id into target_patrol_id;
    end if;
  end if;

  if nullif(trim(p_meal_group), '') is not null then
    select group_row.id
    into target_meal_group_id
    from public.camp_groups group_row
    where group_row.organization_id = p_organization_id
      and group_row.camp_id = p_camp_id
      and group_row.kind = 'meal_group'
      and lower(trim(group_row.name)) = lower(trim(p_meal_group))
    order by group_row.created_at
    limit 1;

    if target_meal_group_id is null then
      insert into public.camp_groups (
        organization_id,
        camp_id,
        kind,
        name
      ) values (
        p_organization_id,
        p_camp_id,
        'meal_group',
        trim(p_meal_group)
      )
      returning id into target_meal_group_id;
    end if;
  end if;

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
  ) values (
    p_organization_id,
    p_camp_id,
    trim(p_display_name),
    target_division_id,
    target_patrol_id,
    target_meal_group_id,
    p_food_factor,
    format('manual:%s', actor_user_id),
    null
  )
  returning id into new_participant_id;

  insert into public.participant_attendance (
    organization_id,
    camp_id,
    participant_id,
    starts_at,
    ends_at
  ) values (
    p_organization_id,
    p_camp_id,
    new_participant_id,
    p_attendance_start,
    p_attendance_end
  );

  if nullif(trim(p_dietary_note), '') is not null then
    insert into public.participant_dietary_needs (
      organization_id,
      camp_id,
      participant_id,
      raw_food_note,
      review_status
    ) values (
      p_organization_id,
      p_camp_id,
      new_participant_id,
      trim(p_dietary_note),
      'unreviewed'
    );
  end if;

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
    'participant_created',
    'participant',
    new_participant_id::text,
    jsonb_build_object('camp_id', p_camp_id)
  );

  return new_participant_id;
end;
$$;

revoke all on function public.create_participant(
  uuid, uuid, text, text, text, text, numeric, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_participant(
  uuid, uuid, text, text, text, text, numeric, timestamptz, timestamptz, text
) to authenticated;
