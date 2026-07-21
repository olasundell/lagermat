begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

-- Fixture construction deliberately bypasses the production write boundary.
-- The grants are transaction-local because this entire test rolls back.
grant insert, update, delete on public.organizations, public.camps,
  public.recipes, public.recipe_versions, public.recipe_ingredients,
  public.meals, public.participants, public.participant_attendance
  to authenticated;

select is(
  (select count(*)::integer
   from app_private.recipe_ingredient_templates ingredient
   join app_private.recipe_templates template on template.id = ingredient.recipe_template_id
   where template.template_key in ('auberginegryta', 'pasta-carbonara', 'frukost')
     and (
       (ingredient.name = 'Aubergine' and ingredient.unit = 'st'
         and ingredient.amount = 0.25 and ingredient.mode = 'weighted_portion')
       or (ingredient.name = 'Bacon' and ingredient.unit = 'kg'
         and ingredient.amount = 0.05 and ingredient.mode = 'weighted_portion')
       or (ingredient.name = 'Matfett' and ingredient.unit = 'paket'
         and ingredient.amount = 0.0025 and ingredient.mode = 'weighted_portion')
       or (ingredient.name = 'Matfett' and ingredient.unit = 'paket'
         and ingredient.amount = 10 and ingredient.mode = 'fixed_once_per_camp')
     )),
  4,
  'the approved catalogue preserves every ingredient rule used by the golden fixture'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '50000000-0000-0000-0000-000000000005',
  'authenticated',
  'authenticated',
  'golden-admin@example.test',
  '',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000005', true);

insert into public.organizations (id, name, slug, created_by)
values (
  'f0000000-0000-0000-0000-000000000001',
  'Golden organisation',
  'golden-organisation',
  '50000000-0000-0000-0000-000000000005'
);

insert into public.camps (id, organization_id, name, starts_on, ends_on, created_by)
values (
  'f1000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000001',
  'Golden läger',
  '2026-08-02',
  '2026-08-05',
  '50000000-0000-0000-0000-000000000005'
);

insert into public.recipes (id, organization_id, name, created_by) values
  ('f2000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'Golden Aubergine', '50000000-0000-0000-0000-000000000005'),
  ('f2000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'Golden Bacon', '50000000-0000-0000-0000-000000000005'),
  ('f2000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 'Golden Bregott', '50000000-0000-0000-0000-000000000005'),
  ('f2000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000001', 'Golden behov', '50000000-0000-0000-0000-000000000005');

insert into public.recipe_versions (
  id, organization_id, recipe_id, version_number, status, instructions,
  content_digest, created_by, published_at
) values
  ('f2100000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 1, 'published', 'Golden fixture', repeat('1', 64), '50000000-0000-0000-0000-000000000005', now()),
  ('f2100000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000002', 1, 'published', 'Golden fixture', repeat('2', 64), '50000000-0000-0000-0000-000000000005', now()),
  ('f2100000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000003', 1, 'published', 'Golden fixture', repeat('3', 64), '50000000-0000-0000-0000-000000000005', now()),
  ('f2100000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000004', 1, 'published', 'Golden fixture', repeat('4', 64), '50000000-0000-0000-0000-000000000005', now());

insert into public.recipe_ingredients (
  id, organization_id, recipe_version_id, name, unit, amount, mode,
  dietary_rule, dietary_tag_label, sort_order
) values
  ('f2200000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'f2100000-0000-0000-0000-000000000001', 'Aubergine', 'st', 0.25, 'weighted_portion', 'standard', null, 0),
  ('f2200000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'f2100000-0000-0000-0000-000000000002', 'Bacon', 'kg', 0.05, 'weighted_portion', 'exclude', 'Vegetarian', 0),
  ('f2200000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 'f2100000-0000-0000-0000-000000000003', 'Bregott', 'paket', 0.0025, 'weighted_portion', 'exclude', 'Mjölkprotein', 0),
  ('f2200000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000001', 'f2100000-0000-0000-0000-000000000003', 'Bregott', 'paket', 10, 'fixed_once_per_camp', 'exclude', 'Mjölkprotein', 1),
  ('f2200000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000001', 'f2100000-0000-0000-0000-000000000004', 'Golden behov/beställt', 'kg', 0.55, 'weighted_portion', 'standard', null, 0);

do $$
begin
  perform public.freeze_recipe_version('f1000000-0000-0000-0000-000000000001', 'f2100000-0000-0000-0000-000000000001');
  perform public.freeze_recipe_version('f1000000-0000-0000-0000-000000000001', 'f2100000-0000-0000-0000-000000000002');
  perform public.freeze_recipe_version('f1000000-0000-0000-0000-000000000001', 'f2100000-0000-0000-0000-000000000003');
  perform public.freeze_recipe_version('f1000000-0000-0000-0000-000000000001', 'f2100000-0000-0000-0000-000000000004');
end
$$;

insert into public.meals (
  id, organization_id, camp_id, camp_recipe_copy_id, starts_at, meal_type, title, status
)
select source.meal_id, 'f0000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000001', copy.id,
  source.starts_at, source.meal_type, source.title, 'ready'
from (values
  ('f2300000-0000-0000-0000-000000000001'::uuid, 'f2100000-0000-0000-0000-000000000001'::uuid, '2026-08-03T08:00:00Z'::timestamptz, 'breakfast', 'Golden Aubergine'),
  ('f2300000-0000-0000-0000-000000000002'::uuid, 'f2100000-0000-0000-0000-000000000002'::uuid, '2026-08-03T12:00:00Z'::timestamptz, 'lunch', 'Golden Bacon'),
  ('f2300000-0000-0000-0000-000000000003'::uuid, 'f2100000-0000-0000-0000-000000000003'::uuid, '2026-08-03T18:00:00Z'::timestamptz, 'dinner', 'Golden Bregott'),
  ('f2300000-0000-0000-0000-000000000004'::uuid, 'f2100000-0000-0000-0000-000000000004'::uuid, '2026-08-04T12:00:00Z'::timestamptz, 'lunch', 'Golden behov/beställt')
) source(meal_id, version_id, starts_at, meal_type, title)
join public.camp_recipe_copies copy on copy.source_recipe_version_id = source.version_id;

with scenario as (
  select * from (values
    ('aubergine', 3, 2.8::numeric),
    ('bacon', 9, 6.5::numeric),
    ('bregott', 35, 4.1::numeric),
    ('behov', 1, 10::numeric)
  ) value(scenario_key, participant_count, final_factor)
), factors as (
  select scenario.scenario_key, participant_number,
    case when participant_number = scenario.participant_count
      then scenario.final_factor else 10::numeric end as food_factor
  from scenario
  cross join lateral generate_series(1, scenario.participant_count) participant_number
)
insert into public.participants (
  organization_id, camp_id, display_name, food_factor, source_reference
)
select 'f0000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000001',
  'Golden ' || factor.scenario_key || ' ' || factor.participant_number,
  factor.food_factor,
  'golden-' || factor.scenario_key || '-' || factor.participant_number
from factors factor;

insert into public.participant_attendance (
  organization_id, camp_id, participant_id, starts_at, ends_at
)
select participant.organization_id, participant.camp_id, participant.id,
  case
    when participant.source_reference like 'golden-aubergine-%' then '2026-08-03T07:00:00Z'::timestamptz
    when participant.source_reference like 'golden-bacon-%' then '2026-08-03T11:00:00Z'::timestamptz
    when participant.source_reference like 'golden-bregott-%' then '2026-08-03T17:00:00Z'::timestamptz
    else '2026-08-04T11:00:00Z'::timestamptz
  end,
  case
    when participant.source_reference like 'golden-aubergine-%' then '2026-08-03T09:00:00Z'::timestamptz
    when participant.source_reference like 'golden-bacon-%' then '2026-08-03T13:00:00Z'::timestamptz
    when participant.source_reference like 'golden-bregott-%' then '2026-08-03T19:00:00Z'::timestamptz
    else '2026-08-04T13:00:00Z'::timestamptz
  end
from public.participants participant
where participant.organization_id = 'f0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$select public.calculate_camp(
    'f0000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000001'
  )$$,
  'the database calculates the isolated golden fixture'
);

select is(
  (select sum(line.exact_amount) from public.calculation_lines line where line.ingredient_name = 'Aubergine'),
  5.7::numeric,
  'Aubergine is exactly 5.7 st'
);
select is(
  (select sum(line.exact_amount) from public.calculation_lines line where line.ingredient_name = 'Bacon'),
  4.325::numeric,
  'Bacon is exactly 4.325 kg'
);
select is(
  (select sum(line.exact_amount) from public.calculation_lines line where line.ingredient_name = 'Bregott'),
  10.86025::numeric,
  'Bregott is exactly 10.86025 packages'
);
select is(
  (select count(distinct line.trace ->> 'mode')::integer
   from public.calculation_lines line where line.ingredient_name = 'Bregott'),
  2,
  'Bregott retains its weighted and fixed-once components'
);

select lives_ok(
  $$select public.generate_supply_lists(
    'f0000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000001'
  )$$,
  'the exact calculation generates procurement lists'
);

select is(
  (select public.apply_supply_item_mutation(
    item.organization_id,
    item.camp_id,
    item.id,
    'f2400000-0000-0000-0000-000000000001',
    item.row_version,
    jsonb_build_object(
      'ordered_amount', item.ordered_amount,
      'ordered_unit', item.ordered_unit,
      'package_note', item.package_note,
      'comment', item.comment,
      'completed', item.completed
    ),
    '{"ordered_amount":6,"ordered_unit":"kg"}'::jsonb
  ) ->> 'status'
  from public.supply_list_items item
  join public.supply_lists list on list.id = item.supply_list_id
  where list.kind = 'purchase' and item.item_name = 'Golden behov/beställt'),
  'applied',
  'an ordered amount can be added without changing the calculated need'
);

select ok(
  (select item.required_amount = 5.5::numeric
      and item.required_unit = 'kg'
      and item.ordered_amount = 6::numeric
      and item.ordered_unit = 'kg'
   from public.supply_list_items item
   join public.supply_lists list on list.id = item.supply_list_id
   where list.kind = 'purchase' and item.item_name = 'Golden behov/beställt'),
  '5.5 kg required and 6 kg ordered coexist as separate values'
);

select * from finish();
rollback;
