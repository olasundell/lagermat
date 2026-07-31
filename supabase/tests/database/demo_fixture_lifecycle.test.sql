begin;

create extension if not exists pgtap with schema extensions;
select plan(40);

select is(
  (
    select fixture.content_digest
    from app_private.demo_fixture_versions as fixture
    where fixture.fixture_key = 'bjorkstad'
      and fixture.is_active
  ),
  (
    select app_private.demo_fixture_digest(fixture.definition)
    from app_private.demo_fixture_versions as fixture
    where fixture.fixture_key = 'bjorkstad'
      and fixture.is_active
  ),
  'the active Björkstad definition matches its canonical digest'
);

select is(
  (
    select fixture.recipe_catalogue_digest
    from app_private.demo_fixture_versions as fixture
    where fixture.fixture_key = 'bjorkstad'
      and fixture.is_active
  ),
  app_private.recipe_catalogue_digest(),
  'the fixture is bound to the installed recipe catalogue digest'
);

select is(
  (
    select
      instance.organization_id::text || '|' ||
      instance.camp_id::text || '|' ||
      (instance.expires_at - instance.created_at)::text
    from app_private.demo_instances as instance
    where instance.user_id = '11111111-1111-1111-1111-111111111111'
  ),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1|caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1|1 day',
  'the local seed uses the canonical lifecycle while preserving stable test IDs'
);

select is(
  (
    select
      (select count(*) from public.camp_groups where camp_id = instance.camp_id)::text || '|' ||
      (select count(*) from public.participants where camp_id = instance.camp_id)::text || '|' ||
      (select count(*) from public.participant_attendance where camp_id = instance.camp_id)::text || '|' ||
      (select count(*) from public.recipes where organization_id = instance.organization_id)::text || '|' ||
      (select count(*) from public.recipe_ingredients where organization_id = instance.organization_id)::text || '|' ||
      (select count(*) from public.meals where camp_id = instance.camp_id)::text || '|' ||
      (select count(*) from public.supply_lists where camp_id = instance.camp_id)::text
    from app_private.demo_instances as instance
    where instance.user_id = '11111111-1111-1111-1111-111111111111'
  ),
  '18|55|55|34|309|12|1',
  'the local seed contains the full canonical relation graph'
);

select is(
  (
    select event.payload ->> 'template_digest'
    from public.audit_events as event
    where event.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and event.event_type = 'demo_instance_provisioned'
    order by event.id desc
    limit 1
  ),
  (
    select fixture.content_digest
    from app_private.demo_fixture_versions as fixture
    where fixture.fixture_key = 'bjorkstad'
      and fixture.is_active
  ),
  'the local provisioning audit records the exact fixture digest'
);

select ok(
  not has_table_privilege('anon', 'app_private.demo_fixture_versions', 'SELECT')
    and not has_table_privilege('authenticated', 'app_private.demo_fixture_versions', 'SELECT')
    and not has_table_privilege('anon', 'app_private.demo_instances', 'SELECT')
    and not has_table_privilege('authenticated', 'app_private.demo_instances', 'SELECT'),
  'browser roles cannot read either private demo table'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.provision_demo_instance(uuid,boolean)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'authenticated',
      'public.provision_demo_instance(uuid,boolean)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.provision_demo_instance(uuid,boolean)',
      'EXECUTE'
    ),
  'only the service role can execute the public demo provisioner'
);

select ok(
  not has_table_privilege('authenticated', 'public.organizations', 'INSERT')
    and not has_table_privilege(
      'authenticated',
      'public.organization_memberships',
      'INSERT'
    ),
  'authenticated browser sessions cannot insert organizations or memberships directly'
);

select ok(
  not has_function_privilege(
    'service_role',
    'app_private.instantiate_demo_fixture(uuid,timestamp with time zone,boolean,boolean,date,boolean)',
    'EXECUTE'
  ),
  'even the service role cannot call the private local-test adapter directly'
);

select throws_ok(
  $$select * from public.provision_demo_instance(
    '11111111-1111-1111-1111-111111111111',
    false
  )$$,
  '42501',
  'Verified anonymous Auth user required',
  'the public provisioner rejects a normal local account'
);

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
  is_anonymous,
  created_at,
  updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'd0000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'demo-a@anonymous.test',
    '',
    now(),
    '',
    '',
    '',
    '',
    '{"provider":"anonymous","providers":["anonymous"]}',
    '{}',
    true,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'd0000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'demo-b@anonymous.test',
    '',
    now(),
    '',
    '',
    '',
    '',
    '{"provider":"anonymous","providers":["anonymous"]}',
    '{}',
    true,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'd0000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'demo-failed@anonymous.test',
    '',
    now(),
    '',
    '',
    '',
    '',
    '{"provider":"anonymous","providers":["anonymous"]}',
    '{}',
    true,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'd0000000-0000-0000-0000-000000000004',
    'authenticated',
    'authenticated',
    'demo-nonanonymous@test.invalid',
    '',
    now(),
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}',
    '{}',
    false,
    now() - interval '25 hours',
    now() - interval '25 hours'
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'd0000000-0000-0000-0000-000000000005',
    'authenticated',
    'authenticated',
    'demo-orphan-old@anonymous.test',
    '',
    now(),
    '',
    '',
    '',
    '',
    '{"provider":"anonymous","providers":["anonymous"],"lagermat_demo":true}',
    '{}',
    true,
    now() - interval '2 hours',
    now() - interval '2 hours'
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'd0000000-0000-0000-0000-000000000006',
    'authenticated',
    'authenticated',
    'demo-orphan-fresh@anonymous.test',
    '',
    now(),
    '',
    '',
    '',
    '',
    '{"provider":"anonymous","providers":["anonymous"],"lagermat_demo":true}',
    '{}',
    true,
    now(),
    now()
  );

create temporary table test_demo_ids (
  label text primary key,
  user_id uuid not null,
  organization_id uuid not null,
  camp_id uuid not null,
  reused boolean not null
) on commit drop;
grant select on test_demo_ids to authenticated;

insert into test_demo_ids
select
  'a-first',
  provisioned.user_id,
  provisioned.organization_id,
  provisioned.camp_id,
  provisioned.reused
from public.provision_demo_instance(
  'd0000000-0000-0000-0000-000000000001',
  false
) as provisioned;

select is(
  (
    select
      ids.reused::text || '|' ||
      (instance.expires_at - instance.created_at)::text
    from test_demo_ids as ids
    join app_private.demo_instances as instance on instance.user_id = ids.user_id
    where ids.label = 'a-first'
  ),
  'false|1 day',
  'first provisioning creates a new exact-24-hour instance'
);

select is(
  (
    select
      camp.starts_on::text || '|' ||
      camp.ends_on::text || '|' ||
      camp.name
    from test_demo_ids as ids
    join public.camps as camp on camp.id = ids.camp_id
    where ids.label = 'a-first'
  ),
  (
    select
      target.starts_on::text || '|' ||
      (target.starts_on + 3)::text || '|' ||
      'Sommarläger ' || extract(year from target.starts_on)::integer::text
    from (
      select
        (clock_timestamp() at time zone 'Europe/Stockholm')::date + 3
          as starts_on
    ) as target
  ),
  'hosted instances shift the four-day camp to a current, realistic date'
);

select is(
  (
    select
      (select count(*) from public.participants where camp_id = ids.camp_id)::text || '|' ||
      (select count(*) from public.recipes where organization_id = ids.organization_id)::text || '|' ||
      (select count(*) from public.recipe_ingredients where organization_id = ids.organization_id)::text || '|' ||
      (select count(*) from public.meals where camp_id = ids.camp_id)::text
    from test_demo_ids as ids
    where ids.label = 'a-first'
  ),
  '55|34|309|12',
  'a hosted instance receives the complete semantic fixture'
);

select is(
  (
    select membership.role::text
    from test_demo_ids as ids
    join public.organization_memberships as membership
      on membership.organization_id = ids.organization_id
      and membership.user_id = ids.user_id
    where ids.label = 'a-first'
  ),
  'planner',
  'a hosted demo identity receives planner rather than administrator access'
);

select is(
  (
    select
      (users.raw_app_meta_data ->> 'lagermat_demo') || '|' ||
      coalesce(users.raw_user_meta_data ->> 'lagermat_demo', 'absent')
    from auth.users as users
    where users.id = 'd0000000-0000-0000-0000-000000000001'
  ),
  'true|absent',
  'the trusted app metadata marks the demo without relying on user-editable metadata'
);

select ok(
  (
    select ids.organization_id <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and ids.camp_id <> 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    from test_demo_ids as ids
    where ids.label = 'a-first'
  ),
  'hosted fixture IDs are not the local deterministic test IDs'
);

insert into test_demo_ids
select
  'a-retry',
  provisioned.user_id,
  provisioned.organization_id,
  provisioned.camp_id,
  provisioned.reused
from public.provision_demo_instance(
  'd0000000-0000-0000-0000-000000000001',
  false
) as provisioned;

select is(
  (
    select
      retry.reused::text || '|' ||
      (retry.organization_id = first.organization_id)::text || '|' ||
      (retry.camp_id = first.camp_id)::text
    from test_demo_ids as retry
    cross join test_demo_ids as first
    where retry.label = 'a-retry'
      and first.label = 'a-first'
  ),
  'true|true|true',
  'an idempotent retry reuses the active instance'
);

select is(
  (
    select count(*)::integer
    from app_private.demo_instances as instance
    where instance.user_id = 'd0000000-0000-0000-0000-000000000001'
  ),
  1,
  'an idempotent retry creates no duplicate registry row'
);

insert into test_demo_ids
select
  'b-first',
  provisioned.user_id,
  provisioned.organization_id,
  provisioned.camp_id,
  provisioned.reused
from public.provision_demo_instance(
  'd0000000-0000-0000-0000-000000000002',
  false
) as provisioned;

select ok(
  (
    select
      demo_a.organization_id <> demo_b.organization_id
      and demo_a.camp_id <> demo_b.camp_id
      and not exists (
        select 1
        from public.participants as participant_a
        join public.participants as participant_b
          on participant_a.id = participant_b.id
        where participant_a.camp_id = demo_a.camp_id
          and participant_b.camp_id = demo_b.camp_id
      )
    from test_demo_ids as demo_a
    cross join test_demo_ids as demo_b
    where demo_a.label = 'a-first'
      and demo_b.label = 'b-first'
  ),
  'separate users receive disjoint organization, camp and participant UUID graphs'
);

select set_config(
  'request.jwt.claim.sub',
  'd0000000-0000-0000-0000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select is(
  (
    select count(*)::integer
    from public.organizations as organization
    where organization.created_by = 'd0000000-0000-0000-0000-000000000002'
  ),
  0,
  'RLS hides another anonymous demo user organization'
);

select ok(
  not public.is_org_admin((
    select ids.organization_id
    from test_demo_ids as ids
    where ids.label = 'a-first'
  )),
  'the anonymous demo planner does not pass the server-side administrator check'
);

select throws_ok(
  $$
    select public.create_camp(
      (select ids.organization_id from test_demo_ids as ids where ids.label = 'a-first'),
      'Otillåtet demoläger',
      current_date,
      current_date + 1,
      'Europe/Stockholm'
    )
  $$,
  '42501',
  'Organization administrator required',
  'the anonymous demo planner cannot use an administrator RPC'
);
reset role;

insert into test_demo_ids
select
  'a-reset',
  provisioned.user_id,
  provisioned.organization_id,
  provisioned.camp_id,
  provisioned.reused
from public.provision_demo_instance(
  'd0000000-0000-0000-0000-000000000001',
  true
) as provisioned;

select ok(
  (
    select
      reset_row.organization_id <> first.organization_id
      and reset_row.camp_id <> first.camp_id
      and not reset_row.reused
    from test_demo_ids as reset_row
    cross join test_demo_ids as first
    where reset_row.label = 'a-reset'
      and first.label = 'a-first'
  ),
  'reset replaces the complete graph with fresh IDs'
);

select is(
  (
    select count(*)::integer
    from public.organizations as organization
    where organization.id = (
      select ids.organization_id
      from test_demo_ids as ids
      where ids.label = 'a-first'
    )
  ),
  0,
  'reset removes the previous organization through tenant cascades'
);

select is(
  (
    select
      (select count(*) from public.participants where camp_id = ids.camp_id)::text || '|' ||
      (select count(*) from public.recipes where organization_id = ids.organization_id)::text || '|' ||
      (select count(*) from public.meals where camp_id = ids.camp_id)::text
    from test_demo_ids as ids
    where ids.label = 'a-reset'
  ),
  '55|34|12',
  'the reset graph is complete before it replaces the old instance'
);

create temporary table original_demo_fixture
on commit drop
as
select
  fixture.fixture_key,
  fixture.template_version,
  fixture.definition
from app_private.demo_fixture_versions as fixture
where fixture.fixture_key = 'bjorkstad'
  and fixture.is_active;

update app_private.demo_fixture_versions
set definition = jsonb_set(
  definition,
  '{organization,name}',
  '"Tampered fixture"'::jsonb
)
where fixture_key = 'bjorkstad'
  and is_active;

select throws_ok(
  $$select * from public.provision_demo_instance(
    'd0000000-0000-0000-0000-000000000001',
    true
  )$$,
  '55000',
  'Demo fixture digest or identity mismatch',
  'a tampered fixture cannot replace an active instance'
);

select is(
  (
    select instance.organization_id
    from app_private.demo_instances as instance
    where instance.user_id = 'd0000000-0000-0000-0000-000000000001'
  ),
  (
    select ids.organization_id
    from test_demo_ids as ids
    where ids.label = 'a-reset'
  ),
  'a failed reset rolls back and preserves the previous active instance'
);

select throws_ok(
  $$select * from public.provision_demo_instance(
    'd0000000-0000-0000-0000-000000000003',
    false
  )$$,
  '55000',
  'Demo fixture digest or identity mismatch',
  'a tampered fixture cannot create a first instance either'
);

select is(
  (
    select
      (select count(*) from app_private.demo_instances where user_id = 'd0000000-0000-0000-0000-000000000003')::text
      || '|' ||
      (select count(*) from public.organizations where created_by = 'd0000000-0000-0000-0000-000000000003')::text
  ),
  '0|0',
  'failed first provisioning leaves neither registry nor tenant rows'
);

update app_private.demo_fixture_versions as fixture
set definition = original.definition
from original_demo_fixture as original
where fixture.fixture_key = original.fixture_key
  and fixture.template_version = original.template_version;

select set_config(
  'request.jwt.claim.sub',
  'd0000000-0000-0000-0000-000000000002',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select ok(
  public.is_org_member((
    select ids.organization_id
    from test_demo_ids as ids
    where ids.label = 'b-first'
  )),
  'an unexpired demo membership is active'
);
reset role;

update app_private.demo_instances
set
  created_at = statement_timestamp() - interval '24 hours',
  expires_at = statement_timestamp()
where user_id = 'd0000000-0000-0000-0000-000000000002';

select set_config(
  'request.jwt.claim.sub',
  'd0000000-0000-0000-0000-000000000002',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select ok(
  not public.is_org_member((
    select ids.organization_id
    from test_demo_ids as ids
    where ids.label = 'b-first'
  )),
  'tenant access stops at the exact expires_at boundary'
);

select is(
  (
    select status.state
    from public.get_demo_session_status() as status
  ),
  'expired',
  'the authenticated status RPC reports an expired demo without old tenant IDs'
);
reset role;

insert into test_demo_ids
select
  'nonanonymous-expired',
  provisioned.user_id,
  provisioned.organization_id,
  provisioned.camp_id,
  provisioned.reused
from app_private.instantiate_demo_fixture(
  'd0000000-0000-0000-0000-000000000004',
  statement_timestamp() - interval '25 hours',
  false,
  false,
  (clock_timestamp() at time zone 'Europe/Stockholm')::date + 3,
  true
) as provisioned;

create temporary table cleanup_result
on commit drop
as
select *
from app_private.cleanup_expired_demo_instances(statement_timestamp());

select is(
  (
    select
      result.expired_instances_deleted::text || '|' ||
      result.orphan_users_deleted::text
    from cleanup_result as result
  ),
  '1|1',
  'cleanup removes one expired demo and one abandoned anonymous user'
);

select is(
  (
    select
      (select count(*) from auth.users where id = 'd0000000-0000-0000-0000-000000000002')::text
      || '|' ||
      (select count(*) from public.organizations where id = ids.organization_id)::text
    from test_demo_ids as ids
    where ids.label = 'b-first'
  ),
  '0|0',
  'cleanup deletes the expired organization first and then its anonymous Auth user'
);

select is(
  (
    select
      (select count(*) from auth.users where id = 'd0000000-0000-0000-0000-000000000004')::text
      || '|' ||
      (select count(*) from public.organizations where id = ids.organization_id)::text
    from test_demo_ids as ids
    where ids.label = 'nonanonymous-expired'
  ),
  '1|1',
  'cleanup never deletes a non-anonymous user or its organization'
);

select is(
  (
    select count(*)::integer
    from auth.users
    where id = 'd0000000-0000-0000-0000-000000000005'
  ),
  0,
  'cleanup removes an old anonymous orphan without an instance'
);

select is(
  (
    select count(*)::integer
    from auth.users
    where id = 'd0000000-0000-0000-0000-000000000006'
  ),
  1,
  'cleanup preserves a fresh anonymous user during the provisioning grace period'
);

select is(
  (
    select job.schedule || '|' || job.command || '|' || job.active::text
    from cron.job as job
    where job.jobname = 'lagermat-demo-cleanup-hourly'
  ),
  '0 * * * *|select app_private.cleanup_expired_demo_instances();|true',
  'Supabase Cron invokes the private cleanup function every hour'
);

select is(
  (
    select event.payload ->> 'template_digest'
    from test_demo_ids as ids
    join public.audit_events as event
      on event.organization_id = ids.organization_id
    where ids.label = 'a-reset'
      and event.event_type = 'demo_instance_provisioned'
    order by event.id desc
    limit 1
  ),
  (
    select fixture.content_digest
    from app_private.demo_fixture_versions as fixture
    where fixture.fixture_key = 'bjorkstad'
      and fixture.is_active
  ),
  'hosted reset audit evidence retains the canonical fixture digest'
);

select is(
  (
    select count(*)::integer
    from app_private.demo_instances as instance
    where instance.user_id = 'd0000000-0000-0000-0000-000000000001'
      and instance.organization_id = (
        select ids.organization_id
        from test_demo_ids as ids
        where ids.label = 'a-reset'
      )
  ),
  1,
  'the registry keeps exactly one preferred active instance per user'
);

select * from finish();
rollback;
