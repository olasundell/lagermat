begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

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
  false,
  'the migration does not guess a complete plan for existing meals'
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
  1,
  'RLS exposes only the active organization meal slots'
);

select is(
  public.confirm_default_meal_plan(
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  )::integer,
  29,
  'confirmation fills the 29 missing breakfast lunch and dinner slots'
);

select is(
  (select count(*)::integer from public.camp_meal_slots),
  30,
  'the ten-day camp has exactly 30 configured standard slots'
);

select is(
  (select count(distinct service_date)::integer
   from public.camp_meal_slots),
  10,
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
  1,
  'the migrated meal remains planned after confirmation'
);

select is(
  (select unplanned_slots::integer
   from public.get_camp_readiness(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
     'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
   )),
  29,
  'every remaining required slot is visibly unplanned'
);

select lives_ok(
  $$select public.set_meal_slot_service_status(
    (select id from public.camp_meal_slots
     where service_date = '2026-08-02'
       and meal_type = 'breakfast'),
    'no_service'
  )$$,
  'a planner can explicitly mark a gap as no service'
);

select is(
  (select no_service_slots::text || '|' || unplanned_slots::text
   from public.get_camp_readiness(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
     'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
   )),
  '1|28',
  'no service is distinct from an unplanned required slot'
);

select lives_ok(
  $$select public.save_meal_to_slot(
    null,
    (select id from public.camp_meal_slots
     where service_date = '2026-08-03'
       and meal_type = 'breakfast'),
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Havregrynsgröt',
    (select version.id
     from public.recipe_versions as version
     where version.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and version.status = 'published'
     order by version.id
     limit 1),
    '[]'::jsonb
  )$$,
  'planning from a gap creates a meal in the selected slot'
);

select is(
  (select count(distinct meal_slot_id)::integer from public.meals),
  2,
  'the new meal keeps the one-to-one slot relation'
);

select throws_ok(
  $$select public.save_meal_to_slot(
    null,
    (select meal_slot_id from public.meals
     where title = 'Havregrynsgröt'),
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Dubbelbokning',
    (select version.id
     from public.recipe_versions as version
     where version.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and version.status = 'published'
     order by version.id
     limit 1),
    '[]'::jsonb
  )$$,
  '23505',
  'Meal slot is already planned',
  'the server rejects a second meal in the same slot'
);

select lives_ok(
  $$select public.set_meal_slot_service_status(
    (select meal_slot_id from public.meals
     where title = 'Havregrynsgröt'),
    'no_service'
  )$$,
  'a planner can skip an already planned meal'
);

select is(
  (select count(*)::integer
   from public.meals
   where title = 'Havregrynsgröt'),
  1,
  'skipping preserves the planned meal for restoration'
);

select is(
  (select no_service_slots::text || '|' || planned_slots::text || '|' || unplanned_slots::text
   from public.get_camp_readiness(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
     'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
   )),
  '2|1|27',
  'a skipped planned meal is excluded from required and planned coverage'
);

select lives_ok(
  $$select public.calculate_camp(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  )$$,
  'draft calculation remains available while structural gaps remain'
);

select is(
  (select problem_summary ->> 'is_draft'
   from public.calculation_revisions
   where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
     and camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
     and status = 'current'),
  'true',
  'a calculation with structural gaps is persistently marked as a draft'
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
      and meal.title = 'Havregrynsgröt'
  ),
  'a skipped meal contributes no calculation lines'
);

select lives_ok(
  $$select public.set_meal_slot_service_status(
    (select meal_slot_id from public.meals
     where title = 'Havregrynsgröt'),
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
      and meal.title = 'Havregrynsgröt'
  ),
  'restoring a skipped meal brings it back into the calculation'
);

select is(
  (select can_finalize
   from public.get_camp_readiness(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
     'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
   )),
  true,
  'the same readiness gate becomes complete after every issue is resolved'
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

select lives_ok(
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
  'the server permits final status after the shared readiness gate passes'
);

select * from finish();
rollback;
