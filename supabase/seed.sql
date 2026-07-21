-- Local-only deterministic demo data. Addresses use the reserved .test TLD.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated',
    'authenticated',
    'oskar@bjorkstad.test',
    '',
    now(),
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Oskar Svensson"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-2222-2222-222222222222',
    'authenticated',
    'authenticated',
    'sara@sjovik.test',
    '',
    now(),
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Sara Nilsson"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '33333333-3333-3333-3333-333333333333',
    'authenticated',
    'authenticated',
    'befintlig@lokal.test',
    '',
    now(),
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Karin Berg"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '44444444-4444-4444-4444-444444444444',
    'authenticated',
    'authenticated',
    'mobil@bjorkstad.test',
    '',
    now(),
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Mats Lindholm"}',
    now(),
    now()
  )
on conflict (id) do nothing;

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values
  (
    '91111111-1111-1111-1111-111111111111',
    'oskar@bjorkstad.test',
    '11111111-1111-1111-1111-111111111111',
    '{"sub":"11111111-1111-1111-1111-111111111111","email":"oskar@bjorkstad.test","email_verified":true}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    '92222222-2222-2222-2222-222222222222',
    'sara@sjovik.test',
    '22222222-2222-2222-2222-222222222222',
    '{"sub":"22222222-2222-2222-2222-222222222222","email":"sara@sjovik.test","email_verified":true}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    '93333333-3333-3333-3333-333333333333',
    'befintlig@lokal.test',
    '33333333-3333-3333-3333-333333333333',
    '{"sub":"33333333-3333-3333-3333-333333333333","email":"befintlig@lokal.test","email_verified":true}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    '94444444-4444-4444-4444-444444444444',
    'mobil@bjorkstad.test',
    '44444444-4444-4444-4444-444444444444',
    '{"sub":"44444444-4444-4444-4444-444444444444","email":"mobil@bjorkstad.test","email_verified":true}',
    'email',
    now(),
    now(),
    now()
  )
on conflict (provider_id, provider) do nothing;

insert into public.organizations (id, name, slug, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Björkstad scoutkår', 'bjorkstad-scoutkar', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'Sjövik scoutkår', 'sjovik-scoutkar', '22222222-2222-2222-2222-222222222222');

insert into public.organization_memberships (organization_id, user_id, role, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '44444444-4444-4444-4444-444444444444', 'planner', 'active');

insert into public.camps (id, organization_id, name, starts_on, ends_on, timezone, status, created_by) values
  ('caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Sommarläger 2026', '2026-08-02', '2026-08-11', 'Europe/Stockholm', 'active', '11111111-1111-1111-1111-111111111111'),
  ('cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'Hösthajk 2026', '2026-09-18', '2026-09-20', 'Europe/Stockholm', 'draft', '22222222-2222-2222-2222-222222222222');

insert into public.camp_groups (id, organization_id, camp_id, parent_group_id, kind, name, sort_order) values
  ('d1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', null, 'division', 'Spårarna', 1),
  ('d1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', null, 'division', 'Upptäckarna', 2),
  ('d1000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', null, 'division', 'Äventyrarna', 3),
  ('d1000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', null, 'division', 'Utmanarna', 4),
  ('d2000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'd1000000-0000-0000-0000-000000000001', 'patrol', 'Igelkotten', 1),
  ('d2000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'd1000000-0000-0000-0000-000000000001', 'patrol', 'Ekorren', 2),
  ('d2000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'd1000000-0000-0000-0000-000000000002', 'patrol', 'Räven', 1),
  ('d2000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'd1000000-0000-0000-0000-000000000002', 'patrol', 'Ugglan', 2),
  ('d2000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'd1000000-0000-0000-0000-000000000003', 'patrol', 'Falken', 1),
  ('d2000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'd1000000-0000-0000-0000-000000000003', 'patrol', 'Lodjuret', 2),
  ('d2000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'd1000000-0000-0000-0000-000000000004', 'patrol', 'Korpen', 1),
  ('d2000000-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'd1000000-0000-0000-0000-000000000004', 'patrol', 'Bävern', 2),
  ('d3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', null, 'meal_group', 'Matlag Granen', 1),
  ('d3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', null, 'meal_group', 'Matlag Sjön', 2),
  ('d3000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', null, 'meal_group', 'Matlag Berget', 3),
  ('d3000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', null, 'meal_group', 'Matlag Gläntan', 4),
  ('d3000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', null, 'meal_group', 'Matlag Elden', 5);

insert into public.import_batches (
  id,
  organization_id,
  camp_id,
  source_filename,
  source_kind,
  column_mapping,
  validation_summary,
  status,
  imported_by,
  completed_at
) values (
  'a1000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'scoutnet-sommarlager-2026.xlsx',
  'xlsx',
  '[{"index":0,"source":"Namn","target":"display_name"},{"index":1,"source":"Avdelning","target":"division"},{"index":2,"source":"Patrull","target":"patrol"},{"index":3,"source":"Matlag","target":"meal_group"},{"index":4,"source":"Portionsstorlek","target":"food_factor"},{"index":5,"source":"Specialkost","target":"diet_note"}]',
  '{"accepted":50,"rejected":0,"excluded":0,"discarded_columns":["Personnummer","E-post","Telefon"]}',
  'imported',
  '11111111-1111-1111-1111-111111111111',
  '2026-07-15 19:30:00+02'
);

insert into public.participants (
  id,
  organization_id,
  camp_id,
  display_name,
  division_id,
  patrol_id,
  meal_group_id,
  food_factor,
  source_reference,
  import_batch_id
)
select
  ('e1000000-0000-0000-0000-' || lpad(person.ordinal::text, 12, '0'))::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
  person.display_name,
  case
    when person.ordinal <= 10 then 'd1000000-0000-0000-0000-000000000001'
    when person.ordinal <= 26 then 'd1000000-0000-0000-0000-000000000002'
    when person.ordinal <= 40 then 'd1000000-0000-0000-0000-000000000003'
    else 'd1000000-0000-0000-0000-000000000004'
  end::uuid,
  case
    when person.ordinal <= 5 then 'd2000000-0000-0000-0000-000000000001'
    when person.ordinal <= 10 then 'd2000000-0000-0000-0000-000000000002'
    when person.ordinal <= 18 then 'd2000000-0000-0000-0000-000000000003'
    when person.ordinal <= 26 then 'd2000000-0000-0000-0000-000000000004'
    when person.ordinal <= 33 then 'd2000000-0000-0000-0000-000000000005'
    when person.ordinal <= 40 then 'd2000000-0000-0000-0000-000000000006'
    when person.ordinal <= 45 then 'd2000000-0000-0000-0000-000000000007'
    else 'd2000000-0000-0000-0000-000000000008'
  end::uuid,
  ('d3000000-0000-0000-0000-' || lpad((((person.ordinal - 1) % 5) + 1)::text, 12, '0'))::uuid,
  case
    when person.ordinal <= 10 then 0.75
    when person.ordinal <= 26 then 0.90
    when person.ordinal <= 40 then 1.00
    else 1.10
  end,
  'scoutnet-2026-' || lpad(person.ordinal::text, 3, '0'),
  'a1000000-0000-0000-0000-000000000001'::uuid
from (values
  (1, 'Alva Andersson'), (2, 'Ahmed Ali'), (3, 'Ebba Berg'), (4, 'Leo Dahl'), (5, 'Maja Ek'),
  (6, 'Elias Falk'), (7, 'Selma Gran'), (8, 'Hugo Holm'), (9, 'Nora Isaksson'), (10, 'Adam Jansson'),
  (11, 'Alice Karlsson'), (12, 'William Larsson'), (13, 'Ellen Lind'), (14, 'Noah Lund'), (15, 'Astrid Magnusson'),
  (16, 'Samir Mohamed'), (17, 'Signe Nilsson'), (18, 'Ludvig Norberg'), (19, 'Freja Olsson'), (20, 'Liam Persson'),
  (21, 'Wilma Pettersson'), (22, 'Nils Rahimi'), (23, 'Saga Sandberg'), (24, 'Axel Sjöberg'), (25, 'Elsa Ström'),
  (26, 'Isak Svensson'), (27, 'Meja Söder'), (28, 'Omar Tahir'), (29, 'Vera Viklund'), (30, 'Arvid Åkesson'),
  (31, 'Rut Öberg'), (32, 'Melvin Östlund'), (33, 'Tove Hall'), (34, 'Amir Hassan'), (35, 'Juni Engström'),
  (36, 'Benjamin Bergman'), (37, 'Liv Nyström'), (38, 'Tage Wallin'), (39, 'Hedda Lindqvist'), (40, 'Theo Jonsson'),
  (41, 'Inez Blom'), (42, 'Vincent Eriksson'), (43, 'Lo Kroon'), (44, 'Karim Saleh'), (45, 'Tyra Månsson'),
  (46, 'Mille Nord'), (47, 'Olivia Hedlund'), (48, 'Sixten Fors'), (49, 'Nellie Roos'), (50, 'Joel Wester')
) as person(ordinal, display_name);

insert into public.participant_attendance (
  id,
  organization_id,
  camp_id,
  participant_id,
  starts_at,
  ends_at
) select
  ('e2000000-0000-0000-0000-' || lpad(person.ordinal::text, 12, '0'))::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
  ('e1000000-0000-0000-0000-' || lpad(person.ordinal::text, 12, '0'))::uuid,
  case
    when person.ordinal in (7, 14, 21, 28, 35) then '2026-08-03 15:00:00+02'::timestamptz
    when person.ordinal in (25, 47) then '2026-08-05 09:00:00+02'::timestamptz
    else '2026-08-02 12:00:00+02'::timestamptz
  end,
  case
    when person.ordinal in (9, 18, 30, 42, 46, 25, 47) then '2026-08-09 18:00:00+02'::timestamptz
    else '2026-08-11 10:00:00+02'::timestamptz
  end
from generate_series(1, 50) as person(ordinal);

insert into public.dietary_tags (id, organization_id, camp_id, label, description) values
  ('f1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Gluten', 'Glutenfri kost.'),
  ('f1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Vegetarian', 'Vegetarisk kost.'),
  ('f1000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Mjölkprotein', 'Mjölkproteinfri kost.');

insert into public.participant_dietary_needs (
  id,
  organization_id,
  camp_id,
  participant_id,
  raw_food_note,
  review_status,
  reviewed_by,
  reviewed_at
)
select
  ('f2000000-0000-0000-0000-' || lpad(need.need_number::text, 12, '0'))::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
  ('e1000000-0000-0000-0000-' || lpad(need.participant_ordinal::text, 12, '0'))::uuid,
  need.raw_food_note,
  need.review_status::public.dietary_review_status,
  case when need.review_status = 'resolved' then '11111111-1111-1111-1111-111111111111'::uuid else null end,
  case when need.review_status = 'resolved' then '2026-07-16 20:15:00+02'::timestamptz else null end
from (values
  (1, 3, 'Celiaki – strikt glutenfri kost.', 'resolved'),
  (2, 12, 'Vegetarisk kost.', 'resolved'),
  (3, 15, 'Allergi mot mjölkprotein.', 'resolved'),
  (4, 21, 'Celiaki – behöver glutenfri kost.', 'unreviewed'),
  (5, 24, 'Vegetarisk kost.', 'resolved'),
  (6, 28, 'Celiaki – strikt glutenfri kost.', 'resolved'),
  (7, 31, 'Allergi mot mjölkprotein.', 'resolved'),
  (8, 36, 'Vegetarisk och glutenfri kost.', 'resolved'),
  (9, 39, 'Glutenfri och mjölkproteinfri kost.', 'resolved'),
  (10, 43, 'Vegetarisk kost.', 'resolved')
) as need(need_number, participant_ordinal, raw_food_note, review_status);

insert into public.dietary_need_tags (
  organization_id,
  camp_id,
  dietary_need_id,
  dietary_tag_id
)
select
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
  ('f2000000-0000-0000-0000-' || lpad(link.need_number::text, 12, '0'))::uuid,
  ('f1000000-0000-0000-0000-' || lpad(link.tag_number::text, 12, '0'))::uuid
from (values
  (1, 1), (2, 2), (3, 3), (4, 1), (5, 2), (6, 1), (7, 3),
  (8, 2), (8, 1), (9, 1), (9, 3), (10, 2)
) as link(need_number, tag_number);

-- Local demo organizations receive the same reviewed catalogue as hosted
-- bootstrap. The workbook-derived development export is deliberately ignored
-- and is not needed for a clean database reset.
insert into public.recipes (id, organization_id, name, created_by)
select
  template.id,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
  template.name,
  '11111111-1111-1111-1111-111111111111'::uuid
from app_private.recipe_templates as template;

insert into public.recipe_versions (
  id,
  organization_id,
  recipe_id,
  version_number,
  status,
  instructions,
  portion_size,
  content_digest,
  created_by,
  published_at
)
select
  template.id,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
  template.id,
  1,
  'published',
  template.instructions,
  template.portion_size,
  template.content_digest,
  '11111111-1111-1111-1111-111111111111'::uuid,
  now()
from app_private.recipe_templates as template;

insert into public.recipe_ingredients (
  id,
  organization_id,
  recipe_version_id,
  name,
  unit,
  amount,
  mode,
  dietary_rule,
  dietary_tag_label,
  comment,
  source_row,
  sort_order
)
select
  ingredient.id,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
  ingredient.recipe_template_id,
  ingredient.name,
  ingredient.unit,
  ingredient.amount,
  ingredient.mode,
  ingredient.dietary_rule,
  ingredient.dietary_tag_label,
  ingredient.comment,
  null,
  ingredient.sort_order
from app_private.recipe_ingredient_templates as ingredient;

insert into public.recipes (id, organization_id, name, created_by) values (
  'a2000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Chili sin carne',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.recipe_versions (
  id,
  organization_id,
  recipe_id,
  version_number,
  status,
  instructions,
  portion_size,
  content_digest,
  created_by,
  published_at
) values (
  'a2000000-0000-0000-0000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'a2000000-0000-0000-0000-000000000001',
  1,
  'published',
  'Kokas.',
  0.4,
  repeat('a', 64),
  '11111111-1111-1111-1111-111111111111',
  now()
);

insert into public.recipe_ingredients (
  organization_id,
  recipe_version_id,
  name,
  unit,
  amount,
  mode
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'a2000000-0000-0000-0000-000000000002',
  'Krossade tomater',
  'kg',
  0.15,
  'weighted_portion'
);

insert into public.camp_recipe_copies (
  id,
  organization_id,
  camp_id,
  source_recipe_version_id,
  name,
  version_key,
  frozen_snapshot,
  copied_by
) values (
  'a2000000-0000-0000-0000-000000000003',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'a2000000-0000-0000-0000-000000000002',
  'Chili sin carne',
  'a2000000-0000-0000-0000-000000000002@aaaaaaaaaaaaaaaa',
  '{"name":"Chili sin carne","version":1,"version_key":"a2000000-0000-0000-0000-000000000002@aaaaaaaaaaaaaaaa","content_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","instructions":"Kokas.","portion_size":"0.4","ingredients":[{"name":"Krossade tomater","unit":"kg","amount":"0.15","mode":"weighted_portion","dietary_rule":"standard","dietary_tag_label":null,"comment":null,"source_row":null,"sort_order":0}]}',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.meals (
  id,
  organization_id,
  camp_id,
  camp_recipe_copy_id,
  starts_at,
  meal_type,
  title,
  status
) values (
  'a2000000-0000-0000-0000-000000000004',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'a2000000-0000-0000-0000-000000000003',
  '2026-08-03 12:00:00+02',
  'lunch',
  'Chili sin carne',
  'blocked'
);

insert into public.calculation_revisions (
  id,
  organization_id,
  camp_id,
  revision_number,
  status,
  input_digest,
  problem_summary,
  calculated_by
) values (
  'a2000000-0000-0000-0000-000000000005',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  1,
  'stale',
  repeat('b', 64),
  '{"unreviewed_dietary_needs":1}',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.supply_lists (
  id,
  organization_id,
  camp_id,
  calculation_revision_id,
  kind,
  status,
  title,
  list_key,
  source_present
) values (
  'a2000000-0000-0000-0000-000000000006',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'a2000000-0000-0000-0000-000000000005',
  'delivery',
  'active',
  'Leverans 1',
  'legacy:delivery-1',
  true
);

insert into public.supply_list_items (
  organization_id,
  camp_id,
  supply_list_id,
  category,
  item_name,
  required_amount,
  required_unit,
  ordered_amount,
  ordered_unit,
  package_note,
  comment,
  completed,
  updated_by,
  item_key,
  source_line_keys,
  source_present,
  manually_moved
) values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'a2000000-0000-0000-0000-000000000006',
    'Grönt',
    'Gul lök',
    5.5,
    'kg',
    6,
    'kg',
    '1 säck',
    'Kontrollerad vid leverans',
    true,
    '11111111-1111-1111-1111-111111111111',
    'legacy:delivery-1:onion',
    '[]'::jsonb,
    true,
    false
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'a2000000-0000-0000-0000-000000000006',
    'Grönt',
    'Aubergine',
    5.7,
    'st',
    3,
    'kg',
    null,
    'Olika enheter: jämför inte automatiskt.',
    false,
    '11111111-1111-1111-1111-111111111111',
    'legacy:delivery-1:aubergine',
    '[]'::jsonb,
    true,
    false
  );
