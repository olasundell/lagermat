begin;

create extension if not exists pgtap with schema extensions;
select plan(58);

select ok(
  not exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and has_table_privilege('authenticated', relation.oid, 'INSERT')
  ),
  'authenticated has no direct INSERT privilege on public tables'
);
select ok(
  not exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and has_table_privilege('authenticated', relation.oid, 'UPDATE')
  ),
  'authenticated has no direct UPDATE privilege on public tables'
);
select ok(
  not exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and has_table_privilege('authenticated', relation.oid, 'DELETE')
  ),
  'authenticated has no direct DELETE privilege on public tables'
);
select ok(
  not exists (
    select 1
    from pg_sequences as sequence
    where sequence.schemaname = 'public'
      and has_sequence_privilege(
        'authenticated',
        to_regclass(format('%I.%I', sequence.schemaname, sequence.sequencename)),
        'USAGE'
      )
  ),
  'authenticated has no direct sequence usage'
);
select ok(
  has_table_privilege('authenticated', 'public.participants', 'SELECT'),
  'authenticated retains RLS-protected reads'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.bootstrap_first_organization(uuid,text,text,text,date,date,text)',
    'EXECUTE'
  ),
  'the hosted bootstrap RPC is not executable by browser users'
);
select ok(
  has_table_privilege('service_role', 'public.organizations', 'SELECT')
    and has_table_privilege(
      'service_role',
      'public.organization_memberships',
      'SELECT'
    ),
  'the server-only bootstrap preflight can inspect organization state'
);
select ok(
  not has_schema_privilege('authenticated', 'app_private', 'USAGE'),
  'browser users cannot access the recipe template schema'
);
select ok(
  to_regprocedure('public.accept_organization_invitation(uuid)') is not null,
  'the UUID invitation acceptance RPC exists'
);
select ok(
  to_regprocedure('public.accept_organization_invitation(text)') is null,
  'the bearer-token invitation RPC has been removed'
);
select ok(
  to_regprocedure(
    'public.change_member_role(uuid,uuid,public.organization_role)'
  ) is not null,
  'the bounded role-change RPC exists'
);
select has_index(
  'public',
  'calculation_revisions',
  'calculation_revisions_one_current_idx',
  'one partial unique index protects the current calculation'
);
select is(
  (select count(*)::integer from app_private.recipe_templates),
  25,
  'the complete approved recipe catalogue is installed by migration'
);
select ok(
  not exists (
    select 1
    from app_private.recipe_ingredient_templates
    where source_row is not null
  ),
  'hosted recipe templates contain no source-workbook row references'
);
select is(
  (select count(*)::integer from app_private.recipe_ingredient_templates),
  245,
  'the hosted catalogue contains every sanitised ingredient component'
);
select is(
  (select string_agg(mode::text || ':' || component_count, ',' order by mode::text)
   from (
     select mode, count(*)::text as component_count
     from app_private.recipe_ingredient_templates
     group by mode
   ) as distribution),
  'fixed_once_per_camp:19,head:6,weighted_portion:220',
  'the hosted catalogue preserves the approved calculation modes'
);
select is(
  (select string_agg(dietary_rule::text || ':' || component_count, ',' order by dietary_rule::text)
   from (
     select dietary_rule, count(*)::text as component_count
     from app_private.recipe_ingredient_templates
     group by dietary_rule
   ) as distribution),
  'exclude:76,only:40,standard:129',
  'the hosted catalogue preserves the approved dietary rules'
);
select ok(
  not exists (
    select 1
    from app_private.recipe_templates as template
    where not exists (
      select 1
      from app_private.recipe_ingredient_templates as ingredient
      where ingredient.recipe_template_id = template.id
    )
  ),
  'every hosted recipe template contains at least one ingredient'
);
select ok(
  not exists (
    select 1
    from app_private.recipe_ingredient_templates
    where (dietary_rule = 'standard') <> (dietary_tag_label is null)
  ),
  'standard ingredients have no dietary label and conditional ingredients do'
);
select is(
  (select string_agg(label, ',' order by label)
   from (
     select distinct dietary_tag_label as label
     from app_private.recipe_ingredient_templates
     where dietary_tag_label is not null
   ) as labels),
  'Bönor,Gluten,Lök,Mjölkprotein,Paprika,Vegetarian',
  'the hosted catalogue uses only the reviewed dietary labels'
);
select is(
  (select count(*)::integer from app_private.recipe_ingredient_templates),
  (select count(distinct (recipe_template_id, sort_order))::integer
   from app_private.recipe_ingredient_templates),
  'ingredient sort order is unique inside every recipe template'
);
select is(
  (select encode(extensions.digest(convert_to(
    string_agg(
      template_key || ':' || content_digest,
      E'\n' order by sort_order, template_key
    ),
    'UTF8'
  ), 'sha256'), 'hex') from app_private.recipe_templates),
  '9b1463da23eab396f3b8ae3946f7374be8698464b226bc145e6a433b1c204068',
  'the hosted catalogue has the reviewed aggregate digest'
);

truncate table public.organizations cascade;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'bootstrap-admin@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '62000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'invited-planner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '63000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'other-admin@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role service_role;
select lives_ok(
  $$select * from public.bootstrap_first_organization(
    '61000000-0000-0000-0000-000000000001',
    'Pilotorganisation',
    'pilotorganisation',
    'Pilotläger',
    '2026-08-01',
    '2026-08-07',
    'Europe/Stockholm'
  )$$,
  'service_role can bootstrap the first organization and camp'
);
reset role;
select is(
  (select count(*)::integer from public.organizations),
  1,
  'bootstrap creates exactly one organization'
);
select is(
  (select count(*)::integer from public.camps),
  1,
  'bootstrap creates exactly one camp'
);
select is(
  (select role::text from public.organization_memberships
   where user_id = '61000000-0000-0000-0000-000000000001'),
  'admin',
  'the invited bootstrap user becomes an administrator'
);
select is(
  (select count(*)::integer from public.recipes),
  25,
  'bootstrap clones every approved recipe template'
);
select is(
  (select count(*)::integer from public.recipe_ingredients),
  245,
  'bootstrap clones every approved recipe ingredient'
);
select is(
  (select payload ->> 'recipe_catalogue_digest'
   from public.audit_events
   where event_type = 'first_organization_bootstrapped'),
  '9b1463da23eab396f3b8ae3946f7374be8698464b226bc145e6a433b1c204068',
  'bootstrap records the exact recipe catalogue digest in the audit trail'
);
select is(
  (select (payload ->> 'ingredient_count')::integer
   from public.audit_events
   where event_type = 'first_organization_bootstrapped'),
  245,
  'bootstrap records the installed ingredient count in the audit trail'
);
set local role service_role;
select throws_ok(
  $$select * from public.bootstrap_first_organization(
    '61000000-0000-0000-0000-000000000001',
    'Annan organisation',
    'annan-organisation',
    'Annat läger',
    '2026-09-01',
    '2026-09-02',
    'Europe/Stockholm'
  )$$,
  '55000',
  'The first organization has already been bootstrapped',
  'bootstrap refuses a conflicting repeat run'
);
reset role;

insert into public.organization_invitations (
  id, organization_id, email, role, token_hash, invited_by, created_at, expires_at
) values
  (
    '64000000-0000-0000-0000-000000000004',
    (select id from public.organizations),
    'invited-planner@example.test',
    'planner',
    null,
    '61000000-0000-0000-0000-000000000001',
    now(),
    now() + interval '1 day'
  ),
  (
    '64000000-0000-0000-0000-000000000014',
    (select id from public.organizations),
    'other-admin@example.test',
    'planner',
    null,
    '61000000-0000-0000-0000-000000000001',
    now(),
    now() + interval '1 day'
  ),
  (
    '64000000-0000-0000-0000-000000000024',
    (select id from public.organizations),
    'invited-planner@example.test',
    'planner',
    null,
    '61000000-0000-0000-0000-000000000001',
    now() - interval '2 days',
    now() - interval '1 day'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '62000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.aal', 'aal1', true);
select throws_ok(
  $$select * from public.accept_organization_invitation(
    '64000000-0000-0000-0000-000000000014'
  )$$,
  '42501',
  'Invitation belongs to another email address',
  'a signed-in user cannot accept an invitation for another email address'
);
select throws_ok(
  $$select * from public.accept_organization_invitation(
    '64000000-0000-0000-0000-000000000024'
  )$$,
  '22023',
  'Invitation is invalid or expired',
  'an expired invitation UUID cannot be accepted'
);
select lives_ok(
  $$select * from public.accept_organization_invitation(
    '64000000-0000-0000-0000-000000000004'
  )$$,
  'the signed-in invited email can accept the UUID invitation'
);
select is(
  (select role::text from public.organization_memberships
   where user_id = '62000000-0000-0000-0000-000000000002'),
  'planner',
  'UUID invitation acceptance creates the requested membership'
);
reset role;
select ok(
  (select accepted_at is not null and token_hash is null
   from public.organization_invitations
   where id = '64000000-0000-0000-0000-000000000004'),
  'accepted invitations retain no bearer token material'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '62000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.aal', 'aal1', true);
select throws_ok(
  $$select * from public.accept_organization_invitation(
    '64000000-0000-0000-0000-000000000004'
  )$$,
  '22023',
  'Invitation is invalid or expired',
  'an invitation UUID cannot be replayed'
);

select set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.aal', 'aal1', true);
select throws_ok(
  $$select public.change_member_role(
    (select id from public.organizations),
    '62000000-0000-0000-0000-000000000002',
    'admin'
  )$$,
  '42501',
  'AAL2 administrator session required',
  'an AAL1 administrator cannot change organization roles'
);
select set_config('request.jwt.claim.aal', 'aal2', true);
select lives_ok(
  $$select public.change_member_role(
    (select id from public.organizations),
    '62000000-0000-0000-0000-000000000002',
    'admin'
  )$$,
  'an AAL2 administrator can promote a member'
);
select is(
  (select role::text from public.organization_memberships
   where user_id = '62000000-0000-0000-0000-000000000002'),
  'admin',
  'the promoted member is now an administrator'
);

reset role;
insert into public.organizations (id, name, slug, created_by)
values (
  '65000000-0000-0000-0000-000000000005',
  'Annan tenant',
  'annan-tenant',
  '63000000-0000-0000-0000-000000000003'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.aal', 'aal2', true);
select throws_ok(
  $$select public.change_member_role(
    '65000000-0000-0000-0000-000000000005',
    '63000000-0000-0000-0000-000000000003',
    'planner'
  )$$,
  '42501',
  'AAL2 administrator session required',
  'an administrator cannot change a member in another tenant'
);

reset role;
update public.organization_memberships
set status = 'suspended'
where user_id = '61000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$select public.change_member_role(
    (select id from public.organizations where slug = 'pilotorganisation'),
    '62000000-0000-0000-0000-000000000002',
    'planner'
  )$$,
  '42501',
  'AAL2 administrator session required',
  'a suspended administrator cannot change roles'
);
reset role;
update public.organization_memberships
set status = 'active'
where user_id = '61000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.change_member_role(
    (select id from public.organizations where slug = 'pilotorganisation'),
    '61000000-0000-0000-0000-000000000001',
    'planner'
  )$$,
  'one of two active administrators may be demoted'
);
select set_config('request.jwt.claim.sub', '62000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.change_member_role(
    (select id from public.organizations where slug = 'pilotorganisation'),
    '62000000-0000-0000-0000-000000000002',
    'planner'
  )$$,
  '22023',
  'The final active administrator cannot be demoted',
  'the final active administrator is protected'
);

select set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.import_participant_batch(
    (select id from public.organizations where slug = 'pilotorganisation'),
    (select id from public.camps where name = 'Pilotläger'),
    'pilot.csv',
    'csv',
    'Deltagare',
    '[]'::jsonb,
    array[]::text[],
    0,
    0,
    '[{"source_row":2,"display_name":"Pilotdeltagare","division":null,"patrol":null,"meal_group":null,"food_factor":1,"attendance_start":"2026-08-01T08:00:00Z","attendance_end":"2026-08-07T08:00:00Z","dietary_note":null}]'::jsonb
  )$$,
  'validated participant import remains available through its RPC'
);
select lives_ok(
  $$select public.save_meal(
    null,
    (select id from public.camps where name = 'Pilotläger'),
    '2026-08-02T08:00:00Z',
    'breakfast',
    'Pilotfrukost',
    (select version.id
     from public.recipe_versions as version
     join public.recipes as recipe on recipe.id = version.recipe_id
     where recipe.name = 'Frukost'),
    '[]'::jsonb
  )$$,
  'validated meal creation remains available through its RPC'
);
select lives_ok(
  $$select public.calculate_camp(
    (select id from public.organizations where slug = 'pilotorganisation'),
    (select id from public.camps where name = 'Pilotläger')
  )$$,
  'a planner can create a digest-bound calculation revision'
);
select is(
  (select calculation_stale from public.get_camp_readiness(
    (select id from public.organizations where slug = 'pilotorganisation'),
    (select id from public.camps where name = 'Pilotläger')
  )),
  false,
  'the shared digest marks the new calculation current'
);
select lives_ok(
  $$select public.update_participant_details(
    (select id from public.participants where display_name = 'Pilotdeltagare'),
    'Pilotdeltagare uppdaterad',
    '', '', '',
    0.8,
    '2026-08-01T09:00:00Z',
    '2026-08-07T07:00:00Z'
  )$$,
  'participant changes remain available through the validated RPC'
);
select is(
  (select calculation_stale from public.get_camp_readiness(
    (select id from public.organizations where slug = 'pilotorganisation'),
    (select id from public.camps where name = 'Pilotläger')
  )),
  true,
  'participant and attendance changes stale the current calculation'
);
select lives_ok(
  $$select public.calculate_camp(
    (select id from public.organizations where slug = 'pilotorganisation'),
    (select id from public.camps where name = 'Pilotläger')
  )$$,
  'recalculation restores one current digest-bound revision'
);
select lives_ok(
  $$select public.generate_supply_lists(
    (select id from public.organizations where slug = 'pilotorganisation'),
    (select id from public.camps where name = 'Pilotläger')
  )$$,
  'a matching current digest can generate supply lists'
);

reset role;
update public.calculation_revisions
set input_digest = repeat('f', 64)
where status = 'current';
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$select public.generate_supply_lists(
    (select id from public.organizations where slug = 'pilotorganisation'),
    (select id from public.camps where name = 'Pilotläger')
  )$$,
  '22023',
  'A current calculation revision is required',
  'supply generation rejects a revision whose digest no longer matches'
);
select lives_ok(
  $$select public.calculate_camp(
    (select id from public.organizations where slug = 'pilotorganisation'),
    (select id from public.camps where name = 'Pilotläger')
  )$$,
  'recalculation repairs a mismatched digest'
);
select lives_ok(
  $$select public.save_meal(
    (select id from public.meals where title = 'Pilotfrukost'),
    (select id from public.camps where name = 'Pilotläger'),
    '2026-08-02T08:00:00Z',
    'breakfast',
    'Pilotfrukost',
    null,
    '[]'::jsonb
  )$$,
  'editing a meal uses the same bounded RPC surface'
);
select is(
  (select calculation_stale from public.get_camp_readiness(
    (select id from public.organizations where slug = 'pilotorganisation'),
    (select id from public.camps where name = 'Pilotläger')
  )),
  true,
  'meal changes stale the calculation even when values are resubmitted'
);

select set_config('request.jwt.claim.sub', '62000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.aal', 'aal1', true);
select throws_ok(
  $$select * from public.list_organization_members(
    (select id from public.organizations where slug = 'pilotorganisation')
  )$$,
  '42501',
  'AAL2 administrator session required',
  'member profile listing also rejects AAL1 administrator sessions'
);
select set_config('request.jwt.claim.aal', 'aal2', true);
select is(
  (select count(*)::integer from public.list_organization_members(
    (select id from public.organizations where slug = 'pilotorganisation')
  )),
  2,
  'an AAL2 administrator can list members in its own organization'
);

select * from finish();
rollback;
