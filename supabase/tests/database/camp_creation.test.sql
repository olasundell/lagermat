begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_camp(uuid,text,date,date,text)',
    'EXECUTE'
  ),
  'authenticated users can reach the bounded camp creation RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_camp(uuid,text,date,date,text)',
    'EXECUTE'
  ),
  'anonymous users cannot execute camp creation'
);
select ok(
  not has_table_privilege('authenticated', 'public.camps', 'INSERT'),
  'browser users cannot bypass the RPC with a direct camp insert'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);
select set_config('request.jwt.claim.aal', 'aal1', true);

select throws_ok(
  $$select public.create_camp(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Vinterläger utan MFA',
    '2025-01-03',
    '2025-01-05',
    'Europe/Stockholm'
  )$$,
  '42501',
  'Two-step verification required',
  'an AAL1 organization administrator cannot create a camp'
);

select set_config('request.jwt.claim.aal', 'aal2', true);

select ok(
  set_config(
    'test.created_camp_id',
    public.create_camp(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      '  Vinterläger 2025  ',
      '2025-01-03',
      '2025-01-05',
      'Europe/Stockholm'
    )::text,
    true
  ) <> '',
  'an organization administrator can create a camp'
);
select is(
  (
    select concat_ws(
      '|',
      name,
      starts_on,
      ends_on,
      timezone,
      status,
      created_by
    )
    from public.camps
    where id = current_setting('test.created_camp_id')::uuid
  ),
  'Vinterläger 2025|2025-01-03|2025-01-05|Europe/Stockholm|draft|11111111-1111-1111-1111-111111111111',
  'camp creation trims the name and persists dates, timezone, draft status and actor'
);
select is(
  (
    select concat_ws(
      '|',
      event_type,
      entity_type,
      entity_id,
      actor_user_id,
      payload ->> 'organization_id',
      payload ->> 'starts_on',
      payload ->> 'ends_on'
    )
    from public.audit_events
    where entity_id = current_setting('test.created_camp_id')
      and event_type = 'camp_created'
  ),
  'camp_created|camp|'
    || current_setting('test.created_camp_id')
    || '|11111111-1111-1111-1111-111111111111'
    || '|aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1|2025-01-03|2025-01-05',
  'camp creation writes the required audit event and bounded payload'
);

select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-4444-444444444444',
  true
);
select throws_ok(
  $$select public.create_camp(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Plannerläger',
    '2025-02-01',
    '2025-02-02',
    'Europe/Stockholm'
  )$$,
  '42501',
  'Organization administrator required',
  'a planner cannot create a camp'
);

select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222',
  true
);
select throws_ok(
  $$select public.create_camp(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Annat läger',
    '2025-02-01',
    '2025-02-02',
    'Europe/Stockholm'
  )$$,
  '42501',
  'Organization administrator required',
  'an administrator from another organization cannot create a camp'
);

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);
select throws_ok(
  $$select public.create_camp(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'A',
    '2025-02-01',
    '2025-02-02',
    'Europe/Stockholm'
  )$$,
  '22023',
  'Camp parameters failed validation',
  'camp names shorter than two characters are rejected'
);
select throws_ok(
  $$select public.create_camp(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Bakvänt läger',
    '2025-02-03',
    '2025-02-02',
    'Europe/Stockholm'
  )$$,
  '22023',
  'Camp parameters failed validation',
  'a camp cannot end before it starts'
);
select throws_ok(
  $$select public.create_camp(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Tidszonsläger',
    '2025-02-01',
    '2025-02-02',
    'Europe/Atlantis'
  )$$,
  '22023',
  'Unknown camp timezone',
  'an unknown IANA timezone is rejected'
);

select * from finish();
rollback;
