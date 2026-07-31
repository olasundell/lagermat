-- A meal at exactly a participant's departure remains excluded: attendance is
-- intentionally [starts_at, ends_at). This gate reports an actually planned
-- required meal that has neither a present active participant nor a non-zero
-- reserve source, rather than changing that established boundary rule.
drop function public.get_camp_readiness(uuid, uuid);

create function public.get_camp_readiness(
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
  zero_attendance_slots bigint,
  calculation_stale boolean,
  supplier_items_total bigint,
  supplier_ready_items bigint,
  supplier_safe_suggestions bigint,
  supplier_review_suggestions bigint,
  supplier_pending_items bigint,
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
      (select count(*)
       from public.meals as meal
       join public.camp_meal_slots as slot
         on slot.organization_id = meal.organization_id
        and slot.camp_id = meal.camp_id
        and slot.id = meal.meal_slot_id
       where meal.organization_id = p_organization_id
         and meal.camp_id = p_camp_id
         and slot.service_status = 'required'
         and not exists (
           select 1
           from public.participant_attendance as attendance
           join public.participants as participant
             on participant.organization_id = attendance.organization_id
            and participant.camp_id = attendance.camp_id
            and participant.id = attendance.participant_id
            and participant.lifecycle_status = 'active'
           where attendance.organization_id = meal.organization_id
             and attendance.camp_id = meal.camp_id
             and attendance.active
             and attendance.starts_at <= meal.starts_at
             and meal.starts_at < attendance.ends_at
         )
         and not exists (
           select 1
           from public.meal_reserves as reserve
           where reserve.organization_id = meal.organization_id
             and reserve.camp_id = meal.camp_id
             and reserve.meal_id = meal.id
             and reserve.portions > 0
         )) as zero_attendance_slots,
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
    counts.zero_attendance_slots,
    counts.calculation_stale,
    supplier.supplier_items_total,
    supplier.supplier_ready_items,
    supplier.supplier_safe_suggestions,
    supplier.supplier_review_suggestions,
    supplier.supplier_pending_items,
    supplier.supplier_no_match,
    supplier.supplier_order_incomplete,
    supplier.supplier_unresolved_items,
    supplier.procurement_ready,
    counts.meal_plan_confirmed
      and counts.required_slots > 0
      and counts.unplanned_slots = 0
      and counts.unresolved_dietary_needs = 0
      and counts.meals_without_recipe = 0
      and counts.zero_attendance_slots = 0
      and not counts.calculation_stale
      and supplier.procurement_ready
  from counts
  cross join public.get_supplier_procurement_readiness(
    p_organization_id,
    p_camp_id
  ) as supplier
  where public.is_org_member(p_organization_id);
$$;

revoke all on function public.get_camp_readiness(uuid, uuid)
  from public, anon;
grant execute on function public.get_camp_readiness(uuid, uuid)
  to authenticated;

create function public.save_repeating_extra_meals(
  p_camp_id uuid,
  p_service_dates date[],
  p_start_time time,
  p_meal_type text,
  p_title text,
  p_recipe_version_id uuid,
  p_reserves jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_camp public.camps%rowtype;
  target_date date;
  target_starts_at timestamptz;
  target_slot public.camp_meal_slots%rowtype;
  target_meal record;
  target_slot_id uuid;
  normalized_reserves jsonb;
  created_count integer := 0;
  existing_count integer := 0;
begin
  select camp.*
  into target_camp
  from public.camps as camp
  where camp.id = p_camp_id
  for update;

  if not found or not public.is_org_member(target_camp.organization_id) then
    raise exception 'Camp not found' using errcode = '42501';
  end if;
  if cardinality(p_service_dates) is null or cardinality(p_service_dates) = 0
    or cardinality(p_service_dates) > 31 then
    raise exception 'Choose between one and 31 meal dates' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(p_service_dates) as selected_date
    where selected_date is null
  ) then
    raise exception 'Meal dates cannot be empty' using errcode = '22023';
  end if;
  if p_start_time is null
    or p_meal_type not in ('breakfast', 'lunch', 'dinner', 'evening', 'other')
    or nullif(trim(p_title), '') is null
    or length(trim(p_title)) > 200
    or p_recipe_version_id is null
    or jsonb_typeof(coalesce(p_reserves, '[]'::jsonb)) <> 'array' then
    raise exception 'The repeating meal details are invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_reserves, '[]'::jsonb)) as values(value)
    where jsonb_typeof(value) <> 'object'
      or nullif(trim(value ->> 'dietary_label'), '') is null
      or coalesce(value ->> 'portions', '') !~ '^[0-9]+$'
  ) then
    raise exception 'The repeating meal reserves are invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.recipe_versions as version
    join public.recipes as recipe
      on recipe.organization_id = version.organization_id
     and recipe.id = version.recipe_id
    where version.id = p_recipe_version_id
      and version.organization_id = target_camp.organization_id
      and version.status = 'published'
  ) then
    raise exception 'Recipe version not found' using errcode = '42501';
  end if;

  -- An idempotent retry is only safe when it describes the same reserve
  -- portions. Do not quietly reuse an existing meal and lose a changed reserve.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'dietary_label', lower(trim(value ->> 'dietary_label')),
      'portions', (value ->> 'portions')::integer
    ) order by lower(trim(value ->> 'dietary_label')), (value ->> 'portions')::integer
  ), '[]'::jsonb)
  into normalized_reserves
  from jsonb_array_elements(coalesce(p_reserves, '[]'::jsonb)) as values(value);

  perform pg_advisory_xact_lock(hashtextextended(
    'repeating-extra-meal:' || target_camp.organization_id::text || ':' || p_camp_id::text,
    0
  ));

  -- Validate every date before inserting anything, so one conflict rolls the
  -- whole operation back instead of leaving a partial series behind.
  for target_date in
    select distinct selected_date
    from unnest(p_service_dates) as dates(selected_date)
    order by selected_date
  loop
    if target_date < target_camp.starts_on or target_date > target_camp.ends_on then
      raise exception 'Meal date is outside the camp period' using errcode = '22023';
    end if;
    target_starts_at := (target_date::timestamp + p_start_time) at time zone target_camp.timezone;
    select slot.*
    into target_slot
    from public.camp_meal_slots as slot
    where slot.organization_id = target_camp.organization_id
      and slot.camp_id = p_camp_id
      and slot.starts_at = target_starts_at
      and slot.meal_type = p_meal_type
    order by case slot.source when 'default' then 0 when 'migrated' then 1 else 2 end,
      slot.sort_order, slot.id
    limit 1
    for update;

    if found and target_slot.service_status <> 'required' then
      raise exception 'A selected meal slot is marked no service' using errcode = '23505';
    end if;
    if found then
      select
        meal.id,
        meal.title,
        copy.source_recipe_version_id,
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'dietary_label', lower(trim(reserve.dietary_label)),
              'portions', reserve.portions
            ) order by lower(trim(reserve.dietary_label)), reserve.portions
          )
          from public.meal_reserves as reserve
          where reserve.organization_id = meal.organization_id
            and reserve.camp_id = meal.camp_id
            and reserve.meal_id = meal.id
        ), '[]'::jsonb) as normalized_reserves
      into target_meal
      from public.meals as meal
      left join public.camp_recipe_copies as copy
        on copy.organization_id = meal.organization_id
       and copy.camp_id = meal.camp_id
       and copy.id = meal.camp_recipe_copy_id
      where meal.organization_id = target_camp.organization_id
        and meal.camp_id = p_camp_id
        and meal.meal_slot_id = target_slot.id;
      if found and (
        target_meal.title is distinct from trim(p_title)
        or target_meal.source_recipe_version_id is distinct from p_recipe_version_id
        or target_meal.normalized_reserves is distinct from normalized_reserves
      ) then
        raise exception 'A selected meal slot already has a different meal' using errcode = '23505';
      end if;
    end if;
  end loop;

  for target_date in
    select distinct selected_date
    from unnest(p_service_dates) as dates(selected_date)
    order by selected_date
  loop
    target_starts_at := (target_date::timestamp + p_start_time) at time zone target_camp.timezone;
    select slot.*
    into target_slot
    from public.camp_meal_slots as slot
    where slot.organization_id = target_camp.organization_id
      and slot.camp_id = p_camp_id
      and slot.starts_at = target_starts_at
      and slot.meal_type = p_meal_type
    order by case slot.source when 'default' then 0 when 'migrated' then 1 else 2 end,
      slot.sort_order, slot.id
    limit 1
    for update;

    select meal.id
    into target_meal
    from public.meals as meal
    where meal.organization_id = target_camp.organization_id
      and meal.camp_id = p_camp_id
      and meal.meal_slot_id = target_slot.id;
    if found then
      existing_count := existing_count + 1;
      continue;
    end if;

    if target_slot.id is null then
      insert into public.camp_meal_slots (
        organization_id,
        camp_id,
        slot_key,
        service_date,
        starts_at,
        meal_type,
        label,
        service_status,
        source,
        sort_order
      ) values (
        target_camp.organization_id,
        p_camp_id,
        'repeating-extra:' || target_date::text || ':' || p_meal_type || ':' || p_start_time::text,
        target_date,
        target_starts_at,
        p_meal_type,
        trim(p_title),
        'required',
        'extra',
        coalesce((
          select max(slot.sort_order) + 1
          from public.camp_meal_slots as slot
          where slot.organization_id = target_camp.organization_id
            and slot.camp_id = p_camp_id
            and slot.service_date = target_date
        ), 0)
      )
      returning id into target_slot_id;
    else
      target_slot_id := target_slot.id;
    end if;

    perform public.save_meal_to_slot(
      null,
      target_slot_id,
      p_camp_id,
      trim(p_title),
      p_recipe_version_id,
      coalesce(p_reserves, '[]'::jsonb)
    );
    created_count := created_count + 1;
  end loop;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    target_camp.organization_id,
    (select auth.uid()),
    'repeating_extra_meals_saved',
    'camp',
    p_camp_id::text,
    jsonb_build_object(
      'service_dates', to_jsonb(array(select distinct unnest(p_service_dates) order by 1)),
      'meal_type', p_meal_type,
      'start_time', p_start_time::text,
      'created', created_count,
      'existing', existing_count
    )
  );

  return jsonb_build_object('created', created_count, 'existing', existing_count);
end;
$$;

revoke all on function public.save_repeating_extra_meals(
  uuid, date[], time, text, text, uuid, jsonb
) from public, anon;
grant execute on function public.save_repeating_extra_meals(
  uuid, date[], time, text, text, uuid, jsonb
) to authenticated;

-- This intentionally exposes no participant information. The client needs only
-- enough identity to put the warning on the actual meal and focus it from the
-- camp-level gate.
create function public.get_zero_attendance_meals(
  p_organization_id uuid,
  p_camp_id uuid
)
returns table (
  meal_id uuid,
  meal_slot_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select meal.id, meal.meal_slot_id
  from public.meals as meal
  join public.camp_meal_slots as slot
    on slot.organization_id = meal.organization_id
   and slot.camp_id = meal.camp_id
   and slot.id = meal.meal_slot_id
  where meal.organization_id = p_organization_id
    and meal.camp_id = p_camp_id
    and slot.service_status = 'required'
    and not exists (
      select 1
      from public.participant_attendance as attendance
      join public.participants as participant
        on participant.organization_id = attendance.organization_id
       and participant.camp_id = attendance.camp_id
       and participant.id = attendance.participant_id
       and participant.lifecycle_status = 'active'
      where attendance.organization_id = meal.organization_id
        and attendance.camp_id = meal.camp_id
        and attendance.active
        and attendance.starts_at <= meal.starts_at
        and meal.starts_at < attendance.ends_at
    )
    and not exists (
      select 1
      from public.meal_reserves as reserve
      where reserve.organization_id = meal.organization_id
        and reserve.camp_id = meal.camp_id
        and reserve.meal_id = meal.id
        and reserve.portions > 0
    )
    and public.is_org_member(p_organization_id);
$$;

revoke all on function public.get_zero_attendance_meals(uuid, uuid)
  from public, anon;
grant execute on function public.get_zero_attendance_meals(uuid, uuid)
  to authenticated;

-- Keep the existing calculation behaviour intact, but retain the new blocking
-- reason in the revision summary for downstream exports and audit views.
alter function public.calculate_camp(uuid, uuid)
  rename to calculate_camp_pre_zero_attendance;
revoke all on function public.calculate_camp_pre_zero_attendance(uuid, uuid)
  from public, anon, authenticated;

create function public.calculate_camp(
  p_organization_id uuid,
  p_camp_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  revision_id uuid;
  readiness record;
begin
  revision_id := public.calculate_camp_pre_zero_attendance(
    p_organization_id,
    p_camp_id
  );

  select *
  into readiness
  from public.get_camp_readiness(p_organization_id, p_camp_id);

  update public.calculation_revisions
  set problem_summary = problem_summary || jsonb_build_object(
    'zero_attendance_slots', readiness.zero_attendance_slots,
    'is_draft', not readiness.can_finalize
  )
  where id = revision_id
    and organization_id = p_organization_id
    and camp_id = p_camp_id;

  return revision_id;
end;
$$;

revoke all on function public.calculate_camp(uuid, uuid)
  from public, anon;
grant execute on function public.calculate_camp(uuid, uuid)
  to authenticated;

comment on function public.get_camp_readiness(uuid, uuid) is
  'Returns the shared camp gate, including required meals with no active attendance or reserve source.';

comment on function public.save_repeating_extra_meals(uuid, date[], time, text, text, uuid, jsonb) is
  'Atomically creates or idempotently reuses the same extra meal on selected camp dates.';
