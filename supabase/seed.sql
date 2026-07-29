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
    extensions.crypt('lagermat-local-development-only', extensions.gen_salt('bf')),
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

insert into public.camps (
  id,
  organization_id,
  name,
  starts_on,
  ends_on,
  timezone,
  status,
  created_by,
  meal_plan_confirmed_at,
  meal_plan_confirmed_by
) values
  ('caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Sommarläger 2026', '2026-08-02', '2026-08-05', 'Europe/Stockholm', 'active', '11111111-1111-1111-1111-111111111111', '2026-07-20 18:00:00+02', '11111111-1111-1111-1111-111111111111'),
  ('cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'Hösthajk 2026', '2026-09-18', '2026-09-20', 'Europe/Stockholm', 'draft', '22222222-2222-2222-2222-222222222222', null, null);

insert into public.camp_groups (id, organization_id, camp_id, parent_group_id, kind, name, sort_order) values
  ('d1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', null, 'division', 'Spårarna', 1),
  ('d1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', null, 'division', 'Upptäckarna', 2),
  ('d1000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', null, 'division', 'Äventyrarna', 3),
  ('d1000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', null, 'division', 'Utmanarna', 4),
  ('d1000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', null, 'division', 'Ledare', 5),
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
  '{"accepted":55,"rejected":0,"excluded":0,"discarded_columns":["Personnummer","E-post","Telefon"]}',
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
    when person.ordinal <= 50 then 'd1000000-0000-0000-0000-000000000004'
    else 'd1000000-0000-0000-0000-000000000005'
  end::uuid,
  case
    when person.ordinal <= 5 then 'd2000000-0000-0000-0000-000000000001'
    when person.ordinal <= 10 then 'd2000000-0000-0000-0000-000000000002'
    when person.ordinal <= 18 then 'd2000000-0000-0000-0000-000000000003'
    when person.ordinal <= 26 then 'd2000000-0000-0000-0000-000000000004'
    when person.ordinal <= 33 then 'd2000000-0000-0000-0000-000000000005'
    when person.ordinal <= 40 then 'd2000000-0000-0000-0000-000000000006'
    when person.ordinal <= 45 then 'd2000000-0000-0000-0000-000000000007'
    when person.ordinal <= 50 then 'd2000000-0000-0000-0000-000000000008'
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
  (46, 'Mille Nord'), (47, 'Olivia Hedlund'), (48, 'Sixten Fors'), (49, 'Nellie Roos'), (50, 'Joel Wester'),
  (51, 'Elin Åberg'), (52, 'Johan Lindqvist'), (53, 'Sara Wik'), (54, 'Mikael Berg'), (55, 'Hanna Ekström')
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
    when person.ordinal in (25, 47) then '2026-08-03 09:00:00+02'::timestamptz
    else '2026-08-02 08:00:00+02'::timestamptz
  end,
  case
    when person.ordinal in (9, 18, 30, 42, 46, 25, 47) then '2026-08-04 18:00:00+02'::timestamptz
    else '2026-08-05 20:00:00+02'::timestamptz
  end
from generate_series(1, 55) as person(ordinal);

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

-- Local-only recipes broaden the demo library without changing the reviewed
-- catalogue used when a hosted organization is bootstrapped.
insert into public.recipes (id, organization_id, name, created_by) values
  ('b2000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Havregrynsgröt med äppelmos', '11111111-1111-1111-1111-111111111111'),
  ('b2000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Pannkakor med sylt', '11111111-1111-1111-1111-111111111111'),
  ('b2000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Tomatsoppa med ostsmörgås', '11111111-1111-1111-1111-111111111111'),
  ('b2000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Potatis- och purjolökssoppa', '11111111-1111-1111-1111-111111111111'),
  ('b2000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Krämig linsgryta med ris', '11111111-1111-1111-1111-111111111111'),
  ('b2000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Vegetarisk lasagne', '11111111-1111-1111-1111-111111111111'),
  ('b2000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Pastasallad med pesto', '11111111-1111-1111-1111-111111111111'),
  ('b2000000-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Ugnsrostade rotfrukter med halloumi', '11111111-1111-1111-1111-111111111111');

insert into public.recipe_versions (
  id,
  organization_id,
  recipe_id,
  version_number,
  status,
  instructions,
  content_digest,
  created_by,
  published_at
) values
  (
    'b2100000-0000-0000-0000-000000000001',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'b2000000-0000-0000-0000-000000000001',
    1,
    'published',
    'Koka havregryn, vatten och salt under omrörning. Servera med äppelmos och valfri dryck.',
    encode(extensions.digest(convert_to('lagermat-demo-recipe:v1:havregrynsgrot-med-appelmos', 'UTF8'), 'sha256'), 'hex'),
    '11111111-1111-1111-1111-111111111111',
    now()
  ),
  (
    'b2100000-0000-0000-0000-000000000002',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'b2000000-0000-0000-0000-000000000002',
    1,
    'published',
    'Vispa smeten slät och stek pannkakorna i omgångar. Servera med sylt.',
    encode(extensions.digest(convert_to('lagermat-demo-recipe:v1:pannkakor-med-sylt', 'UTF8'), 'sha256'), 'hex'),
    '11111111-1111-1111-1111-111111111111',
    now()
  ),
  (
    'b2100000-0000-0000-0000-000000000003',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'b2000000-0000-0000-0000-000000000003',
    1,
    'published',
    'Fräs löken, tillsätt tomater, vatten och buljong och låt soppan sjuda. Mixa, rör i grädde och servera med ostsmörgås.',
    encode(extensions.digest(convert_to('lagermat-demo-recipe:v1:tomatsoppa-med-ostsmorgas', 'UTF8'), 'sha256'), 'hex'),
    '11111111-1111-1111-1111-111111111111',
    now()
  ),
  (
    'b2100000-0000-0000-0000-000000000004',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'b2000000-0000-0000-0000-000000000004',
    1,
    'published',
    'Fräs purjolöken, tillsätt potatis, vatten och buljong och koka mjukt. Mixa och rör i grädde.',
    encode(extensions.digest(convert_to('lagermat-demo-recipe:v1:potatis-och-purjolokssoppa', 'UTF8'), 'sha256'), 'hex'),
    '11111111-1111-1111-1111-111111111111',
    now()
  ),
  (
    'b2100000-0000-0000-0000-000000000005',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'b2000000-0000-0000-0000-000000000005',
    1,
    'published',
    'Fräs lök, morot och curry. Tillsätt linser, tomater, kokosmjölk och buljong och sjud tills linserna är mjuka. Servera med ris.',
    encode(extensions.digest(convert_to('lagermat-demo-recipe:v1:kramig-linsgryta-med-ris', 'UTF8'), 'sha256'), 'hex'),
    '11111111-1111-1111-1111-111111111111',
    now()
  ),
  (
    'b2100000-0000-0000-0000-000000000006',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'b2000000-0000-0000-0000-000000000006',
    1,
    'published',
    'Koka en tomatsås med vegofärs och grönsaker. Varva sås, lasagneplattor och ostsås och grädda tills plattorna är mjuka.',
    encode(extensions.digest(convert_to('lagermat-demo-recipe:v1:vegetarisk-lasagne', 'UTF8'), 'sha256'), 'hex'),
    '11111111-1111-1111-1111-111111111111',
    now()
  ),
  (
    'b2100000-0000-0000-0000-000000000007',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'b2000000-0000-0000-0000-000000000007',
    1,
    'published',
    'Koka pastan och kyl den. Blanda med kikärter, grönsaker, pesto och olja strax före servering.',
    encode(extensions.digest(convert_to('lagermat-demo-recipe:v1:pastasallad-med-pesto', 'UTF8'), 'sha256'), 'hex'),
    '11111111-1111-1111-1111-111111111111',
    now()
  ),
  (
    'b2100000-0000-0000-0000-000000000008',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'b2000000-0000-0000-0000-000000000008',
    1,
    'published',
    'Rosta rotfrukter och lök med olja och örtkryddor. Stek halloumi eller tofu och servera ovanpå.',
    encode(extensions.digest(convert_to('lagermat-demo-recipe:v1:ugnsrostade-rotfrukter-med-halloumi', 'UTF8'), 'sha256'), 'hex'),
    '11111111-1111-1111-1111-111111111111',
    now()
  );

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
  sort_order
) values
  ('b2200000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000001', 'Havregryn', 'kg', 0.05, 'weighted_portion', 'exclude', 'Gluten', 10),
  ('b2200000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000001', 'Glutenfria havregryn', 'kg', 0.05, 'weighted_portion', 'only', 'Gluten', 20),
  ('b2200000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000001', 'Vatten', 'l', 0.25, 'weighted_portion', 'standard', null, 30),
  ('b2200000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000001', 'Salt', 'kg', 0.001, 'weighted_portion', 'standard', null, 40),
  ('b2200000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000001', 'Äppelmos', 'kg', 0.04, 'weighted_portion', 'standard', null, 50),
  ('b2200000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000001', 'Mjölk', 'l', 0.15, 'weighted_portion', 'exclude', 'Mjölkprotein', 60),
  ('b2200000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000001', 'Havredryck', 'l', 0.15, 'weighted_portion', 'only', 'Mjölkprotein', 70),

  ('b2200000-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000002', 'Vetemjöl', 'kg', 0.06, 'weighted_portion', 'exclude', 'Gluten', 10),
  ('b2200000-0000-0000-0000-000000000009', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000002', 'Glutenfri mjölmix', 'kg', 0.06, 'weighted_portion', 'only', 'Gluten', 20),
  ('b2200000-0000-0000-0000-000000000010', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000002', 'Mjölk', 'l', 0.15, 'weighted_portion', 'exclude', 'Mjölkprotein', 30),
  ('b2200000-0000-0000-0000-000000000011', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000002', 'Havredryck', 'l', 0.15, 'weighted_portion', 'only', 'Mjölkprotein', 40),
  ('b2200000-0000-0000-0000-000000000012', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000002', 'Ägg', 'st', 1, 'weighted_portion', 'standard', null, 50),
  ('b2200000-0000-0000-0000-000000000013', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000002', 'Matfett', 'kg', 0.01, 'weighted_portion', 'exclude', 'Mjölkprotein', 60),
  ('b2200000-0000-0000-0000-000000000014', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000002', 'Mjölkfritt matfett', 'kg', 0.01, 'weighted_portion', 'only', 'Mjölkprotein', 70),
  ('b2200000-0000-0000-0000-000000000015', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000002', 'Sylt', 'kg', 0.04, 'weighted_portion', 'standard', null, 80),

  ('b2200000-0000-0000-0000-000000000016', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000003', 'Krossade tomater', 'kg', 0.2, 'weighted_portion', 'standard', null, 10),
  ('b2200000-0000-0000-0000-000000000017', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000003', 'Vatten', 'l', 0.15, 'weighted_portion', 'standard', null, 20),
  ('b2200000-0000-0000-0000-000000000018', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000003', 'Gul lök', 'kg', 0.03, 'weighted_portion', 'standard', null, 30),
  ('b2200000-0000-0000-0000-000000000019', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000003', 'Grönsaksbuljong', 'kg', 0.005, 'weighted_portion', 'standard', null, 40),
  ('b2200000-0000-0000-0000-000000000020', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000003', 'Matlagningsgrädde', 'l', 0.03, 'weighted_portion', 'exclude', 'Mjölkprotein', 50),
  ('b2200000-0000-0000-0000-000000000021', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000003', 'Havregrädde', 'l', 0.03, 'weighted_portion', 'only', 'Mjölkprotein', 60),
  ('b2200000-0000-0000-0000-000000000022', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000003', 'Bröd', 'skivor', 2, 'weighted_portion', 'exclude', 'Gluten', 70),
  ('b2200000-0000-0000-0000-000000000023', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000003', 'Glutenfritt bröd', 'skivor', 2, 'weighted_portion', 'only', 'Gluten', 80),
  ('b2200000-0000-0000-0000-000000000024', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000003', 'Ost', 'skivor', 2, 'weighted_portion', 'exclude', 'Mjölkprotein', 90),
  ('b2200000-0000-0000-0000-000000000025', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000003', 'Mjölkfri ost', 'kg', 0.03, 'weighted_portion', 'only', 'Mjölkprotein', 100),

  ('b2200000-0000-0000-0000-000000000026', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000004', 'Potatis', 'kg', 0.25, 'weighted_portion', 'standard', null, 10),
  ('b2200000-0000-0000-0000-000000000027', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000004', 'Purjolök', 'kg', 0.08, 'weighted_portion', 'standard', null, 20),
  ('b2200000-0000-0000-0000-000000000028', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000004', 'Vatten', 'l', 0.2, 'weighted_portion', 'standard', null, 30),
  ('b2200000-0000-0000-0000-000000000029', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000004', 'Grönsaksbuljong', 'kg', 0.005, 'weighted_portion', 'standard', null, 40),
  ('b2200000-0000-0000-0000-000000000030', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000004', 'Matlagningsgrädde', 'l', 0.05, 'weighted_portion', 'exclude', 'Mjölkprotein', 50),
  ('b2200000-0000-0000-0000-000000000031', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000004', 'Havregrädde', 'l', 0.05, 'weighted_portion', 'only', 'Mjölkprotein', 60),
  ('b2200000-0000-0000-0000-000000000032', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000004', 'Rapsolja', 'l', 0.01, 'weighted_portion', 'standard', null, 70),

  ('b2200000-0000-0000-0000-000000000033', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000005', 'Röda linser', 'kg', 0.08, 'weighted_portion', 'standard', null, 10),
  ('b2200000-0000-0000-0000-000000000034', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000005', 'Ris', 'kg', 0.1, 'weighted_portion', 'standard', null, 20),
  ('b2200000-0000-0000-0000-000000000035', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000005', 'Krossade tomater', 'kg', 0.15, 'weighted_portion', 'standard', null, 30),
  ('b2200000-0000-0000-0000-000000000036', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000005', 'Kokosmjölk', 'l', 0.1, 'weighted_portion', 'standard', null, 40),
  ('b2200000-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000005', 'Gul lök', 'kg', 0.04, 'weighted_portion', 'standard', null, 50),
  ('b2200000-0000-0000-0000-000000000038', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000005', 'Morot', 'kg', 0.08, 'weighted_portion', 'standard', null, 60),
  ('b2200000-0000-0000-0000-000000000039', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000005', 'Grönsaksbuljong', 'kg', 0.005, 'weighted_portion', 'standard', null, 70),
  ('b2200000-0000-0000-0000-000000000040', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000005', 'Curry', 'kg', 0.003, 'weighted_portion', 'standard', null, 80),
  ('b2200000-0000-0000-0000-000000000041', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000005', 'Rapsolja', 'l', 0.01, 'weighted_portion', 'standard', null, 90),

  ('b2200000-0000-0000-0000-000000000042', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000006', 'Lasagneplattor', 'kg', 0.1, 'weighted_portion', 'exclude', 'Gluten', 10),
  ('b2200000-0000-0000-0000-000000000043', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000006', 'Glutenfria lasagneplattor', 'kg', 0.1, 'weighted_portion', 'only', 'Gluten', 20),
  ('b2200000-0000-0000-0000-000000000044', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000006', 'Vegofärs', 'kg', 0.1, 'weighted_portion', 'standard', null, 30),
  ('b2200000-0000-0000-0000-000000000045', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000006', 'Krossade tomater', 'kg', 0.15, 'weighted_portion', 'standard', null, 40),
  ('b2200000-0000-0000-0000-000000000046', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000006', 'Gul lök', 'kg', 0.04, 'weighted_portion', 'standard', null, 50),
  ('b2200000-0000-0000-0000-000000000047', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000006', 'Morot', 'kg', 0.05, 'weighted_portion', 'standard', null, 60),
  ('b2200000-0000-0000-0000-000000000048', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000006', 'Mjölk', 'l', 0.12, 'weighted_portion', 'exclude', 'Mjölkprotein', 70),
  ('b2200000-0000-0000-0000-000000000049', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000006', 'Havredryck', 'l', 0.12, 'weighted_portion', 'only', 'Mjölkprotein', 80),
  ('b2200000-0000-0000-0000-000000000050', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000006', 'Riven ost', 'kg', 0.04, 'weighted_portion', 'exclude', 'Mjölkprotein', 90),
  ('b2200000-0000-0000-0000-000000000051', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000006', 'Mjölkfri riven ost', 'kg', 0.04, 'weighted_portion', 'only', 'Mjölkprotein', 100),
  ('b2200000-0000-0000-0000-000000000052', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000006', 'Rapsolja', 'l', 0.01, 'weighted_portion', 'standard', null, 110),
  ('b2200000-0000-0000-0000-000000000053', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000006', 'Örtkryddor', 'kg', 0.003, 'weighted_portion', 'standard', null, 120),

  ('b2200000-0000-0000-0000-000000000054', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000007', 'Pasta', 'kg', 0.1, 'weighted_portion', 'exclude', 'Gluten', 10),
  ('b2200000-0000-0000-0000-000000000055', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000007', 'Glutenfri pasta', 'kg', 0.1, 'weighted_portion', 'only', 'Gluten', 20),
  ('b2200000-0000-0000-0000-000000000056', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000007', 'Kikärter', 'kg', 0.06, 'weighted_portion', 'standard', null, 30),
  ('b2200000-0000-0000-0000-000000000057', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000007', 'Körsbärstomater', 'kg', 0.08, 'weighted_portion', 'standard', null, 40),
  ('b2200000-0000-0000-0000-000000000058', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000007', 'Gurka', 'kg', 0.08, 'weighted_portion', 'standard', null, 50),
  ('b2200000-0000-0000-0000-000000000059', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000007', 'Majs', 'kg', 0.05, 'weighted_portion', 'standard', null, 60),
  ('b2200000-0000-0000-0000-000000000060', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000007', 'Pesto', 'kg', 0.025, 'weighted_portion', 'exclude', 'Mjölkprotein', 70),
  ('b2200000-0000-0000-0000-000000000061', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000007', 'Mjölkfri pesto', 'kg', 0.025, 'weighted_portion', 'only', 'Mjölkprotein', 80),
  ('b2200000-0000-0000-0000-000000000062', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000007', 'Rapsolja', 'l', 0.01, 'weighted_portion', 'standard', null, 90),

  ('b2200000-0000-0000-0000-000000000063', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000008', 'Potatis', 'kg', 0.2, 'weighted_portion', 'standard', null, 10),
  ('b2200000-0000-0000-0000-000000000064', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000008', 'Morot', 'kg', 0.1, 'weighted_portion', 'standard', null, 20),
  ('b2200000-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000008', 'Palsternacka', 'kg', 0.08, 'weighted_portion', 'standard', null, 30),
  ('b2200000-0000-0000-0000-000000000066', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000008', 'Rödlök', 'kg', 0.04, 'weighted_portion', 'standard', null, 40),
  ('b2200000-0000-0000-0000-000000000067', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000008', 'Halloumi', 'kg', 0.08, 'weighted_portion', 'exclude', 'Mjölkprotein', 50),
  ('b2200000-0000-0000-0000-000000000068', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000008', 'Tofu', 'kg', 0.08, 'weighted_portion', 'only', 'Mjölkprotein', 60),
  ('b2200000-0000-0000-0000-000000000069', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000008', 'Rapsolja', 'l', 0.015, 'weighted_portion', 'standard', null, 70),
  ('b2200000-0000-0000-0000-000000000070', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'b2100000-0000-0000-0000-000000000008', 'Örtkryddor', 'kg', 0.002, 'weighted_portion', 'standard', null, 80);

-- This compact recipe remains an operational fixture for snapshot and
-- calculation workflows.
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

insert into public.camp_recipe_copies (
  id,
  organization_id,
  camp_id,
  source_recipe_version_id,
  name,
  version_key,
  frozen_snapshot,
  copied_by
)
select
  chosen.copy_id,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
  version.id,
  recipe.name,
  version.id::text || '@' || left(version.content_digest, 16),
  jsonb_build_object(
    'name', recipe.name,
    'version', version.version_number,
    'version_key', version.id::text || '@' || left(version.content_digest, 16),
    'content_digest', version.content_digest,
    'instructions', version.instructions,
    'portion_size', version.portion_size,
    'ingredients', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', ingredient.id,
          'name', ingredient.name,
          'unit', ingredient.unit,
          'amount', ingredient.amount::text,
          'mode', ingredient.mode,
          'dietary_rule', ingredient.dietary_rule,
          'dietary_tag_label', ingredient.dietary_tag_label,
          'comment', ingredient.comment,
          'source_row', ingredient.source_row,
          'sort_order', ingredient.sort_order
        )
        order by ingredient.sort_order, ingredient.id
      )
      from public.recipe_ingredients as ingredient
      where ingredient.organization_id = version.organization_id
        and ingredient.recipe_version_id = version.id
    ), '[]'::jsonb)
  ),
  '11111111-1111-1111-1111-111111111111'::uuid
from (values
  ('a4000000-0000-0000-0000-000000000001'::uuid, 'frukost'),
  ('a4000000-0000-0000-0000-000000000002'::uuid, 'pasta-carbonara'),
  ('a4000000-0000-0000-0000-000000000003'::uuid, 'thaigryta-med-kyckling-och-kokosmjolk'),
  ('a4000000-0000-0000-0000-000000000004'::uuid, 'tacos'),
  ('a4000000-0000-0000-0000-000000000005'::uuid, 'hamburgare'),
  ('a4000000-0000-0000-0000-000000000006'::uuid, 'kottbullar-med-pasta-och-tomatsas'),
  ('a4000000-0000-0000-0000-000000000007'::uuid, 'korv-med-brod'),
  ('a4000000-0000-0000-0000-000000000008'::uuid, 'falafel-med-pasta-och-tomatsas')
) as chosen(copy_id, template_key)
join app_private.recipe_templates as template
  on template.template_key = chosen.template_key
join public.recipe_versions as version
  on version.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid
 and version.id = template.id
 and version.status = 'published'
join public.recipes as recipe
  on recipe.organization_id = version.organization_id
 and recipe.id = version.recipe_id;

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
) values
  ('a3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'default:2026-08-02:breakfast', '2026-08-02', '2026-08-02 08:00:00+02', 'breakfast', 'Frukost', 'required', 'default', 10),
  ('a3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'default:2026-08-02:lunch', '2026-08-02', '2026-08-02 12:00:00+02', 'lunch', 'Lunch', 'required', 'default', 20),
  ('a3000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'default:2026-08-02:dinner', '2026-08-02', '2026-08-02 18:00:00+02', 'dinner', 'Middag', 'required', 'default', 30),
  ('a3000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'default:2026-08-03:breakfast', '2026-08-03', '2026-08-03 08:00:00+02', 'breakfast', 'Frukost', 'required', 'default', 10),
  ('a3000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'default:2026-08-03:lunch', '2026-08-03', '2026-08-03 12:00:00+02', 'lunch', 'Lunch', 'required', 'default', 20),
  ('a3000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'default:2026-08-03:dinner', '2026-08-03', '2026-08-03 18:00:00+02', 'dinner', 'Middag', 'required', 'default', 30),
  ('a3000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'default:2026-08-04:breakfast', '2026-08-04', '2026-08-04 08:00:00+02', 'breakfast', 'Frukost', 'required', 'default', 10),
  ('a3000000-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'default:2026-08-04:lunch', '2026-08-04', '2026-08-04 12:00:00+02', 'lunch', 'Lunch', 'required', 'default', 20),
  ('a3000000-0000-0000-0000-000000000009', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'default:2026-08-04:dinner', '2026-08-04', '2026-08-04 18:00:00+02', 'dinner', 'Middag', 'required', 'default', 30),
  ('a3000000-0000-0000-0000-000000000010', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'default:2026-08-05:breakfast', '2026-08-05', '2026-08-05 08:00:00+02', 'breakfast', 'Frukost', 'required', 'default', 10),
  ('a3000000-0000-0000-0000-000000000011', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'default:2026-08-05:lunch', '2026-08-05', '2026-08-05 12:00:00+02', 'lunch', 'Lunch', 'required', 'default', 20),
  ('a3000000-0000-0000-0000-000000000012', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'default:2026-08-05:dinner', '2026-08-05', '2026-08-05 18:00:00+02', 'dinner', 'Middag', 'required', 'default', 30);

insert into public.meals (
  id,
  organization_id,
  camp_id,
  camp_recipe_copy_id,
  meal_slot_id,
  starts_at,
  meal_type,
  title,
  status
) values
  ('a2000000-0000-0000-0000-000000000015', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', '2026-08-02 08:00:00+02', 'breakfast', 'Frukost', 'ready'),
  ('a2000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'a2000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000002', '2026-08-02 12:00:00+02', 'lunch', 'Chili sin carne', 'ready'),
  ('a2000000-0000-0000-0000-000000000016', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'a4000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000003', '2026-08-02 18:00:00+02', 'dinner', 'Pasta carbonara', 'ready'),
  ('a2000000-0000-0000-0000-000000000017', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000004', '2026-08-03 08:00:00+02', 'breakfast', 'Frukost', 'ready'),
  ('a2000000-0000-0000-0000-000000000018', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'a4000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000005', '2026-08-03 12:00:00+02', 'lunch', 'Thaigryta med kyckling och kokosmjölk', 'ready'),
  ('a2000000-0000-0000-0000-000000000019', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'a4000000-0000-0000-0000-000000000004', 'a3000000-0000-0000-0000-000000000006', '2026-08-03 18:00:00+02', 'dinner', 'Tacos', 'ready'),
  ('a2000000-0000-0000-0000-000000000020', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000007', '2026-08-04 08:00:00+02', 'breakfast', 'Frukost', 'ready'),
  ('a2000000-0000-0000-0000-000000000021', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'a4000000-0000-0000-0000-000000000005', 'a3000000-0000-0000-0000-000000000008', '2026-08-04 12:00:00+02', 'lunch', 'Hamburgare', 'ready'),
  ('a2000000-0000-0000-0000-000000000022', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'a4000000-0000-0000-0000-000000000006', 'a3000000-0000-0000-0000-000000000009', '2026-08-04 18:00:00+02', 'dinner', 'Köttbullar med pasta och tomatsås', 'ready'),
  ('a2000000-0000-0000-0000-000000000023', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000010', '2026-08-05 08:00:00+02', 'breakfast', 'Frukost', 'ready'),
  ('a2000000-0000-0000-0000-000000000024', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'a4000000-0000-0000-0000-000000000007', 'a3000000-0000-0000-0000-000000000011', '2026-08-05 12:00:00+02', 'lunch', 'Korv med bröd', 'ready'),
  ('a2000000-0000-0000-0000-000000000025', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'a4000000-0000-0000-0000-000000000008', 'a3000000-0000-0000-0000-000000000012', '2026-08-05 18:00:00+02', 'dinner', 'Falafel med pasta och tomatsås', 'ready');

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
