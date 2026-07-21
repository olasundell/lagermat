alter table public.calculation_lines
  alter column exact_amount type numeric(30,12),
  add column line_key text,
  add column camp_recipe_copy_id uuid,
  add column ingredient_key text;

update public.calculation_lines line
set line_key = 'legacy:' || line.id::text,
    camp_recipe_copy_id = meal.camp_recipe_copy_id,
    ingredient_key = 'legacy:' || md5(line.ingredient_name || ':' || line.unit)
from public.meals meal
where meal.id = line.meal_id;

alter table public.calculation_lines
  alter column line_key set not null,
  alter column ingredient_key set not null,
  add constraint calculation_lines_copy_fk
    foreign key (organization_id, camp_id, camp_recipe_copy_id)
    references public.camp_recipe_copies (organization_id, camp_id, id) on delete restrict,
  add constraint calculation_lines_revision_line_key_unique
    unique (organization_id, camp_id, calculation_revision_id, line_key);

alter table public.supply_list_items
  alter column required_amount type numeric(30,12),
  alter column ordered_amount type numeric(30,12);

create index calculation_lines_org_copy_idx
  on public.calculation_lines (organization_id, camp_recipe_copy_id);

revoke insert, update, delete on public.calculation_revisions from authenticated;
revoke insert, update, delete on public.calculation_lines from authenticated;

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
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  existing_organization_id uuid;
  existing_camp_id uuid;
  target_starts_on date;
  target_ends_on date;
  target_timezone text;
  target_copy_id uuid;
  target_meal_id uuid;
begin
  select camp.organization_id, camp.starts_on, camp.ends_on, camp.timezone
  into target_organization_id, target_starts_on, target_ends_on, target_timezone
  from public.camps camp
  where camp.id = p_camp_id;

  if not found or not public.is_org_member(target_organization_id) then
    raise exception 'Camp not found' using errcode = '42501';
  end if;
  if p_starts_at is null
    or (p_starts_at at time zone target_timezone)::date not between target_starts_on and target_ends_on
    or p_meal_type not in ('breakfast', 'lunch', 'dinner', 'evening', 'other')
    or length(trim(coalesce(p_title, ''))) not between 1 and 180 then
    raise exception 'Meal details failed validation' using errcode = '22023';
  end if;
  if p_reserves is null or jsonb_typeof(p_reserves) <> 'array'
    or jsonb_array_length(p_reserves) > 50
    or exists (
      select 1
      from jsonb_array_elements(p_reserves) reserve
      where reserve - array['dietary_label', 'portions'] <> '{}'::jsonb
        or length(trim(coalesce(reserve ->> 'dietary_label', ''))) not between 1 and 80
        or coalesce(reserve ->> 'portions', '') !~ '^[0-9]+$'
        or (reserve ->> 'portions')::integer > 10000
    ) then
    raise exception 'Meal reserves failed validation' using errcode = '22023';
  end if;

  if p_meal_id is not null then
    select meal.organization_id, meal.camp_id, meal.camp_recipe_copy_id
    into existing_organization_id, existing_camp_id, target_copy_id
    from public.meals meal
    where meal.id = p_meal_id;

    if not found
      or existing_organization_id <> target_organization_id
      or existing_camp_id <> p_camp_id then
      raise exception 'Meal not found' using errcode = '42501';
    end if;
  end if;

  if p_recipe_version_id is not null then
    target_copy_id := public.freeze_recipe_version(p_camp_id, p_recipe_version_id);
  end if;
  if p_meal_id is null and target_copy_id is null then
    raise exception 'A new meal requires a published recipe version' using errcode = '22023';
  end if;

  if p_meal_id is null then
    insert into public.meals (
      organization_id, camp_id, camp_recipe_copy_id, starts_at, meal_type, title, status
    ) values (
      target_organization_id, p_camp_id, target_copy_id, p_starts_at,
      p_meal_type, trim(p_title), 'draft'
    ) returning id into target_meal_id;
  else
    target_meal_id := p_meal_id;
    update public.meals
    set camp_recipe_copy_id = target_copy_id,
        starts_at = p_starts_at,
        meal_type = p_meal_type,
        title = trim(p_title),
        status = 'draft'
    where id = target_meal_id;
  end if;

  delete from public.meal_reserves where meal_id = target_meal_id;
  insert into public.meal_reserves (
    organization_id, camp_id, meal_id, dietary_label, portions
  )
  select
    target_organization_id,
    p_camp_id,
    target_meal_id,
    trim(reserve ->> 'dietary_label'),
    (reserve ->> 'portions')::integer
  from jsonb_array_elements(p_reserves) reserve
  where (reserve ->> 'portions')::integer > 0;

  update public.calculation_revisions
  set status = 'stale'
  where organization_id = target_organization_id
    and camp_id = p_camp_id
    and status = 'current';

  insert into public.audit_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    target_organization_id, (select auth.uid()),
    case when p_meal_id is null then 'meal_created' else 'meal_updated' end,
    'meal', target_meal_id::text,
    jsonb_build_object(
      'camp_id', p_camp_id,
      'recipe_version_id', p_recipe_version_id,
      'camp_recipe_copy_id', target_copy_id,
      'reserve_rows', jsonb_array_length(p_reserves)
    )
  );

  return target_meal_id;
end;
$$;

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
  next_revision integer;
  input_digest text;
  unresolved_count bigint;
  missing_recipe_count bigint;
begin
  if not public.is_org_member(p_organization_id)
    or not exists (
      select 1 from public.camps camp
      where camp.organization_id = p_organization_id and camp.id = p_camp_id
    ) then
    raise exception 'Camp not found' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_organization_id::text || ':' || p_camp_id::text));

  select count(*) into unresolved_count
  from public.participant_dietary_needs need
  where need.organization_id = p_organization_id
    and need.camp_id = p_camp_id
    and need.review_status <> 'resolved';

  select count(*) into missing_recipe_count
  from public.meals meal
  where meal.organization_id = p_organization_id
    and meal.camp_id = p_camp_id
    and meal.camp_recipe_copy_id is null;

  select encode(extensions.digest(convert_to(jsonb_build_object(
    'meals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', meal.id,
        'starts_at', meal.starts_at,
        'meal_type', meal.meal_type,
        'title', meal.title,
        'copy_id', meal.camp_recipe_copy_id,
        'version_key', copy.version_key,
        'snapshot', copy.frozen_snapshot
      ) order by meal.starts_at, meal.id)
      from public.meals meal
      left join public.camp_recipe_copies copy on copy.id = meal.camp_recipe_copy_id
      where meal.organization_id = p_organization_id and meal.camp_id = p_camp_id
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', participant.id,
        'factor', participant.food_factor,
        'division_id', participant.division_id,
        'meal_group_id', participant.meal_group_id
      ) order by participant.id)
      from public.participants participant
      where participant.organization_id = p_organization_id and participant.camp_id = p_camp_id
    ), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_id', attendance.participant_id,
        'starts_at', attendance.starts_at,
        'ends_at', attendance.ends_at
      ) order by attendance.participant_id, attendance.starts_at, attendance.id)
      from public.participant_attendance attendance
      where attendance.organization_id = p_organization_id and attendance.camp_id = p_camp_id
    ), '[]'::jsonb),
    'dietary', coalesce((
      select jsonb_agg(jsonb_build_object(
        'need_id', need.id,
        'participant_id', need.participant_id,
        'status', need.review_status,
        'tags', coalesce(tags.labels, array[]::text[])
      ) order by need.id)
      from public.participant_dietary_needs need
      left join lateral (
        select array_agg(tag.label order by lower(tag.label)) as labels
        from public.dietary_need_tags link
        join public.dietary_tags tag on tag.id = link.dietary_tag_id
        where link.dietary_need_id = need.id
      ) tags on true
      where need.organization_id = p_organization_id and need.camp_id = p_camp_id
    ), '[]'::jsonb),
    'reserves', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', reserve.id,
        'meal_id', reserve.meal_id,
        'dietary_label', reserve.dietary_label,
        'portions', reserve.portions
      ) order by reserve.meal_id, reserve.id)
      from public.meal_reserves reserve
      where reserve.organization_id = p_organization_id and reserve.camp_id = p_camp_id
    ), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex')
  into input_digest;

  select coalesce(max(revision.revision_number), 0) + 1
  into next_revision
  from public.calculation_revisions revision
  where revision.organization_id = p_organization_id and revision.camp_id = p_camp_id;

  update public.calculation_revisions
  set status = 'superseded'
  where organization_id = p_organization_id
    and camp_id = p_camp_id
    and status = 'current';

  insert into public.calculation_revisions (
    organization_id, camp_id, revision_number, status, input_digest,
    problem_summary, calculated_by
  ) values (
    p_organization_id, p_camp_id, next_revision, 'current', input_digest,
    jsonb_build_object(
      'unreviewed_dietary_needs', unresolved_count,
      'meals_without_recipe', missing_recipe_count,
      'is_draft', unresolved_count > 0 or missing_recipe_count > 0
    ),
    (select auth.uid())
  ) returning id into revision_id;

  with meal_ingredients as (
    select
      meal.id as meal_id,
      meal.starts_at,
      copy.id as copy_id,
      copy.name as recipe_name,
      copy.version_key,
      coalesce(ingredient.value ->> 'id', md5(
        copy.version_key || ':' || ingredient.ordinality::text || ':' || coalesce(ingredient.value ->> 'name', '')
      )) as ingredient_key,
      coalesce(ingredient.value ->> 'name', 'Namnlös ingrediens') as ingredient_name,
      coalesce(ingredient.value ->> 'unit', 'st') as unit,
      coalesce((ingredient.value ->> 'amount')::numeric, 0::numeric) as amount,
      coalesce(ingredient.value ->> 'mode', 'weighted_portion') as mode,
      coalesce(ingredient.value ->> 'dietary_rule', 'standard') as dietary_rule,
      nullif(trim(ingredient.value ->> 'dietary_tag_label'), '') as dietary_tag_label,
      ingredient.ordinality as ingredient_position
    from public.meals meal
    join public.camp_recipe_copies copy on copy.id = meal.camp_recipe_copy_id
    cross join lateral jsonb_array_elements(copy.frozen_snapshot -> 'ingredients') with ordinality ingredient(value, ordinality)
    where meal.organization_id = p_organization_id and meal.camp_id = p_camp_id
  ),
  participant_sources as (
    select
      meal.id as meal_id,
      participant.division_id,
      division.name as division_name,
      participant.meal_group_id,
      meal_group.name as meal_group_name,
      coalesce(tags.labels, array[]::text[]) as dietary_tags,
      participant.food_factor::numeric as weighted_count,
      1::numeric as head_count,
      'participants'::text as source_kind
    from public.meals meal
    join public.participant_attendance attendance
      on attendance.organization_id = meal.organization_id
     and attendance.camp_id = meal.camp_id
     and attendance.starts_at <= meal.starts_at
     and meal.starts_at < attendance.ends_at
    join public.participants participant
      on participant.organization_id = attendance.organization_id
     and participant.camp_id = attendance.camp_id
     and participant.id = attendance.participant_id
    left join public.camp_groups division on division.id = participant.division_id
    left join public.camp_groups meal_group on meal_group.id = participant.meal_group_id
    left join lateral (
      select array_agg(distinct lower(trim(tag.label)) order by lower(trim(tag.label))) as labels
      from public.participant_dietary_needs need
      join public.dietary_need_tags link on link.dietary_need_id = need.id
      join public.dietary_tags tag on tag.id = link.dietary_tag_id
      where need.participant_id = participant.id
        and need.organization_id = participant.organization_id
        and need.camp_id = participant.camp_id
    ) tags on true
    where meal.organization_id = p_organization_id and meal.camp_id = p_camp_id
  ),
  reserve_sources as (
    select
      reserve.meal_id,
      null::uuid as division_id,
      'Reserv'::text as division_name,
      null::uuid as meal_group_id,
      'Reserv'::text as meal_group_name,
      case
        when lower(trim(reserve.dietary_label)) in ('standard', 'standardkost')
          then array[]::text[]
        else array[lower(trim(reserve.dietary_label))]
      end as dietary_tags,
      reserve.portions::numeric as weighted_count,
      reserve.portions::numeric as head_count,
      'reserves'::text as source_kind
    from public.meal_reserves reserve
    where reserve.organization_id = p_organization_id and reserve.camp_id = p_camp_id
  ),
  grouped_sources as (
    select
      source.meal_id,
      source.division_id,
      source.division_name,
      source.meal_group_id,
      source.meal_group_name,
      source.dietary_tags,
      source.source_kind,
      sum(source.weighted_count) as weighted_count,
      sum(source.head_count) as head_count
    from (
      select * from participant_sources
      union all
      select * from reserve_sources
    ) source
    group by source.meal_id, source.division_id, source.division_name,
      source.meal_group_id, source.meal_group_name, source.dietary_tags, source.source_kind
  ),
  eligible_regular as (
    select
      ingredient.*,
      source.division_id,
      source.division_name,
      source.meal_group_id,
      source.meal_group_name,
      source.dietary_tags,
      source.source_kind,
      source.weighted_count,
      source.head_count
    from meal_ingredients ingredient
    join grouped_sources source on source.meal_id = ingredient.meal_id
    where ingredient.mode in ('weighted_portion', 'head')
      and (
        ingredient.dietary_rule = 'standard'
        or (ingredient.dietary_rule = 'exclude' and not (
          lower(ingredient.dietary_tag_label) = any(source.dietary_tags)
        ))
        or (ingredient.dietary_rule = 'only' and (
          lower(ingredient.dietary_tag_label) = any(source.dietary_tags)
        ))
      )
  ),
  regular_lines as (
    select
      eligible.meal_id,
      eligible.copy_id,
      eligible.ingredient_key,
      eligible.ingredient_name,
      eligible.unit,
      eligible.amount,
      eligible.mode,
      eligible.dietary_rule,
      eligible.dietary_tag_label,
      eligible.recipe_name,
      eligible.version_key,
      sum(case when eligible.mode = 'head' then eligible.head_count else eligible.weighted_count end) as multiplier,
      jsonb_agg(jsonb_build_object(
        'source', eligible.source_kind,
        'division_id', eligible.division_id,
        'division', eligible.division_name,
        'meal_group_id', eligible.meal_group_id,
        'meal_group', eligible.meal_group_name,
        'dietary_tags', eligible.dietary_tags,
        'food_factor_sum', eligible.weighted_count::text,
        'head_count', eligible.head_count::text
      ) order by eligible.source_kind, eligible.division_name, eligible.meal_group_name, eligible.dietary_tags::text) as groups
    from eligible_regular eligible
    group by eligible.meal_id, eligible.copy_id, eligible.ingredient_key,
      eligible.ingredient_name, eligible.unit, eligible.amount, eligible.mode,
      eligible.dietary_rule, eligible.dietary_tag_label, eligible.recipe_name, eligible.version_key
  ),
  eligible_fixed as (
    select
      ingredient.*,
      source.division_id,
      source.division_name,
      source.meal_group_id,
      source.meal_group_name,
      source.dietary_tags,
      source.source_kind,
      source.weighted_count,
      source.head_count
    from meal_ingredients ingredient
    join grouped_sources source on source.meal_id = ingredient.meal_id
    where ingredient.mode = 'fixed_once_per_camp'
      and (
        ingredient.dietary_rule = 'standard'
        or (ingredient.dietary_rule = 'exclude' and not (
          lower(ingredient.dietary_tag_label) = any(source.dietary_tags)
        ))
        or (ingredient.dietary_rule = 'only' and (
          lower(ingredient.dietary_tag_label) = any(source.dietary_tags)
        ))
      )
  ),
  fixed_occurrences as (
    select
      eligible.meal_id,
      eligible.starts_at,
      eligible.copy_id,
      eligible.ingredient_key,
      eligible.ingredient_name,
      eligible.unit,
      eligible.amount,
      eligible.mode,
      eligible.dietary_rule,
      eligible.dietary_tag_label,
      eligible.recipe_name,
      eligible.version_key,
      jsonb_agg(jsonb_build_object(
        'source', eligible.source_kind,
        'division_id', eligible.division_id,
        'division', eligible.division_name,
        'meal_group_id', eligible.meal_group_id,
        'meal_group', eligible.meal_group_name,
        'dietary_tags', eligible.dietary_tags,
        'food_factor_sum', eligible.weighted_count::text,
        'head_count', eligible.head_count::text
      ) order by eligible.source_kind, eligible.division_name, eligible.meal_group_name, eligible.dietary_tags::text) as groups
    from eligible_fixed eligible
    group by eligible.meal_id, eligible.starts_at, eligible.copy_id,
      eligible.ingredient_key, eligible.ingredient_name, eligible.unit, eligible.amount,
      eligible.mode, eligible.dietary_rule, eligible.dietary_tag_label,
      eligible.recipe_name, eligible.version_key
  ),
  fixed_lines as (
    select occurrence.*
    from (
      select fixed_occurrences.*,
        row_number() over (
          partition by fixed_occurrences.copy_id, fixed_occurrences.ingredient_key
          order by fixed_occurrences.starts_at, fixed_occurrences.meal_id
        ) as occurrence_number
      from fixed_occurrences
    ) occurrence
    where occurrence.occurrence_number = 1
  ),
  all_lines as (
    select
      regular.meal_id,
      regular.copy_id,
      regular.ingredient_key,
      regular.ingredient_name,
      regular.unit,
      (regular.amount * regular.multiplier)::numeric(30,12) as exact_amount,
      regular.mode,
      regular.dietary_rule,
      regular.dietary_tag_label,
      regular.recipe_name,
      regular.version_key,
      regular.amount,
      regular.multiplier,
      regular.groups
    from regular_lines regular
    where regular.multiplier > 0
    union all
    select
      fixed.meal_id,
      fixed.copy_id,
      fixed.ingredient_key,
      fixed.ingredient_name,
      fixed.unit,
      fixed.amount::numeric(30,12) as exact_amount,
      fixed.mode,
      fixed.dietary_rule,
      fixed.dietary_tag_label,
      fixed.recipe_name,
      fixed.version_key,
      fixed.amount,
      1::numeric as multiplier,
      fixed.groups
    from fixed_lines fixed
    where fixed.amount > 0
  )
  insert into public.calculation_lines (
    organization_id, camp_id, calculation_revision_id, meal_id,
    camp_recipe_copy_id, ingredient_key, line_key, ingredient_name,
    exact_amount, unit, trace
  )
  select
    p_organization_id,
    p_camp_id,
    revision_id,
    line.meal_id,
    line.copy_id,
    line.ingredient_key,
    line.meal_id::text || ':' || line.ingredient_key,
    line.ingredient_name,
    line.exact_amount,
    line.unit,
    jsonb_build_object(
      'meal_id', line.meal_id,
      'recipe_copy_id', line.copy_id,
      'recipe_name', line.recipe_name,
      'recipe_version_key', line.version_key,
      'ingredient_key', line.ingredient_key,
      'mode', line.mode,
      'dietary_rule', line.dietary_rule,
      'dietary_tag_label', line.dietary_tag_label,
      'amount_per_unit', line.amount::text,
      'multiplier', line.multiplier::text,
      'formula', case
        when line.mode = 'fixed_once_per_camp' then 'fixed once when a relevant target group exists'
        when line.mode = 'head' then 'amount × present heads and factor-1 reserves'
        else 'amount × food-factor sum and factor-1 reserves'
      end,
      'groups', line.groups,
      'exact_amount', line.exact_amount::text
    )
  from all_lines line;

  insert into public.audit_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_organization_id, (select auth.uid()), 'camp_calculated',
    'calculation_revision', revision_id::text,
    jsonb_build_object(
      'camp_id', p_camp_id,
      'revision_number', next_revision,
      'input_digest', input_digest,
      'unreviewed_dietary_needs', unresolved_count,
      'meals_without_recipe', missing_recipe_count
    )
  );

  return revision_id;
end;
$$;

revoke all on function public.save_meal(uuid, uuid, timestamptz, text, text, uuid, jsonb) from public, anon;
revoke all on function public.calculate_camp(uuid, uuid) from public, anon;
grant execute on function public.save_meal(uuid, uuid, timestamptz, text, text, uuid, jsonb) to authenticated;
grant execute on function public.calculate_camp(uuid, uuid) to authenticated;
