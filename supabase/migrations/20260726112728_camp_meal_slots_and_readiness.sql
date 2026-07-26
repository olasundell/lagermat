alter table public.camps
  add column meal_plan_confirmed_at timestamptz,
  add column meal_plan_confirmed_by uuid references auth.users(id) on delete set null;

create index camps_meal_plan_confirmed_by_idx
  on public.camps (meal_plan_confirmed_by);

create table public.camp_meal_slots (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  slot_key text not null check (length(trim(slot_key)) between 1 and 200),
  service_date date not null,
  starts_at timestamptz not null,
  meal_type text not null check (
    meal_type in ('breakfast', 'lunch', 'dinner', 'evening', 'other')
  ),
  label text check (label is null or length(trim(label)) between 1 and 120),
  service_status text not null default 'required' check (
    service_status in ('required', 'no_service')
  ),
  source text not null default 'extra' check (
    source in ('default', 'extra', 'migrated')
  ),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, camp_id, id),
  unique (organization_id, camp_id, slot_key),
  constraint camp_meal_slots_camp_fk
    foreign key (organization_id, camp_id)
    references public.camps (organization_id, id) on delete cascade
);

create index camp_meal_slots_camp_date_idx
  on public.camp_meal_slots (
    organization_id,
    camp_id,
    service_date,
    starts_at,
    sort_order
  );

create trigger camp_meal_slots_set_updated_at
  before update on public.camp_meal_slots
  for each row execute function public.set_updated_at();

alter table public.camp_meal_slots enable row level security;
create policy camp_meal_slots_member_read
  on public.camp_meal_slots
  for select
  to authenticated
  using (public.is_org_member(organization_id));

grant select on table public.camp_meal_slots to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.camp_meal_slots from authenticated, anon;

-- Upgrade existing databases without inventing unconfirmed days. Every
-- existing meal receives one migrated slot and keeps its own identity and
-- calculation references.
insert into public.camp_meal_slots (
  id,
  organization_id,
  camp_id,
  slot_key,
  service_date,
  starts_at,
  meal_type,
  label,
  service_status,
  source
)
select
  extensions.gen_random_uuid(),
  meal.organization_id,
  meal.camp_id,
  'migrated:' || meal.id::text,
  (meal.starts_at at time zone camp.timezone)::date,
  meal.starts_at,
  meal.meal_type,
  meal.title,
  'required',
  'migrated'
from public.meals as meal
join public.camps as camp
  on camp.organization_id = meal.organization_id
 and camp.id = meal.camp_id;

alter table public.meals add column meal_slot_id uuid;

update public.meals as meal
set meal_slot_id = slot.id
from public.camp_meal_slots as slot
where slot.organization_id = meal.organization_id
  and slot.camp_id = meal.camp_id
  and slot.slot_key = 'migrated:' || meal.id::text;

alter table public.meals
  alter column meal_slot_id set not null,
  add constraint meals_slot_unique
    unique (organization_id, camp_id, meal_slot_id),
  add constraint meals_slot_fk
    foreign key (organization_id, camp_id, meal_slot_id)
    references public.camp_meal_slots (organization_id, camp_id, id)
    on delete restrict;

create function public.assign_and_validate_meal_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_slot public.camp_meal_slots%rowtype;
  target_timezone text;
  generated_slot_id uuid;
begin
  select camp.timezone
  into target_timezone
  from public.camps as camp
  where camp.organization_id = new.organization_id
    and camp.id = new.camp_id;

  if not found then
    raise exception 'Camp not found' using errcode = '23503';
  end if;

  if new.meal_slot_id is null then
    select slot.*
    into target_slot
    from public.camp_meal_slots as slot
    where slot.organization_id = new.organization_id
      and slot.camp_id = new.camp_id
      and slot.service_status = 'required'
      and slot.starts_at = new.starts_at
      and slot.meal_type = new.meal_type
      and not exists (
        select 1
        from public.meals as linked_meal
        where linked_meal.organization_id = slot.organization_id
          and linked_meal.camp_id = slot.camp_id
          and linked_meal.meal_slot_id = slot.id
          and (tg_op = 'INSERT' or linked_meal.id <> new.id)
      )
    order by
      case slot.source when 'default' then 0 when 'migrated' then 1 else 2 end,
      slot.sort_order,
      slot.id
    limit 1
    for update;

    if found then
      new.meal_slot_id := target_slot.id;
    else
      generated_slot_id := extensions.gen_random_uuid();
      insert into public.camp_meal_slots (
        id,
        organization_id,
        camp_id,
        slot_key,
        service_date,
        starts_at,
        meal_type,
        label,
        service_status,
        source
      ) values (
        generated_slot_id,
        new.organization_id,
        new.camp_id,
        'extra:' || generated_slot_id::text,
        (new.starts_at at time zone target_timezone)::date,
        new.starts_at,
        new.meal_type,
        new.title,
        'required',
        'extra'
      );
      new.meal_slot_id := generated_slot_id;
    end if;
  else
    select slot.*
    into target_slot
    from public.camp_meal_slots as slot
    where slot.organization_id = new.organization_id
      and slot.camp_id = new.camp_id
      and slot.id = new.meal_slot_id
    for update;

    if not found or target_slot.service_status <> 'required' then
      raise exception 'Meal slot is unavailable' using errcode = '22023';
    end if;

    if tg_op = 'UPDATE' and new.meal_slot_id = old.meal_slot_id then
      update public.camp_meal_slots
      set service_date = (new.starts_at at time zone target_timezone)::date,
          starts_at = new.starts_at,
          meal_type = new.meal_type,
          label = new.title
      where id = new.meal_slot_id;
    elsif target_slot.starts_at <> new.starts_at
      or target_slot.meal_type <> new.meal_type then
      raise exception 'Meal details do not match the selected slot'
        using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.assign_and_validate_meal_slot()
  from public, anon, authenticated;

create trigger meals_assign_and_validate_slot
  before insert or update of organization_id, camp_id, meal_slot_id, starts_at,
    meal_type, title
  on public.meals
  for each row execute function public.assign_and_validate_meal_slot();

-- Supabase applies seed.sql after every migration. The compatibility trigger
-- above supplies a slot for old fixtures and bounded SQL tests that still
-- insert a meal without the new column.

create function public.confirm_default_meal_plan(p_camp_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_camp public.camps%rowtype;
  inserted_count bigint;
begin
  select camp.*
  into target_camp
  from public.camps as camp
  where camp.id = p_camp_id;

  if not found or not public.is_org_member(target_camp.organization_id) then
    raise exception 'Camp not found' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    target_camp.organization_id::text || ':' || target_camp.id::text,
    0
  ));

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
  )
  select
    target_camp.organization_id,
    target_camp.id,
    'default:' || service_day::text || ':' || meal_kind.meal_type,
    service_day,
    (service_day + meal_kind.local_time) at time zone target_camp.timezone,
    meal_kind.meal_type,
    meal_kind.label,
    'required',
    'default',
    meal_kind.sort_order
  from generate_series(
    target_camp.starts_on::timestamp,
    target_camp.ends_on::timestamp,
    interval '1 day'
  ) as generated_day
  cross join lateral (select generated_day::date as service_day) as day_value
  cross join (
    values
      ('breakfast', 'Frukost', time '08:00', 10),
      ('lunch', 'Lunch', time '12:00', 20),
      ('dinner', 'Middag', time '18:00', 30)
  ) as meal_kind(meal_type, label, local_time, sort_order)
  where not exists (
    select 1
    from public.camp_meal_slots as existing_slot
    where existing_slot.organization_id = target_camp.organization_id
      and existing_slot.camp_id = target_camp.id
      and existing_slot.service_date = service_day
      and existing_slot.meal_type = meal_kind.meal_type
  )
  on conflict (organization_id, camp_id, slot_key) do nothing;

  get diagnostics inserted_count = row_count;

  update public.camps
  set meal_plan_confirmed_at = coalesce(meal_plan_confirmed_at, now()),
      meal_plan_confirmed_by = coalesce(meal_plan_confirmed_by, (select auth.uid()))
  where id = target_camp.id;

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
    'meal_plan_confirmed',
    'camp',
    target_camp.id::text,
    jsonb_build_object('default_slots_created', inserted_count)
  );

  return inserted_count;
end;
$$;

revoke all on function public.confirm_default_meal_plan(uuid)
  from public, anon;
grant execute on function public.confirm_default_meal_plan(uuid)
  to authenticated;

create function public.set_meal_slot_service_status(
  p_slot_id uuid,
  p_service_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_slot public.camp_meal_slots%rowtype;
begin
  select slot.*
  into target_slot
  from public.camp_meal_slots as slot
  where slot.id = p_slot_id
  for update;

  if not found or not public.is_org_member(target_slot.organization_id) then
    raise exception 'Meal slot not found' using errcode = '42501';
  end if;
  if p_service_status not in ('required', 'no_service') then
    raise exception 'Meal slot status failed validation' using errcode = '22023';
  end if;
  if target_slot.service_status = p_service_status then
    return;
  end if;

  update public.camp_meal_slots
  set service_status = p_service_status
  where id = target_slot.id;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    target_slot.organization_id,
    (select auth.uid()),
    'meal_slot_status_changed',
    'camp_meal_slot',
    target_slot.id::text,
    jsonb_build_object(
      'camp_id', target_slot.camp_id,
      'previous_service_status', target_slot.service_status,
      'service_status', p_service_status,
      'preserved_meal_id', (
        select meal.id
        from public.meals as meal
        where meal.organization_id = target_slot.organization_id
          and meal.camp_id = target_slot.camp_id
          and meal.meal_slot_id = target_slot.id
      )
    )
  );
end;
$$;

revoke all on function public.set_meal_slot_service_status(uuid, text)
  from public, anon;
grant execute on function public.set_meal_slot_service_status(uuid, text)
  to authenticated;

alter function public.save_meal(
  uuid, uuid, timestamptz, text, text, uuid, jsonb
) rename to save_meal_pre_slots;
revoke all on function public.save_meal_pre_slots(
  uuid, uuid, timestamptz, text, text, uuid, jsonb
) from public, anon, authenticated;

create function public.save_meal_to_slot(
  p_meal_id uuid,
  p_meal_slot_id uuid,
  p_camp_id uuid,
  p_title text,
  p_recipe_version_id uuid,
  p_reserves jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_slot public.camp_meal_slots%rowtype;
  target_meal_id uuid;
  previous_slot_id uuid;
begin
  select slot.*
  into target_slot
  from public.camp_meal_slots as slot
  where slot.id = p_meal_slot_id
    and slot.camp_id = p_camp_id
  for update;

  if not found
    or not public.is_org_member(target_slot.organization_id)
    or target_slot.service_status <> 'required' then
    raise exception 'Meal slot not found' using errcode = '42501';
  end if;
  if p_meal_id is null and exists (
    select 1 from public.meals as meal
    where meal.organization_id = target_slot.organization_id
      and meal.camp_id = target_slot.camp_id
      and meal.meal_slot_id = target_slot.id
  ) then
    raise exception 'Meal slot is already planned' using errcode = '23505';
  end if;

  target_meal_id := public.save_meal_pre_slots(
    p_meal_id,
    p_camp_id,
    target_slot.starts_at,
    target_slot.meal_type,
    p_title,
    p_recipe_version_id,
    p_reserves
  );

  select meal.meal_slot_id
  into previous_slot_id
  from public.meals as meal
  where meal.id = target_meal_id;

  if previous_slot_id <> target_slot.id then
    update public.meals
    set meal_slot_id = target_slot.id
    where id = target_meal_id;

    delete from public.camp_meal_slots as orphan
    where orphan.id = previous_slot_id
      and orphan.source = 'extra'
      and not exists (
        select 1 from public.meals as linked_meal
        where linked_meal.meal_slot_id = orphan.id
      );
  end if;

  return target_meal_id;
end;
$$;

revoke all on function public.save_meal_to_slot(
  uuid, uuid, uuid, text, uuid, jsonb
) from public, anon;
grant execute on function public.save_meal_to_slot(
  uuid, uuid, uuid, text, uuid, jsonb
) to authenticated;

-- Keep the original RPC signature working for existing clients and tests.
create function public.save_meal(
  p_meal_id uuid,
  p_camp_id uuid,
  p_starts_at timestamptz,
  p_meal_type text,
  p_title text,
  p_recipe_version_id uuid,
  p_reserves jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.save_meal_pre_slots(
    p_meal_id,
    p_camp_id,
    p_starts_at,
    p_meal_type,
    p_title,
    p_recipe_version_id,
    p_reserves
  );
$$;

revoke all on function public.save_meal(
  uuid, uuid, timestamptz, text, text, uuid, jsonb
) from public, anon;
grant execute on function public.save_meal(
  uuid, uuid, timestamptz, text, text, uuid, jsonb
) to authenticated;

-- Extend the canonical digest instead of duplicating the established and
-- already verified participant/recipe digest implementation.
alter function public.camp_input_digest(uuid, uuid)
  rename to camp_input_digest_pre_slots;
revoke all on function public.camp_input_digest_pre_slots(uuid, uuid)
  from public, anon, authenticated;

create function public.camp_input_digest(
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
    'base_digest', public.camp_input_digest_pre_slots(
      p_organization_id,
      p_camp_id
    ),
    'meal_plan_confirmed', coalesce((
      select camp.meal_plan_confirmed_at is not null
      from public.camps as camp
      where camp.organization_id = p_organization_id
        and camp.id = p_camp_id
    ), false),
    'meal_slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', slot.id,
        'service_date', slot.service_date,
        'starts_at', slot.starts_at,
        'meal_type', slot.meal_type,
        'label', slot.label,
        'service_status', slot.service_status,
        'source', slot.source,
        'sort_order', slot.sort_order
      ) order by slot.service_date, slot.starts_at, slot.sort_order, slot.id)
      from public.camp_meal_slots as slot
      where slot.organization_id = p_organization_id
        and slot.camp_id = p_camp_id
    ), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex');
$$;

revoke all on function public.camp_input_digest(uuid, uuid)
  from public, anon, authenticated;

update public.calculation_revisions
set status = 'stale'
where status = 'current';

create trigger camp_meal_slots_mark_calculation_stale
  after insert or update or delete on public.camp_meal_slots
  for each row execute function public.mark_camp_calculation_stale();

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
  calculation_stale boolean,
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
    counts.meal_plan_confirmed
      and counts.required_slots > 0
      and counts.unplanned_slots = 0
      and counts.unresolved_dietary_needs = 0
      and counts.meals_without_recipe = 0
      and not counts.calculation_stale
  from counts
  where public.is_org_member(p_organization_id);
$$;

revoke all on function public.get_camp_readiness(uuid, uuid)
  from public, anon;
grant execute on function public.get_camp_readiness(uuid, uuid)
  to authenticated;

alter function public.calculate_camp(uuid, uuid)
  rename to calculate_camp_pre_meal_readiness;
revoke all on function public.calculate_camp_pre_meal_readiness(uuid, uuid)
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
  revision_id := public.calculate_camp_pre_meal_readiness(
    p_organization_id,
    p_camp_id
  );

  delete from public.calculation_lines as line
  using public.meals as meal, public.camp_meal_slots as slot
  where line.organization_id = p_organization_id
    and line.camp_id = p_camp_id
    and line.calculation_revision_id = revision_id
    and meal.organization_id = line.organization_id
    and meal.camp_id = line.camp_id
    and meal.id = line.meal_id
    and slot.organization_id = meal.organization_id
    and slot.camp_id = meal.camp_id
    and slot.id = meal.meal_slot_id
    and slot.service_status = 'no_service';

  select *
  into readiness
  from public.get_camp_readiness(p_organization_id, p_camp_id);

  update public.calculation_revisions
  set problem_summary = problem_summary || jsonb_build_object(
    'meal_plan_confirmed', readiness.meal_plan_confirmed,
    'required_slots', readiness.required_slots,
    'planned_slots', readiness.planned_slots,
    'unplanned_slots', readiness.unplanned_slots,
    'no_service_slots', readiness.no_service_slots,
    'meals_without_recipe', readiness.meals_without_recipe,
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

alter function public.set_supply_list_status(
  uuid, bigint, public.supply_list_status
) rename to set_supply_list_status_pre_meal_readiness;
revoke all on function public.set_supply_list_status_pre_meal_readiness(
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
  camp_ready boolean;
begin
  select list.*
  into target_list
  from public.supply_lists as list
  where list.id = p_list_id;

  if not found or not public.is_org_member(target_list.organization_id) then
    raise exception 'Supply list not found' using errcode = '42501';
  end if;

  if p_status = 'complete' then
    select readiness.can_finalize
    into camp_ready
    from public.get_camp_readiness(
      target_list.organization_id,
      target_list.camp_id
    ) as readiness;

    if not coalesce(camp_ready, false) then
      raise exception 'Camp readiness must be complete before final status'
        using errcode = '22023';
    end if;
  end if;

  return public.set_supply_list_status_pre_meal_readiness(
    p_list_id,
    p_expected_version,
    p_status
  );
end;
$$;

revoke all on function public.set_supply_list_status(
  uuid, bigint, public.supply_list_status
) from public, anon;
grant execute on function public.set_supply_list_status(
  uuid, bigint, public.supply_list_status
) to authenticated;
