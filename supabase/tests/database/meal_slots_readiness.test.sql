begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

update public.participant_dietary_needs
set review_status = 'unreviewed',
    reviewed_by = null,
    reviewed_at = null
where id = 'f2000000-0000-0000-0000-000000000004'
  and organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  and camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';

select is(
  (select count(*)::integer
   from public.meals
   where meal_slot_id is not null),
  (select count(*)::integer from public.meals),
  'every existing or legacy-inserted meal has one persistent slot'
);

select is(
  (select count(distinct meal_slot_id)::integer from public.meals),
  (select count(*)::integer from public.meals),
  'one slot cannot be linked to more than one meal'
);

select is(
  (select meal_plan_confirmed_at is not null
   from public.camps
   where id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  true,
  'the complete demo menu explicitly confirms its meal plan'
);

select is(
  (select required_slots::integer
   from public.get_camp_readiness(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
     'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
   )),
  null,
  'readiness is not exposed without an authenticated tenant member'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

select is(
  (select count(*)::integer from public.camp_meal_slots),
  12,
  'RLS exposes the twelve configured demo menu slots'
);

select is(
  public.confirm_default_meal_plan(
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  )::integer,
  0,
  'confirmation is idempotent when the complete demo plan is already configured'
);

select is(
  (select count(*)::integer from public.camp_meal_slots),
  12,
  'the four-day camp has exactly twelve configured standard slots'
);

select is(
  (select count(distinct service_date)::integer
   from public.camp_meal_slots),
  4,
  'every inclusive camp date is represented'
);

select ok(
  not exists (
    select 1
    from public.camp_meal_slots
    group by service_date
    having count(*) filter (
      where meal_type in ('breakfast', 'lunch', 'dinner')
    ) <> 3
  ),
  'each camp date has breakfast lunch and dinner'
);

select is(
  (select meal_plan_confirmed
   from public.get_camp_readiness(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
     'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
   )),
  true,
  'readiness records the explicitly confirmed structure'
);

select is(
  (select planned_slots::integer
   from public.get_camp_readiness(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
     'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
   )),
  12,
  'the complete demo menu plans every required slot'
);

select is(
  (select unplanned_slots::integer
   from public.get_camp_readiness(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
     'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
   )),
  0,
  'the complete demo menu leaves no required slot unplanned'
);

reset role;
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
  source,
  sort_order
) values (
  'a5000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'test:evening',
  '2026-08-04',
  '2026-08-04 20:00:00+02',
  'evening',
  'Kvällsfika',
  'required',
  'extra',
  40
);
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

select lives_ok(
  $$select public.set_meal_slot_service_status(
    (select id from public.camp_meal_slots
     where service_date = '2026-08-02'
       and meal_type = 'breakfast'),
    'no_service'
  )$$,
  'a planner can explicitly skip a planned meal'
);

select is(
  (select no_service_slots::text || '|' || planned_slots::text || '|' || unplanned_slots::text
   from public.get_camp_readiness(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
     'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
   )),
  '1|11|1',
  'no service is distinct from an unplanned required slot'
);

select lives_ok(
  $$select public.save_meal_to_slot(
    null,
    'a5000000-0000-0000-0000-000000000001',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Kvällsfika',
    (select version.id
     from public.recipe_versions as version
     join public.recipes as recipe
       on recipe.organization_id = version.organization_id
      and recipe.id = version.recipe_id
     where version.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and version.status = 'published'
       and recipe.name = 'Kvällsfika'),
    '[]'::jsonb
  )$$,
  'planning from an extra gap creates a meal in the selected slot'
);

select is(
  (select count(distinct meal_slot_id)::integer from public.meals),
  13,
  'the new meal keeps the one-to-one slot relation'
);

select throws_ok(
  $$select public.save_meal_to_slot(
    null,
    (select meal_slot_id from public.meals
     where title = 'Kvällsfika'),
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Dubbelbokning',
    (select version.id
     from public.recipe_versions as version
     join public.recipes as recipe
       on recipe.organization_id = version.organization_id
      and recipe.id = version.recipe_id
     where version.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and version.status = 'published'
       and recipe.name = 'Kvällsfika'),
    '[]'::jsonb
  )$$,
  '23505',
  'Meal slot is already planned',
  'the server rejects a second meal in the same slot'
);

select lives_ok(
  $$select public.set_meal_slot_service_status(
    (select meal_slot_id from public.meals
     where title = 'Kvällsfika'),
    'no_service'
  )$$,
  'a planner can skip an already planned meal'
);

select is(
  (select count(*)::integer
   from public.meals
   where title = 'Kvällsfika'),
  1,
  'skipping preserves the planned meal for restoration'
);

select is(
  (select no_service_slots::text || '|' || planned_slots::text || '|' || unplanned_slots::text
   from public.get_camp_readiness(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
     'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
   )),
  '2|11|0',
  'a skipped planned meal is excluded from required and planned coverage'
);

select lives_ok(
  $$select public.calculate_camp(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  )$$,
  'draft calculation remains available while readiness has unresolved issues'
);

select is(
  (select problem_summary ->> 'is_draft'
   from public.calculation_revisions
   where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
     and camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
     and status = 'current'),
  'true',
  'a calculation with unresolved readiness issues is persistently marked as a draft'
);

select ok(
  not exists (
    select 1
    from public.calculation_lines as line
    join public.meals as meal on meal.id = line.meal_id
    where line.calculation_revision_id = (
      select revision.id
      from public.calculation_revisions as revision
      where revision.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
        and revision.camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
        and revision.status = 'current'
    )
      and meal.title = 'Kvällsfika'
  ),
  'a skipped meal contributes no calculation lines'
);

select lives_ok(
  $$select public.set_meal_slot_service_status(
    (select meal_slot_id from public.meals
     where title = 'Kvällsfika'),
    'required'
  )$$,
  'a skipped meal can be restored without recreating it'
);

select throws_ok(
  $$select public.set_supply_list_status(
    'a2000000-0000-0000-0000-000000000006',
    1,
    'complete'
  )$$,
  '22023',
  'Camp readiness must be complete before final status',
  'the server rejects final status while shared readiness is incomplete'
);

select lives_ok(
  $$select public.set_meal_slot_service_status(
    (select id from public.camp_meal_slots
     where service_date = '2026-08-02'
       and meal_type = 'breakfast'),
    'required'
  )$$,
  'changing a slot after calculation is accepted'
);

select is(
  (select calculation_stale
   from public.get_camp_readiness(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
     'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
   )),
  true,
  'a slot change deterministically stales the relevant calculation'
);

reset role;
update public.camp_meal_slots as slot
set service_status = 'no_service'
where slot.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  and slot.camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  and not exists (
    select 1 from public.meals as meal
    where meal.meal_slot_id = slot.id
  );
update public.participant_dietary_needs
set review_status = 'resolved',
    reviewed_by = '11111111-1111-1111-1111-111111111111',
    reviewed_at = now()
where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  and camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);
select public.calculate_camp(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
);

select ok(
  exists (
    select 1
    from public.calculation_lines as line
    join public.meals as meal on meal.id = line.meal_id
    where line.calculation_revision_id = (
      select revision.id
      from public.calculation_revisions as revision
      where revision.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
        and revision.camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
        and revision.status = 'current'
    )
      and meal.title = 'Kvällsfika'
  ),
  'restoring a skipped meal brings it back into the calculation'
);

select is(
  (select
     unplanned_slots::text || '|' ||
     unresolved_dietary_needs::text || '|' ||
     meals_without_recipe::text || '|' ||
     calculation_stale::text || '|' ||
     procurement_ready::text || '|' ||
     can_finalize::text
   from public.get_camp_readiness(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
     'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
   )),
  '0|0|0|false|true|true',
  'meal readiness is complete before current purchase rows are generated'
);

select public.generate_supply_lists(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
);
reset role;
update public.supply_list_items
set completed = true
where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  and camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  and source_present;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

select throws_ok(
  $$select public.set_supply_list_status(
    (select id from public.supply_lists
     where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and source_present
     order by kind, id
     limit 1),
    (select version from public.supply_lists
     where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and source_present
     order by kind, id
     limit 1),
    'complete'
  )$$,
  '22023',
  'Camp readiness must be complete before final status',
  'checking purchase rows alone cannot bypass unresolved procurement'
);

select * from finish();
rollback;
