begin;

create extension if not exists pgtap with schema extensions;
select plan(96);

-- Restore only the historical fixture-building privileges inside this rolled
-- back transaction. Production privilege assertions live in security.test.sql.
grant insert, update, delete on public.organizations, public.camps,
  public.organization_memberships, public.organization_invitations,
  public.recipes, public.recipe_versions, public.recipe_ingredients,
  public.meals, public.participants
  to authenticated;
revoke insert, update, delete on public.camp_recipe_copies from authenticated;
create policy invitations_test_admin_insert
  on public.organization_invitations
  for insert to authenticated
  with check (public.is_org_admin(organization_id));

select is(
  (select count(*)::integer
   from public.recipe_versions
   where id in (select id from app_private.recipe_templates)),
  25,
  'the local seed clones all 25 approved catalogue recipes'
);
select is(
  (select count(*)::integer
   from public.recipe_ingredients ingredient
   join public.recipe_versions version on version.id = ingredient.recipe_version_id
  where version.id in (select id from app_private.recipe_templates)),
  238,
  'the local seed clones 238 curated physical ingredient components'
);
select is(
  (select count(distinct ingredient.mode)::integer
   from public.recipe_ingredients ingredient
   join public.recipe_versions version on version.id = ingredient.recipe_version_id
   where version.id in (select id from app_private.recipe_templates)),
  3,
  'the approved catalogue contains weighted portion, head and fixed once per camp modes'
);
select is(
  (select count(distinct ingredient.dietary_rule)::integer
   from public.recipe_ingredients ingredient
   join public.recipe_versions version on version.id = ingredient.recipe_version_id
   where version.id in (select id from app_private.recipe_templates)),
  3,
  'the approved catalogue contains standard, exclude and only dietary rules'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin-a@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'admin-b@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'planner-a@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'invited-a@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.aal', 'aal2', true);

insert into public.organizations (id, name, slug, created_by)
values ('a0000000-0000-0000-0000-000000000001', 'Organisation A', 'organisation-a', '10000000-0000-0000-0000-000000000001');
insert into public.camps (id, organization_id, name, starts_on, ends_on, created_by)
values ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Läger A', '2026-08-02', '2026-08-11', '10000000-0000-0000-0000-000000000001');
insert into public.organization_memberships (organization_id, user_id, role)
values ('a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'planner');
insert into public.organization_invitations (
  id,
  organization_id,
  email,
  token_hash,
  invited_by,
  expires_at
) values (
  'a9000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'invited-a@example.test',
  null,
  '10000000-0000-0000-0000-000000000001',
  now() + interval '1 day'
);

select is((select count(*)::integer from public.organizations), 1, 'admin A sees exactly its own organization');
select ok(public.is_org_admin('a0000000-0000-0000-0000-000000000001'), 'organization creator becomes admin');
select is(
  (select count(*)::integer from public.list_organization_members('a0000000-0000-0000-0000-000000000001')),
  2,
  'admin can list organization members with local auth profiles'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
insert into public.organizations (id, name, slug, created_by)
values ('b0000000-0000-0000-0000-000000000002', 'Organisation B', 'organisation-b', '20000000-0000-0000-0000-000000000002');
insert into public.camps (id, organization_id, name, starts_on, ends_on, created_by)
values ('b1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Läger B', '2026-09-01', '2026-09-03', '20000000-0000-0000-0000-000000000002');

select is((select count(*)::integer from public.organizations), 1, 'admin B cannot read organization A');
select is((select count(*)::integer from public.camps), 1, 'admin B cannot read camp A');
select throws_ok(
  $$insert into public.camps (organization_id, name, starts_on, ends_on, created_by)
    values ('a0000000-0000-0000-0000-000000000001', 'Intrång', '2026-08-02', '2026-08-03', '20000000-0000-0000-0000-000000000002')$$,
  '42501',
  'new row violates row-level security policy for table "camps"',
  'admin B cannot write into organization A'
);
select throws_ok(
  $$select public.import_participant_batch(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'cross-tenant.csv',
    'csv',
    'Sheet1',
    '[]'::jsonb,
    array[]::text[],
    0,
    0,
    '[{"source_row":2,"display_name":"Intrång","division":null,"patrol":null,"meal_group":null,"food_factor":1,"attendance_start":"2026-08-02T00:00:00Z","attendance_end":"2026-08-03T00:00:00Z","dietary_note":null}]'::jsonb
  )$$,
  '42501',
  'Active organization membership required',
  'a member of another tenant cannot import into organization A'
);

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.organizations), 1, 'planner A sees organization A');
select is((select count(*)::integer from public.camps), 1, 'planner A sees camp A only');
select throws_ok(
  $$insert into public.organization_invitations (organization_id, email, token_hash, invited_by, expires_at)
    values ('a0000000-0000-0000-0000-000000000001', 'blocked@example.test', repeat('a', 64), '30000000-0000-0000-0000-000000000003', now() + interval '1 day')$$,
  '42501',
  'new row violates row-level security policy for table "organization_invitations"',
  'planner cannot create invitations'
);
select throws_ok(
  $$select * from public.list_organization_members('a0000000-0000-0000-0000-000000000001')$$,
  '42501',
  'AAL2 administrator session required',
  'planner cannot list member auth profiles'
);
select lives_ok(
  $$select public.import_participant_batch(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'scoutnet-safe.csv',
    'csv',
    'Sheet1',
    '[{"index":0,"source":"Namn","target":"display_name"},{"index":1,"source":"Personnummer","target":"ignore"},{"index":2,"source":"Specialkost","target":"diet_note"}]'::jsonb,
    array['Personnummer', 'E-post', 'Hälsodeklaration - Sjukdomar'],
    1,
    0,
    '[
      {"source_row":2,"display_name":"Ada Scout","division":"Upptäckarna","patrol":"Örnen","meal_group":"Matlag 1","food_factor":1,"attendance_start":"2026-08-02T00:00:00Z","attendance_end":"2026-08-04T00:00:00Z","dietary_note":"Gluten"},
      {"source_row":3,"display_name":"Bertil Scout","division":"Spårarna","patrol":"Räven","meal_group":"Matlag 2","food_factor":0.7,"attendance_start":"2026-08-03T00:00:00Z","attendance_end":"2026-08-05T00:00:00Z","dietary_note":null}
    ]'::jsonb
  )$$,
  'planner can atomically import a sanitized participant batch'
);
select is((select count(*)::integer from public.participants), 2, 'the sanitized batch creates only accepted participants');
select is((select count(*)::integer from public.participant_attendance), 2, 'each imported participant receives a bounded attendance period');
select is((select string_agg(raw_food_note, ',') from public.participant_dietary_needs), 'Gluten', 'only food-related free text is persisted');
select ok(
  (select bool_and(
    validation_summary::text !~* 'example\\.test|20100101|Astma'
    and column_mapping::text !~* 'example\\.test|20100101|Astma'
  ) from public.import_batches),
  'batch trace stores mapping and counts without discarded source values'
);
select throws_ok(
  $$select public.import_participant_batch(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'unsafe.csv',
    'csv',
    'Sheet1',
    '[]'::jsonb,
    array[]::text[],
    0,
    0,
    '[{"source_row":2,"display_name":"Unsafe","division":null,"patrol":null,"meal_group":null,"food_factor":1,"attendance_start":"2026-08-02T00:00:00Z","attendance_end":"2026-08-03T00:00:00Z","dietary_note":null,"email":"secret@example.test"}]'::jsonb
  )$$,
  '22023',
  'Import rows contain a non-persistent field',
  'server rejects non-persistent source fields even if a client is modified'
);
select is(
  (select unresolved_dietary_needs::integer from public.get_camp_readiness(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001'
  )),
  1,
  'unreviewed imported food text blocks camp readiness'
);
select lives_ok(
  $$select public.review_dietary_need(
    (select id from public.participant_dietary_needs where raw_food_note = 'Gluten'),
    array['Gluten']
  )$$,
  'planner can explicitly review raw food text into a dietary tag'
);
select is(
  (select count(*)::integer from public.dietary_need_tags),
  1,
  'review persists the normalized dietary tag relation'
);
select is(
  (select unresolved_dietary_needs::integer from public.get_camp_readiness(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001'
  )),
  0,
  'reviewed food text no longer blocks the dietary readiness count'
);
select lives_ok(
  $$select public.update_participant_details(
    (select id from public.participants where display_name = 'Ada Scout'),
    'Ada Uppdaterad',
    'Upptäckarna',
    'Höken',
    'Matlag 3',
    0.8,
    '2026-08-03T08:00:00Z',
    '2026-08-04T18:00:00Z'
  )$$,
  'planner can atomically update participant groups, factor and attendance'
);
select is(
  (select concat(participant.display_name, '|', participant.food_factor, '|', attendance.starts_at, '|', attendance.ends_at)
   from public.participants participant
   join public.participant_attendance attendance on attendance.participant_id = participant.id
   where participant.display_name = 'Ada Uppdaterad'),
  'Ada Uppdaterad|0.8000|2026-08-03 08:00:00+00|2026-08-04 18:00:00+00',
  'participant edit persists exact factor and half-open attendance boundaries'
);

insert into public.recipes (id, organization_id, name, created_by)
values (
  'a3000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'Testgryta',
  '10000000-0000-0000-0000-000000000001'
);
insert into public.recipe_versions (
  id, organization_id, recipe_id, version_number, status, instructions,
  content_digest, created_by, published_at
) values (
  'a3100000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  1,
  'published',
  'Testversion ett',
  repeat('c', 64),
  '10000000-0000-0000-0000-000000000001',
  now()
);
insert into public.recipe_ingredients (
  id, organization_id, recipe_version_id, name, unit, amount, mode,
  dietary_rule, dietary_tag_label, sort_order
) values
  ('a3200000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a3100000-0000-0000-0000-000000000001', 'Linser', 'kg', 0.125, 'weighted_portion', 'standard', null, 0),
  ('a3200000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a3100000-0000-0000-0000-000000000001', 'Bröd', 'st', 1, 'head', 'exclude', 'Gluten', 1),
  ('a3200000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'a3100000-0000-0000-0000-000000000001', 'Glutenfritt bröd', 'skivor', 2, 'fixed_once_per_camp', 'only', 'Gluten', 2);

select lives_ok(
  $$select public.freeze_recipe_version(
    'a1000000-0000-0000-0000-000000000001',
    'a3100000-0000-0000-0000-000000000001'
  )$$,
  'a planner can freeze a published organization recipe into its camp'
);
select is(
  (select jsonb_array_length(frozen_snapshot -> 'ingredients')
   from public.camp_recipe_copies
   where source_recipe_version_id = 'a3100000-0000-0000-0000-000000000001'),
  3,
  'the frozen copy contains all three explicit ingredient modes and diet variants'
);
select lives_ok(
  $$select public.freeze_recipe_version(
    'a1000000-0000-0000-0000-000000000001',
    'a3100000-0000-0000-0000-000000000001'
  )$$,
  'freezing the same content-addressed version is idempotent'
);
select is(
  (select count(*)::integer from public.camp_recipe_copies
   where source_recipe_version_id = 'a3100000-0000-0000-0000-000000000001'),
  1,
  'idempotent freezing creates only one camp copy'
);

update public.recipe_ingredients
set amount = 9
where id = 'a3200000-0000-0000-0000-000000000001';
select is(
  (select frozen_snapshot #>> '{ingredients,0,amount}'
   from public.camp_recipe_copies
   where source_recipe_version_id = 'a3100000-0000-0000-0000-000000000001'),
  '0.125000',
  'later library edits cannot mutate the frozen camp snapshot'
);
select throws_ok(
  $$update public.camp_recipe_copies
    set name = 'Manipulerad'
    where source_recipe_version_id = 'a3100000-0000-0000-0000-000000000001'$$,
  '42501',
  'permission denied for table camp_recipe_copies',
  'authenticated clients cannot update frozen camp copies directly'
);

insert into public.recipe_versions (
  id, organization_id, recipe_id, version_number, status, instructions,
  content_digest, created_by, published_at
) values (
  'a3100000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  2,
  'published',
  'Testversion två',
  repeat('d', 64),
  '10000000-0000-0000-0000-000000000001',
  now()
);
insert into public.recipe_ingredients (
  id, organization_id, recipe_version_id, name, unit, amount, mode, dietary_rule, sort_order
) values (
  'a3200000-0000-0000-0000-000000000004',
  'a0000000-0000-0000-0000-000000000001',
  'a3100000-0000-0000-0000-000000000002',
  'Linser',
  'kg',
  0.15,
  'weighted_portion',
  'standard',
  0
);
select lives_ok(
  $$select public.freeze_recipe_version(
    'a1000000-0000-0000-0000-000000000001',
    'a3100000-0000-0000-0000-000000000002'
  )$$,
  'a new published library version creates a separate frozen candidate'
);
select is(
  (select count(*)::integer from public.camp_recipe_copies where name = 'Testgryta'),
  2,
  'both immutable recipe versions remain available to the camp'
);

insert into public.meals (
  id, organization_id, camp_id, camp_recipe_copy_id, starts_at, meal_type, title, status
)
select
  'a3300000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  copy.id,
  '2026-08-03T12:00:00Z',
  'lunch',
  'Testgryta',
  'ready'
from public.camp_recipe_copies copy
where copy.source_recipe_version_id = 'a3100000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.switch_meal_recipe_version(
    'a3300000-0000-0000-0000-000000000001',
    'a3100000-0000-0000-0000-000000000002'
  )$$,
  'a meal changes recipe only through an explicit version switch'
);
select is(
  (select copy.source_recipe_version_id
   from public.meals meal
   join public.camp_recipe_copies copy on copy.id = meal.camp_recipe_copy_id
   where meal.id = 'a3300000-0000-0000-0000-000000000001'),
  'a3100000-0000-0000-0000-000000000002'::uuid,
  'the explicit switch points the meal at the requested frozen version'
);

insert into public.recipe_versions (
  id, organization_id, recipe_id, version_number, status, instructions,
  content_digest, created_by, published_at
) values (
  'a3100000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  3,
  'published',
  'Endast fast sojavariant',
  repeat('e', 64),
  '10000000-0000-0000-0000-000000000001',
  now()
);
insert into public.recipe_ingredients (
  id, organization_id, recipe_version_id, name, unit, amount, mode,
  dietary_rule, dietary_tag_label, sort_order
) values (
  'a3200000-0000-0000-0000-000000000005',
  'a0000000-0000-0000-0000-000000000001',
  'a3100000-0000-0000-0000-000000000003',
  'Sojavariant',
  'kg',
  0.4,
  'fixed_once_per_camp',
  'only',
  'Soja',
  0
);

select lives_ok(
  $$select public.save_meal(
    null,
    'a1000000-0000-0000-0000-000000000001',
    '2026-08-04T12:00:00Z',
    'lunch',
    'Beräkning lunch',
    'a3100000-0000-0000-0000-000000000001',
    '[{"dietary_label":"Standardkost","portions":2},{"dietary_label":"Gluten","portions":1}]'::jsonb
  )$$,
  'a planner can schedule a meal with standard and labelled factor-1 reserves'
);
select lives_ok(
  $$select public.save_meal(
    null,
    'a1000000-0000-0000-0000-000000000001',
    '2026-08-04T18:00:00Z',
    'dinner',
    'Beräkning middag',
    'a3100000-0000-0000-0000-000000000001',
    '[]'::jsonb
  )$$,
  'a second occurrence can reuse the immutable camp recipe copy'
);
select lives_ok(
  $$select public.save_meal(
    null,
    'a1000000-0000-0000-0000-000000000001',
    '2026-08-04T19:00:00Z',
    'other',
    'Ingen sojamålgrupp',
    'a3100000-0000-0000-0000-000000000003',
    '[]'::jsonb
  )$$,
  'a meal can use a fixed-only dietary recipe version'
);
select lives_ok(
  $$select public.calculate_camp(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001'
  )$$,
  'a planner can create an exact calculation revision'
);
select is(
  (select count(*)::integer from public.calculation_revisions where status = 'current'),
  1,
  'the first calculation creates one current revision'
);
select is(
  (select line.exact_amount
   from public.calculation_lines line
   join public.meals meal on meal.id = line.meal_id
   where meal.title = 'Beräkning lunch' and line.ingredient_name = 'Linser'),
  0.5625::numeric,
  'weighted portion uses food factors plus factor-1 reserves exactly'
);
select is(
  (select line.exact_amount
   from public.calculation_lines line
   join public.meals meal on meal.id = line.meal_id
   where meal.title = 'Beräkning lunch' and line.ingredient_name = 'Bröd'),
  3::numeric,
  'head mode counts present heads and standard reserves while excluding Gluten'
);
select is(
  (select line.exact_amount
   from public.calculation_lines line
   join public.meals meal on meal.id = line.meal_id
   where meal.title = 'Beräkning lunch' and line.ingredient_name = 'Glutenfritt bröd'),
  2::numeric,
  'a fixed only-Gluten amount is added once when a relevant target group exists'
);
select is(
  (select line.exact_amount
   from public.calculation_lines line
   join public.meals meal on meal.id = line.meal_id
   where meal.title = 'Beräkning middag' and line.ingredient_name = 'Linser'),
  0.0875::numeric,
  'a participant is excluded exactly at the half-open attendance end boundary'
);
select is(
  (select count(*)::integer
   from public.calculation_lines line
   join public.meals meal on meal.id = line.meal_id
   where meal.title = 'Beräkning middag' and line.ingredient_name = 'Glutenfritt bröd'),
  0,
  'fixed once per camp is not repeated on the second recipe occurrence'
);
select is(
  (select count(*)::integer
   from public.calculation_lines line
   join public.meals meal on meal.id = line.meal_id
   where meal.title = 'Ingen sojamålgrupp'),
  0,
  'a fixed only-rule contributes nothing when its target group does not exist'
);
select ok(
  (select jsonb_array_length(line.trace -> 'groups') >= 3
     and line.trace ? 'recipe_version_key'
     and length(line.line_key) > 32
   from public.calculation_lines line
   join public.meals meal on meal.id = line.meal_id
   where meal.title = 'Beräkning lunch' and line.ingredient_name = 'Linser'),
  'each exact amount retains group, attendance-factor, recipe-version and ingredient trace'
);

update public.participants
set food_factor = 0.9
where display_name = 'Ada Uppdaterad';
select lives_ok(
  $$select public.calculate_camp(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001'
  )$$,
  'changed source data creates a new calculation revision'
);
select is(
  (select string_agg(revision.revision_number || ':' || revision.status::text, ',' order by revision.revision_number)
   from public.calculation_revisions revision),
  '1:superseded,2:current',
  'the new revision supersedes but preserves the prior calculation'
);
select ok(
  (select array_agg(line.exact_amount order by revision.revision_number) = array[0.5625::numeric, 0.575::numeric]
   from public.calculation_lines line
   join public.calculation_revisions revision on revision.id = line.calculation_revision_id
   join public.meals meal on meal.id = line.meal_id
   where meal.title = 'Beräkning lunch' and line.ingredient_name = 'Linser'),
  'old and new exact amounts remain separately inspectable'
);
select is(
  (select count(distinct line.line_key)::integer
   from public.calculation_lines line
   join public.meals meal on meal.id = line.meal_id
   where meal.title = 'Beräkning lunch' and line.ingredient_name = 'Linser'),
  1,
  'the same semantic calculation row keeps a stable key across revisions'
);
select is(
  (select count(distinct revision.input_digest)::integer from public.calculation_revisions revision),
  2,
  'each revision stores a content digest of its exact source inputs'
);

select lives_ok(
  $$select public.generate_supply_lists(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001'
  )$$,
  'the current calculation generates operational supply lists'
);
select is(
  (select count(distinct list.kind)::integer
   from public.supply_lists list
   where list.camp_id = 'a1000000-0000-0000-0000-000000000001'
     and list.source_present),
  3,
  'generation creates purchase, distribution and delivery perspectives'
);
select is(
  (select count(*)::integer
   from public.supply_lists list
   where list.camp_id = 'a1000000-0000-0000-0000-000000000001'
     and list.kind = 'delivery'
     and list.source_present),
  2,
  'meal dates create two automatic delivery intervals'
);
select ok(
  (select bool_and(previous.range_end = current.range_start)
   from (
     select list.range_start, list.range_end,
       lag(list.range_end) over (order by list.range_start) as previous_end
     from public.supply_lists list
     where list.camp_id = 'a1000000-0000-0000-0000-000000000001'
       and list.kind = 'delivery'
       and list.source_present
   ) current
   join lateral (select current.previous_end as range_end) previous on current.previous_end is not null),
  'automatic delivery intervals are contiguous and half-open'
);
select ok(
  (select count(*) > 2
   from public.supply_lists list
   where list.camp_id = 'a1000000-0000-0000-0000-000000000001'
     and list.kind = 'distribution'
     and list.source_present
     and list.title like '% · %'),
  'distribution lists are split by meal and meal group or shared goods'
);
select is(
  (select item.required_amount
   from public.supply_list_items item
   join public.supply_lists list on list.id = item.supply_list_id
   where list.list_key = 'purchase:all'
     and item.item_name = 'Linser'
     and item.source_present),
  0.9025::numeric,
  'whole-camp purchase need is the unrounded sum of exact calculation lines'
);
select ok(
  (select jsonb_array_length(item.source_line_keys) = 3
   from public.supply_list_items item
   join public.supply_lists list on list.id = item.supply_list_id
   where list.list_key = 'purchase:all'
     and item.item_name = 'Linser'
     and item.source_present),
  'purchase rows retain every source calculation line key'
);
select lives_ok(
  $$select public.update_supply_item(
    (select item.id
     from public.supply_list_items item
     join public.supply_lists list on list.id = item.supply_list_id
     where list.list_key = 'purchase:all' and item.item_name = 'Linser'),
    (select item.row_version
     from public.supply_list_items item
     join public.supply_lists list on list.id = item.supply_list_id
     where list.list_key = 'purchase:all' and item.item_name = 'Linser'),
    1,
    'paket',
    '2 förpackningar',
    'Beställ lokalt',
    false
  )$$,
  'manual order fields can be edited through an optimistic local RPC'
);
select ok(
  (select item.required_unit = 'kg'
      and item.required_amount = 0.9025::numeric
      and item.ordered_unit = 'paket'
      and item.ordered_amount = 1::numeric
   from public.supply_list_items item
   join public.supply_lists list on list.id = item.supply_list_id
   where list.list_key = 'purchase:all' and item.item_name = 'Linser'),
  'exact need and differently-unitised order values remain separate without conversion'
);

create temporary table atomic_delivery_move_state on commit drop as
select
  item.id as item_id,
  item.supply_list_id as original_list_id,
  target.id as target_list_id,
  item.row_version as original_row_version,
  item.ordered_amount as original_ordered_amount,
  item.ordered_unit as original_ordered_unit,
  item.package_note as original_package_note,
  item.comment as original_comment,
  item.completed as original_completed
from public.supply_list_items item
join public.supply_lists source on source.id = item.supply_list_id
cross join lateral (
  select list.id
  from public.supply_lists list
  where list.list_key = 'delivery:auto:2026-08-04'
) target
where source.list_key = 'delivery:auto:2026-08-03'
  and item.item_name = 'Linser';

select throws_ok(
  $$select public.move_delivery_item(
    state.item_id,
    state.target_list_id,
    state.original_row_version + 1,
    0.7,
    'kg',
    'Ska inte sparas',
    'Ska inte flyttas',
    true
  )
  from atomic_delivery_move_state state$$,
  '40001',
  'Supply item has changed',
  'an atomic move rejects a stale expected row version'
);
select ok(
  (select row(
      item.supply_list_id,
      item.row_version,
      item.ordered_amount,
      item.ordered_unit,
      item.package_note,
      item.comment,
      item.completed
    ) is not distinct from row(
      state.original_list_id,
      state.original_row_version,
      state.original_ordered_amount,
      state.original_ordered_unit,
      state.original_package_note,
      state.original_comment,
      state.original_completed
    )
   from atomic_delivery_move_state state
   join public.supply_list_items item on item.id = state.item_id),
  'a rejected stale move changes neither assignment nor edited fields'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.move_delivery_item(
    state.item_id,
    state.target_list_id,
    state.original_row_version,
    0.7,
    'kg',
    'Ska inte sparas',
    'Ska inte flyttas',
    true
  )
  from atomic_delivery_move_state state$$,
  '42501',
  'Supply item not found',
  'a member of another organization cannot move a delivery item'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

reset role;
update public.supply_lists
set status = 'complete'
where id = (select target_list_id from atomic_delivery_move_state);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.aal', 'aal2', true);
select throws_ok(
  $$select public.move_delivery_item(
    state.item_id,
    state.target_list_id,
    state.original_row_version,
    0.7,
    'kg',
    'Ska inte sparas',
    'Ska inte flyttas',
    true
  )
  from atomic_delivery_move_state state$$,
  '22023',
  'Completed target delivery cannot receive items',
  'a completed delivery cannot silently receive another item'
);
reset role;
update public.supply_lists
set status = 'draft'
where id = (select target_list_id from atomic_delivery_move_state);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.aal', 'aal2', true);

select lives_ok(
  $$select public.move_delivery_item(
    (select item.id
     from public.supply_list_items item
     join public.supply_lists list on list.id = item.supply_list_id
     where list.list_key = 'delivery:auto:2026-08-03' and item.item_name = 'Linser'),
    (select id from public.supply_lists where list_key = 'delivery:auto:2026-08-04'),
    (select item.row_version
     from public.supply_list_items item
     join public.supply_lists list on list.id = item.supply_list_id
     where list.list_key = 'delivery:auto:2026-08-03' and item.item_name = 'Linser'),
    0.7,
    'kg',
    'Flyttad beställning',
    'Till kökstältet',
    true
  )$$,
  'a delivery item and its edited fields move atomically to another current interval'
);
select ok(
  (select list.list_key = 'delivery:auto:2026-08-04'
      and item.item_key like 'delivery:2026-08-03:%'
      and item.ordered_amount = 0.7::numeric
      and item.ordered_unit = 'kg'
      and item.package_note = 'Flyttad beställning'
      and item.comment = 'Till kökstältet'
      and item.completed
      and item.manually_moved
   from public.supply_list_items item
   join public.supply_lists list on list.id = item.supply_list_id
   where item.item_key like 'delivery:2026-08-03:%' and item.item_name = 'Linser'),
  'manual movement preserves source identity while saving the open form'
);
select is(
  (select count(*)::integer
   from public.supply_list_items item
   join public.supply_lists list on list.id = item.supply_list_id
   where list.list_key = 'delivery:auto:2026-08-04'
     and item.item_name = 'Linser'
     and item.source_present),
  2,
  'same-ingredient source rows remain distinct in the target delivery'
);
select ok(
  (select event.payload ->> 'item_key' like 'delivery:2026-08-03:%'
      and event.payload ->> 'from_list_key' = 'delivery:auto:2026-08-03'
      and event.payload ->> 'to_list_key' = 'delivery:auto:2026-08-04'
      and (event.payload ->> 'target_had_same_canonical')::boolean
      and (event.payload ->> 'order_fields_changed')::boolean
   from public.audit_events event
   where event.event_type = 'delivery_item_moved'
   order by event.id desc
   limit 1),
  'delivery movement audit retains source, target and duplicate-source context'
);

update public.participants
set food_factor = 0.95
where display_name = 'Ada Uppdaterad';
select lives_ok(
  $$select public.calculate_camp(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001'
  )$$,
  'another source change creates a calculation revision for list carry-forward'
);
select lives_ok(
  $$select public.generate_supply_lists(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001'
  )$$,
  'supply lists regenerate from the new calculation revision'
);
select ok(
  (select item.ordered_amount = 1::numeric
      and item.ordered_unit = 'paket'
      and item.package_note = '2 förpackningar'
      and item.comment = 'Beställ lokalt'
   from public.supply_list_items item
   where item.item_key = 'purchase:' || md5('linser' || chr(31) || 'kg'))
  and
  (select list.list_key = 'delivery:auto:2026-08-04' and item.manually_moved
      and item.ordered_amount = 0.7::numeric
      and item.ordered_unit = 'kg'
      and item.package_note = 'Flyttad beställning'
      and item.comment = 'Till kökstältet'
      and item.completed
   from public.supply_list_items item
   join public.supply_lists list on list.id = item.supply_list_id
   where item.item_key like 'delivery:2026-08-03:%' and item.item_name = 'Linser'),
  'stable item keys carry manual order fields and delivery assignments across revisions'
);

update public.meals meal
set camp_recipe_copy_id = copy.id
from public.camp_recipe_copies copy
where meal.organization_id = 'a0000000-0000-0000-0000-000000000001'
  and meal.camp_id = 'a1000000-0000-0000-0000-000000000001'
  and copy.source_recipe_version_id = 'a3100000-0000-0000-0000-000000000002'
  and meal.camp_recipe_copy_id in (
    select old_copy.id
    from public.camp_recipe_copies old_copy
    where old_copy.source_recipe_version_id = 'a3100000-0000-0000-0000-000000000001'
  );
select lives_ok(
  $$select public.calculate_camp(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001'
  )$$,
  'removing recipe ingredients creates another preserved calculation revision'
);
select lives_ok(
  $$select public.generate_supply_lists(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001'
  )$$,
  'regeneration retains but flags list rows whose source disappeared'
);
select ok(
  (select not item.source_present
   from public.supply_list_items item
   where item.item_key = 'purchase:' || md5('bröd' || chr(31) || 'st')),
  'a disappeared calculated row is retained and explicitly flagged'
);

select is(
  (select public.apply_supply_item_mutation(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    item.id,
    'a9000000-0000-0000-0000-000000000001',
    item.row_version,
    jsonb_build_object(
      'ordered_amount', item.ordered_amount,
      'ordered_unit', item.ordered_unit,
      'package_note', item.package_note,
      'comment', item.comment,
      'completed', item.completed
    ),
    '{"completed":true}'::jsonb
  ) ->> 'status'
  from public.supply_list_items item
  where item.item_key = 'purchase:' || md5('linser' || chr(31) || 'kg')),
  'applied',
  'an offline mutation applies from explicit base values'
);
select is(
  (select count(*)::integer from public.supply_item_mutations
   where client_mutation_id = 'a9000000-0000-0000-0000-000000000001'),
  1,
  'an applied mutation records one durable idempotency receipt'
);
select ok(
  (select (public.apply_supply_item_mutation(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    item.id,
    'a9000000-0000-0000-0000-000000000001',
    item.row_version - 1,
    jsonb_build_object(
      'ordered_amount', item.ordered_amount,
      'ordered_unit', item.ordered_unit,
      'package_note', item.package_note,
      'comment', item.comment,
      'completed', false
    ),
    '{"completed":true}'::jsonb
  ) ->> 'replayed')::boolean
  from public.supply_list_items item
  where item.item_key = 'purchase:' || md5('linser' || chr(31) || 'kg')),
  'replaying the same client mutation returns its receipt'
);
select is(
  (select count(*)::integer from public.supply_item_mutations
   where client_mutation_id = 'a9000000-0000-0000-0000-000000000001'),
  1,
  'idempotent replay creates neither a duplicate receipt nor a second write'
);

select lives_ok(
  $$select public.update_supply_item(
    item.id,
    item.row_version,
    item.ordered_amount,
    item.ordered_unit,
    item.package_note,
    'Serverkommentar',
    item.completed
  )
  from public.supply_list_items item
  where item.item_key = 'purchase:' || md5('linser' || chr(31) || 'kg')$$,
  'a concurrent server edit can change a field outside the offline mutation'
);
select is(
  (select public.apply_supply_item_mutation(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    item.id,
    'a9000000-0000-0000-0000-000000000002',
    item.row_version - 1,
    jsonb_build_object(
      'ordered_amount', item.ordered_amount,
      'ordered_unit', item.ordered_unit,
      'package_note', item.package_note,
      'comment', 'Beställ lokalt',
      'completed', true
    ),
    '{"completed":false}'::jsonb
  ) ->> 'status'
  from public.supply_list_items item
  where item.item_key = 'purchase:' || md5('linser' || chr(31) || 'kg')),
  'applied',
  'a non-overlapping offline field merges with the concurrent server field'
);
select ok(
  (select item.comment = 'Serverkommentar' and not item.completed
   from public.supply_list_items item
   where item.item_key = 'purchase:' || md5('linser' || chr(31) || 'kg')),
  'the merge preserves both the server comment and the offline checklist change'
);

select lives_ok(
  $$select public.update_supply_item(
    item.id,
    item.row_version,
    item.ordered_amount,
    item.ordered_unit,
    item.package_note,
    'Ny serverkommentar',
    item.completed
  )
  from public.supply_list_items item
  where item.item_key = 'purchase:' || md5('linser' || chr(31) || 'kg')$$,
  'a second concurrent edit prepares a same-field conflict'
);
select is(
  (select public.apply_supply_item_mutation(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    item.id,
    'a9000000-0000-0000-0000-000000000003',
    item.row_version - 1,
    jsonb_build_object(
      'ordered_amount', item.ordered_amount,
      'ordered_unit', item.ordered_unit,
      'package_note', item.package_note,
      'comment', 'Serverkommentar',
      'completed', item.completed
    ),
    '{"comment":"Min offlinekommentar"}'::jsonb
  ) ->> 'status'
  from public.supply_list_items item
  where item.item_key = 'purchase:' || md5('linser' || chr(31) || 'kg')),
  'conflict',
  'a same-field concurrent edit returns a conflict instead of overwriting'
);
select is(
  (select item.comment
   from public.supply_list_items item
   where item.item_key = 'purchase:' || md5('linser' || chr(31) || 'kg')),
  'Ny serverkommentar',
  'a conflicted offline value never overwrites the server value silently'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.freeze_recipe_version(
    'a1000000-0000-0000-0000-000000000001',
    'a3100000-0000-0000-0000-000000000002'
  )$$,
  '42501',
  'Camp not found',
  'another tenant cannot freeze an organization recipe into camp A'
);
select throws_ok(
  $$select public.calculate_camp(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001'
  )$$,
  '42501',
  'Camp not found',
  'another tenant cannot calculate camp A'
);
select throws_ok(
  $$select public.generate_supply_lists(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001'
  )$$,
  '42501',
  'Camp not found',
  'another tenant cannot generate supply lists for camp A'
);
select throws_ok(
  $$select public.apply_supply_item_mutation(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    (select id from public.supply_list_items where item_key = 'purchase:' || md5('linser' || chr(31) || 'kg')),
    'b9000000-0000-0000-0000-000000000001',
    1,
    '{"ordered_amount":null,"ordered_unit":null,"package_note":null,"comment":null,"completed":false}'::jsonb,
    '{"completed":true}'::jsonb
  )$$,
  '42501',
  'Supply item not found',
  'another tenant cannot apply an offline supply mutation'
);

select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000004', true);
select is((select count(*)::integer from public.organizations), 0, 'invited user sees no organization before acceptance');
select is(
  (select organization_id from public.accept_organization_invitation('a9000000-0000-0000-0000-000000000001')),
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'matching signed-in email accepts its one-time invitation'
);
select is(
  (select role::text from public.organization_memberships
    where organization_id = 'a0000000-0000-0000-0000-000000000001'
      and user_id = '40000000-0000-0000-0000-000000000004'),
  'planner',
  'accepted invitation creates the requested membership role'
);
select throws_ok(
  $$select * from public.accept_organization_invitation('a9000000-0000-0000-0000-000000000001')$$,
  '22023',
  'Invitation is invalid or expired',
  'accepted invitation cannot be replayed'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select count(*) from public.organizations$$,
  '42501',
  'permission denied for table organizations',
  'anonymous role has no organization table privileges'
);

select * from finish();
rollback;
