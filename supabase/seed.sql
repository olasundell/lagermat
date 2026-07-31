-- Local-only identities and cross-tenant isolation data. The Björkstad
-- organisation itself is built from the same private, digest-bound fixture
-- used by hosted demo provisioning.
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

-- Sjövik is deliberately outside the demo fixture and remains a separate
-- local tenant used by RLS and cross-organisation tests.
insert into public.organizations (id, name, slug, created_by)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
  'Sjövik scoutkår',
  'sjovik-scoutkar',
  '22222222-2222-2222-2222-222222222222'
);

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
) values (
  'cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
  'Hösthajk 2026',
  '2026-09-18',
  '2026-09-20',
  'Europe/Stockholm',
  'draft',
  '22222222-2222-2222-2222-222222222222',
  null,
  null
);

select *
from app_private.instantiate_demo_fixture(
  '11111111-1111-1111-1111-111111111111',
  clock_timestamp(),
  true,
  true,
  '2026-08-02',
  true
);

insert into public.organization_memberships (
  organization_id,
  user_id,
  role,
  status
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '44444444-4444-4444-4444-444444444444',
  'planner',
  'active'
);
