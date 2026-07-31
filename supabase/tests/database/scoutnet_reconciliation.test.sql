begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

select ok(
  (
    select count(*) = 3
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'participants'
      and column_name in (
        'lifecycle_status',
        'scoutnet_source_reference',
        'pre_scoutnet_display_name'
      )
  ),
  'participants have recoverable lifecycle and dedicated Scoutnet identity fields'
);

select ok(
  (
    select count(*) = 4
    from information_schema.columns
    where table_schema = 'public'
      and (
        (
          table_name = 'participant_attendance'
          and column_name in ('active', 'superseded_at')
        )
        or (
          table_name = 'dietary_need_tags'
          and column_name in ('active', 'superseded_at')
        )
      )
  ),
  'attendance and dietary tags can be superseded without deletion'
);

select ok(
  not has_table_privilege(
    'anon',
    'app_private.scoutnet_reconciliation_applications',
    'SELECT'
  )
    and not has_table_privilege(
      'authenticated',
      'app_private.scoutnet_reconciliation_applications',
      'SELECT'
    )
    and not has_table_privilege(
      'service_role',
      'app_private.scoutnet_reconciliation_applications',
      'SELECT'
    ),
  'no Data API role can read reconciliation receipts directly'
);

select ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_class as relation
    where relation.oid =
      'app_private.scoutnet_reconciliation_applications'::regclass
  ),
  'the private reconciliation receipt table forces RLS'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.get_scoutnet_reconciliation_context(uuid,uuid)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'authenticated',
      'public.get_scoutnet_reconciliation_context(uuid,uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.get_scoutnet_reconciliation_context(uuid,uuid)',
      'EXECUTE'
    ),
  'only the server trust boundary can read reconciliation context'
);

select throws_ok(
  $$select public.get_scoutnet_reconciliation_context(
    '22222222-2222-2222-2222-222222222222',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  )$$,
  '42501',
  'Active organization administrator required',
  'another tenant cannot read reconciliation context'
);

select ok(
  app_private.valid_scoutnet_reconciliation_snapshot(
    jsonb_build_object(
      'complete', true,
      'participantCount', 1,
      'participants', jsonb_build_array(jsonb_build_object(
        'sourceReference', 'scoutnet:v1:' || repeat('a', 43),
        'displayName', 'Syntetisk Scout',
        'registrationStatus', 'confirmed',
        'group', jsonb_build_object(
          'reference', 'scoutnet:v1:' || repeat('b', 43),
          'name', 'Lägret'
        ),
        'division', jsonb_build_object(
          'reference', 'scoutnet:v1:' || repeat('c', 43),
          'name', 'Upptäckarna'
        ),
        'patrol', jsonb_build_object(
          'reference', 'scoutnet:v1:' || repeat('d', 43),
          'name', 'Räven'
        ),
        'attendance', jsonb_build_array(jsonb_build_object(
          'startsAt', '2026-08-02T06:00:00.000Z',
          'endsAt', '2026-08-05T18:00:00.000Z'
        )),
        'attendanceWarnings', '[]'::jsonb,
        'specialDiet', jsonb_build_array('Gluten')
      ))
    )
  ),
  'a complete bounded synthetic snapshot passes the database boundary'
);

select ok(
  not app_private.valid_scoutnet_reconciliation_snapshot(
    '{"complete":true,"participantCount":0,"participants":[]}'::jsonb
  ),
  'an unexpected empty snapshot cannot become an authoritative withdrawal source'
);

select ok(
  not app_private.valid_scoutnet_reconciliation_snapshot(
    jsonb_build_object(
      'complete', true,
      'participantCount', 2,
      'participants', jsonb_build_array(
        jsonb_build_object(
          'sourceReference', 'scoutnet:v1:' || repeat('a', 43),
          'displayName', 'A',
          'registrationStatus', 'confirmed',
          'group', '{"reference":null,"name":null}'::jsonb,
          'division', '{"reference":null,"name":null}'::jsonb,
          'patrol', '{"reference":null,"name":null}'::jsonb,
          'attendance', '[]'::jsonb,
          'attendanceWarnings', '[]'::jsonb,
          'specialDiet', '[]'::jsonb
        ),
        jsonb_build_object(
          'sourceReference', 'scoutnet:v1:' || repeat('a', 43),
          'displayName', 'B',
          'registrationStatus', 'confirmed',
          'group', '{"reference":null,"name":null}'::jsonb,
          'division', '{"reference":null,"name":null}'::jsonb,
          'patrol', '{"reference":null,"name":null}'::jsonb,
          'attendance', '[]'::jsonb,
          'attendanceWarnings', '[]'::jsonb,
          'specialDiet', '[]'::jsonb
        )
      )
    )
  ),
  'duplicate source identities fail the whole snapshot'
);

insert into public.participants (
  id,
  organization_id,
  camp_id,
  display_name,
  source_reference,
  scoutnet_source_reference,
  scoutnet_registration_status
) values (
  '71000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Exakt Scoutnet-identitet',
  'manual:legacy-marker',
  'scoutnet:v1:' || repeat('e', 43),
  'confirmed'
);

insert into public.participants (
  id,
  organization_id,
  camp_id,
  display_name,
  source_reference
) values (
  '71000000-0000-0000-0000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Manuellt lika namn',
  'manual:11111111-1111-1111-1111-111111111111'
);

select is(
  (
    select participant ->> 'sourceKind'
    from jsonb_array_elements(
      public.get_scoutnet_reconciliation_context(
        '11111111-1111-1111-1111-111111111111',
        'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      ) -> 'participants'
    ) as participant
    where participant ->> 'id' =
      '71000000-0000-0000-0000-000000000001'
  ),
  'scoutnet',
  'dedicated Scoutnet identity wins over the overloaded legacy source field'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_scoutnet_reconciliation_context(
        '11111111-1111-1111-1111-111111111111',
        'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      ) -> 'participants'
    ) as participant
    where participant ->> 'id' =
        '71000000-0000-0000-0000-000000000002'
      and participant ->> 'sourceKind' = 'manual'
      and participant -> 'sourceReference' = 'null'::jsonb
  ),
  'manual participants are candidates only and have no automatic Scoutnet identity'
);

select throws_ok(
  $$insert into public.participants (
    organization_id,
    camp_id,
    display_name,
    scoutnet_source_reference
  ) values (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Dubblett',
    'scoutnet:v1:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  )$$,
  '23505',
  null,
  'a partial camp-scoped unique index blocks duplicate Scoutnet identities'
);

insert into public.participants (
  id,
  organization_id,
  camp_id,
  display_name,
  lifecycle_status,
  withdrawn_at
) values (
  '71000000-0000-0000-0000-000000000003',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Återtagen med ogranskad kost',
  'withdrawn',
  now()
);

insert into public.participant_dietary_needs (
  id,
  organization_id,
  camp_id,
  participant_id,
  raw_food_note,
  review_status
) values (
  '72000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '71000000-0000-0000-0000-000000000003',
  'Syntetisk uppgift',
  'unreviewed'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

select is(
  (
    select readiness.unresolved_dietary_needs
    from public.get_camp_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    ) as readiness
  ),
  1::bigint,
  'readiness ignores a withdrawn participant dietary need'
);

reset role;

create temporary table digest_probe (value text not null);
insert into digest_probe
select public.camp_input_digest(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
);

update public.participants
set display_name = 'Ändrad men fortfarande återtagen'
where id = '71000000-0000-0000-0000-000000000003';

select is(
  public.camp_input_digest(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  ),
  (select value from digest_probe),
  'changes to a withdrawn participant do not alter the active planning digest'
);

truncate digest_probe;
insert into digest_probe
select public.camp_input_digest(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
);

update public.participant_dietary_needs
set raw_food_note = 'Ändrad rå specialkost'
where id = 'f2000000-0000-0000-0000-000000000001';

select isnt(
  public.camp_input_digest(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  ),
  (select value from digest_probe),
  'an active raw dietary-note change alters the canonical planning digest'
);

update public.dietary_need_tags
set active = false, superseded_at = now()
where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  and camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  and dietary_need_id = 'f2000000-0000-0000-0000-000000000001'
  and dietary_tag_id = 'f1000000-0000-0000-0000-000000000001';

select lives_ok(
  $$select public.review_dietary_need(
    'f2000000-0000-0000-0000-000000000001',
    array['Gluten']
  )$$,
  'a superseded dietary tag can be restored without deleting its history row'
);

select ok(
  (
    select link.active and link.superseded_at is null
    from public.dietary_need_tags as link
    where link.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and link.camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and link.dietary_need_id = 'f2000000-0000-0000-0000-000000000001'
      and link.dietary_tag_id = 'f1000000-0000-0000-0000-000000000001'
  ),
  'review reactivates the selected historical tag link'
);

select * from finish();
rollback;
