create function public.update_participant_details(
  p_participant_id uuid,
  p_display_name text,
  p_division text,
  p_patrol text,
  p_meal_group text,
  p_food_factor numeric,
  p_attendance_start timestamptz,
  p_attendance_end timestamptz
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_camp_id uuid;
  target_division_id uuid;
  target_patrol_id uuid;
  target_meal_group_id uuid;
begin
  select participant.organization_id, participant.camp_id
  into target_organization_id, target_camp_id
  from public.participants participant
  where participant.id = p_participant_id;

  if not found or not public.is_org_member(target_organization_id) then
    raise exception 'Participant not found' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_display_name, ''))) not between 1 and 160
    or p_food_factor is null or p_food_factor <= 0 or p_food_factor > 10
    or p_attendance_start is null or p_attendance_end is null
    or p_attendance_end <= p_attendance_start then
    raise exception 'Participant details failed validation' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_division, ''))) > 120
    or length(trim(coalesce(p_patrol, ''))) > 120
    or length(trim(coalesce(p_meal_group, ''))) > 120 then
    raise exception 'Participant group name is too long' using errcode = '22023';
  end if;

  if nullif(trim(p_division), '') is not null then
    select group_row.id into target_division_id
    from public.camp_groups group_row
    where group_row.organization_id = target_organization_id
      and group_row.camp_id = target_camp_id
      and group_row.kind = 'division'
      and lower(trim(group_row.name)) = lower(trim(p_division))
    order by group_row.created_at limit 1;
    if target_division_id is null then
      insert into public.camp_groups (organization_id, camp_id, kind, name)
      values (target_organization_id, target_camp_id, 'division', trim(p_division))
      returning id into target_division_id;
    end if;
  end if;

  if nullif(trim(p_patrol), '') is not null then
    select group_row.id into target_patrol_id
    from public.camp_groups group_row
    where group_row.organization_id = target_organization_id
      and group_row.camp_id = target_camp_id
      and group_row.kind = 'patrol'
      and lower(trim(group_row.name)) = lower(trim(p_patrol))
    order by group_row.created_at limit 1;
    if target_patrol_id is null then
      insert into public.camp_groups (organization_id, camp_id, kind, name, parent_group_id)
      values (target_organization_id, target_camp_id, 'patrol', trim(p_patrol), target_division_id)
      returning id into target_patrol_id;
    end if;
  end if;

  if nullif(trim(p_meal_group), '') is not null then
    select group_row.id into target_meal_group_id
    from public.camp_groups group_row
    where group_row.organization_id = target_organization_id
      and group_row.camp_id = target_camp_id
      and group_row.kind = 'meal_group'
      and lower(trim(group_row.name)) = lower(trim(p_meal_group))
    order by group_row.created_at limit 1;
    if target_meal_group_id is null then
      insert into public.camp_groups (organization_id, camp_id, kind, name)
      values (target_organization_id, target_camp_id, 'meal_group', trim(p_meal_group))
      returning id into target_meal_group_id;
    end if;
  end if;

  update public.participants
  set display_name = trim(p_display_name),
      division_id = target_division_id,
      patrol_id = target_patrol_id,
      meal_group_id = target_meal_group_id,
      food_factor = p_food_factor
  where id = p_participant_id;

  delete from public.participant_attendance
  where participant_id = p_participant_id;

  insert into public.participant_attendance (
    organization_id, camp_id, participant_id, starts_at, ends_at
  ) values (
    target_organization_id, target_camp_id, p_participant_id, p_attendance_start, p_attendance_end
  );

  insert into public.audit_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    target_organization_id, (select auth.uid()), 'participant_updated', 'participant', p_participant_id::text,
    jsonb_build_object('camp_id', target_camp_id)
  );
end;
$$;

create function public.review_dietary_need(
  p_dietary_need_id uuid,
  p_tag_labels text[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_camp_id uuid;
begin
  select need.organization_id, need.camp_id
  into target_organization_id, target_camp_id
  from public.participant_dietary_needs need
  where need.id = p_dietary_need_id;

  if not found or not public.is_org_member(target_organization_id) then
    raise exception 'Dietary need not found' using errcode = '42501';
  end if;
  if coalesce(array_length(p_tag_labels, 1), 0) > 20
    or exists (
      select 1 from unnest(coalesce(p_tag_labels, array[]::text[])) label
      where length(trim(label)) not between 1 and 80
    ) then
    raise exception 'Dietary tags failed validation' using errcode = '22023';
  end if;

  insert into public.dietary_tags (organization_id, camp_id, label)
  select target_organization_id, target_camp_id, source.label
  from (
    select min(trim(label)) as label
    from unnest(coalesce(p_tag_labels, array[]::text[])) label
    group by lower(trim(label))
  ) source
  where not exists (
    select 1 from public.dietary_tags existing
    where existing.organization_id = target_organization_id
      and existing.camp_id = target_camp_id
      and lower(trim(existing.label)) = lower(source.label)
  );

  delete from public.dietary_need_tags
  where dietary_need_id = p_dietary_need_id;

  insert into public.dietary_need_tags (
    organization_id, camp_id, dietary_need_id, dietary_tag_id
  )
  select target_organization_id, target_camp_id, p_dietary_need_id, tag.id
  from public.dietary_tags tag
  where tag.organization_id = target_organization_id
    and tag.camp_id = target_camp_id
    and lower(trim(tag.label)) in (
      select lower(trim(label)) from unnest(coalesce(p_tag_labels, array[]::text[])) label
    );

  update public.participant_dietary_needs
  set review_status = 'resolved',
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = p_dietary_need_id;

  insert into public.audit_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    target_organization_id, (select auth.uid()), 'dietary_need_reviewed', 'participant_dietary_need', p_dietary_need_id::text,
    jsonb_build_object('camp_id', target_camp_id, 'tag_count', coalesce(array_length(p_tag_labels, 1), 0))
  );
end;
$$;

create function public.get_camp_readiness(
  p_organization_id uuid,
  p_camp_id uuid
)
returns table (
  unresolved_dietary_needs bigint,
  meals_without_recipe bigint,
  calculation_stale boolean,
  can_finalize boolean
)
language sql
stable
set search_path = ''
as $$
  with counts as (
    select
      (select count(*) from public.participant_dietary_needs need
        where need.organization_id = p_organization_id
          and need.camp_id = p_camp_id
          and need.review_status <> 'resolved') as unresolved_dietary_needs,
      (select count(*) from public.meals meal
        where meal.organization_id = p_organization_id
          and meal.camp_id = p_camp_id
          and meal.camp_recipe_copy_id is null) as meals_without_recipe,
      not exists (
        select 1 from public.calculation_revisions revision
        where revision.organization_id = p_organization_id
          and revision.camp_id = p_camp_id
          and revision.status = 'current'
      ) as calculation_stale
  )
  select
    counts.unresolved_dietary_needs,
    counts.meals_without_recipe,
    counts.calculation_stale,
    counts.unresolved_dietary_needs = 0
      and counts.meals_without_recipe = 0
      and not counts.calculation_stale
  from counts
  where public.is_org_member(p_organization_id)
    and exists (
      select 1 from public.camps camp
      where camp.organization_id = p_organization_id and camp.id = p_camp_id
    );
$$;

revoke all on function public.update_participant_details(uuid, text, text, text, text, numeric, timestamptz, timestamptz) from public, anon;
revoke all on function public.review_dietary_need(uuid, text[]) from public, anon;
revoke all on function public.get_camp_readiness(uuid, uuid) from public, anon;
grant execute on function public.update_participant_details(uuid, text, text, text, text, numeric, timestamptz, timestamptz) to authenticated;
grant execute on function public.review_dietary_need(uuid, text[]) to authenticated;
grant execute on function public.get_camp_readiness(uuid, uuid) to authenticated;
