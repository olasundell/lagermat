begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

-- This fixture isolates the gate from the main demo: the one participant
-- leaves exactly when the first meal starts, which must remain excluded by the
-- established [starts_at, ends_at) attendance contract.
insert into public.camps (
  id,
  organization_id,
  name,
  starts_on,
  ends_on,
  timezone,
  status,
  meal_plan_confirmed_at,
  meal_plan_confirmed_by,
  created_by
) values (
  'c9700000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Nollnärvaro- och serie-regression',
  '2026-10-02',
  '2026-10-04',
  'Europe/Stockholm',
  'draft',
  now(),
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.participants (
  id,
  organization_id,
  camp_id,
  display_name,
  lifecycle_status
) values (
  'b9700000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'c9700000-0000-0000-0000-000000000001',
  'Avreser vid måltidsstart',
  'active'
);

insert into public.participant_attendance (
  organization_id,
  camp_id,
  participant_id,
  starts_at,
  ends_at,
  active,
  source
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'c9700000-0000-0000-0000-000000000001',
  'b9700000-0000-0000-0000-000000000001',
  '2026-10-02T08:00:00+02',
  '2026-10-02T10:00:00+02',
  true,
  'local'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

select lives_ok(
  $$select public.save_repeating_extra_meals(
    'c9700000-0000-0000-0000-000000000001',
    array['2026-10-02'::date],
    '10:00'::time,
    'other',
    'Måltid vid avresa',
    (select id from public.recipe_versions
     where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and status = 'published'
     order by id limit 1),
    '[]'::jsonb
  )$$,
  'a planner can create a meal at the exact attendance end boundary'
);

select is(
  (select count(*)::integer from public.get_zero_attendance_meals(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9700000-0000-0000-0000-000000000001'
  )),
  1,
  'a participant is absent exactly at attendance.ends_at'
);

select is(
  (select zero_attendance_slots::integer from public.get_camp_readiness(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9700000-0000-0000-0000-000000000001'
  )),
  1,
  'readiness reports the planned meal with no source'
);

select ok(
  not (select can_finalize from public.get_camp_readiness(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9700000-0000-0000-0000-000000000001'
  )),
  'zero attendance blocks the shared finalisation gate'
);

select lives_ok(
  $$select public.calculate_camp(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9700000-0000-0000-0000-000000000001'
  )$$,
  'a draft calculation remains available for a zero-attendance warning'
);

select is(
  (select problem_summary ->> 'zero_attendance_slots'
   from public.calculation_revisions
   where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
     and camp_id = 'c9700000-0000-0000-0000-000000000001'
     and status = 'current'),
  '1',
  'the calculation revision preserves the zero-attendance reason'
);

select lives_ok(
  $$select public.save_meal_to_slot(
    (select id from public.meals where camp_id = 'c9700000-0000-0000-0000-000000000001' and title = 'Måltid vid avresa'),
    (select meal_slot_id from public.meals where camp_id = 'c9700000-0000-0000-0000-000000000001' and title = 'Måltid vid avresa'),
    'c9700000-0000-0000-0000-000000000001',
    'Måltid vid avresa',
    (select id from public.recipe_versions
     where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and status = 'published'
     order by id limit 1),
    '[{"dietary_label":"standardkost","portions":1}]'::jsonb
  )$$,
  'a positive reserve can supply an otherwise empty meal'
);

select is(
  (select zero_attendance_slots::integer from public.get_camp_readiness(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9700000-0000-0000-0000-000000000001'
  )),
  0,
  'a positive reserve clears the zero-attendance finding'
);

select lives_ok(
  $$select public.save_meal_to_slot(
    (select id from public.meals where camp_id = 'c9700000-0000-0000-0000-000000000001' and title = 'Måltid vid avresa'),
    (select meal_slot_id from public.meals where camp_id = 'c9700000-0000-0000-0000-000000000001' and title = 'Måltid vid avresa'),
    'c9700000-0000-0000-0000-000000000001',
    'Måltid vid avresa',
    (select id from public.recipe_versions
     where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and status = 'published'
     order by id limit 1),
    '[]'::jsonb
  )$$,
  'the reserve can be removed again for the no-service regression'
);

select is(
  (select zero_attendance_slots::integer from public.get_camp_readiness(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9700000-0000-0000-0000-000000000001'
  )),
  1,
  'removing the only reserve restores the finding'
);

select lives_ok(
  $$select public.set_meal_slot_service_status(
    (select meal_slot_id from public.meals where camp_id = 'c9700000-0000-0000-0000-000000000001' and title = 'Måltid vid avresa'),
    'no_service'
  )$$,
  'a planner can mark the empty meal as no service'
);

select is(
  (select zero_attendance_slots::integer from public.get_camp_readiness(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9700000-0000-0000-0000-000000000001'
  )),
  0,
  'no-service meals do not remain zero-attendance findings'
);

select lives_ok(
  $$select public.save_repeating_extra_meals(
    'c9700000-0000-0000-0000-000000000001',
    array['2026-10-04'::date],
    '20:00'::time,
    'evening',
    'Upptaget tillfälle',
    (select id from public.recipe_versions
     where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and status = 'published'
     order by id limit 1),
    '[]'::jsonb
  )$$,
  'a separate occupied slot sets up an atomic-series conflict'
);

select throws_ok(
  $$select public.save_repeating_extra_meals(
    'c9700000-0000-0000-0000-000000000001',
    array['2026-10-03'::date, '2026-10-04'::date],
    '20:00'::time,
    'evening',
    'Serie som ska rulla tillbaka',
    (select id from public.recipe_versions
     where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and status = 'published'
     order by id limit 1),
    '[]'::jsonb
  )$$,
  '23505',
  'A selected meal slot already has a different meal',
  'a conflict rejects the complete repeating series'
);

select is(
  (select count(*)::integer from public.meals
   where camp_id = 'c9700000-0000-0000-0000-000000000001'
     and title = 'Serie som ska rulla tillbaka'),
  0,
  'an atomic repeating conflict leaves no partial meal on the earlier date'
);

select lives_ok(
  $$select public.save_repeating_extra_meals(
    'c9700000-0000-0000-0000-000000000001',
    array['2026-10-03'::date, '2026-10-04'::date],
    '18:30'::time,
    'evening',
    'Idempotent kvällsmål',
    (select id from public.recipe_versions
     where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and status = 'published'
     order by id limit 1),
    '[]'::jsonb
  )$$,
  'the selected repeating meals are created together'
);

select is(
  (public.save_repeating_extra_meals(
    'c9700000-0000-0000-0000-000000000001',
    array['2026-10-03'::date, '2026-10-04'::date],
    '18:30'::time,
    'evening',
    'Idempotent kvällsmål',
    (select id from public.recipe_versions
     where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and status = 'published'
     order by id limit 1),
    '[]'::jsonb
  ) ->> 'created')::integer,
  0,
  'an identical retry creates no duplicate meals'
);

select is(
  (select count(*)::integer from public.meals
   where camp_id = 'c9700000-0000-0000-0000-000000000001'
     and title = 'Idempotent kvällsmål'),
  2,
  'the retry reuses exactly the original selected dates'
);

select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222',
  true
);

select throws_ok(
  $$select public.save_repeating_extra_meals(
    'c9700000-0000-0000-0000-000000000001',
    array['2026-10-02'::date],
    '17:00'::time,
    'other',
    'Otillåten annan organisation',
    (select id from public.recipe_versions
     where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and status = 'published'
     order by id limit 1),
    '[]'::jsonb
  )$$,
  '42501',
  'Camp not found',
  'a non-member cannot create a repeating meal in another tenant'
);

select * from finish();
rollback;
