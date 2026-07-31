begin;

create extension if not exists pgtap with schema extensions;
select plan(26);

select ok(
  has_function_privilege(
    'service_role',
    'public.apply_scoutnet_reconciliation(uuid,uuid,jsonb,jsonb,text,uuid)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'authenticated',
      'public.apply_scoutnet_reconciliation(uuid,uuid,jsonb,jsonb,text,uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.apply_scoutnet_reconciliation(uuid,uuid,jsonb,jsonb,text,uuid)',
      'EXECUTE'
    ),
  'only the server trust boundary can execute reconciliation application'
);

select ok(
  (
    select count(*) = 3
    from information_schema.columns
    where table_schema = 'app_private'
      and table_name = 'scoutnet_connections'
      and column_name in (
        'last_successful_sync_by',
        'last_successful_sync_at',
        'last_successful_sync_participant_count'
      )
  ),
  'connection metadata records only the last successful bounded sync'
);

select lives_ok(
  $$select public.connect_scoutnet_project(
    '11111111-1111-1111-1111-111111111111',
    'aal2',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '7701',
    'reconciliation-participants-key',
    'reconciliation-questions-key'
  )$$,
  'an AAL2 administrator can create the synthetic test connection'
);

create function pg_temp.scoutnet_snapshot_row(
  p_reference_character text,
  p_display_name text,
  p_registration_status text,
  p_special_diet jsonb,
  p_attendance jsonb default '[]'::jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'sourceReference',
      'scoutnet:v1:' || repeat(p_reference_character, 43),
    'displayName', p_display_name,
    'registrationStatus', p_registration_status,
    'group', jsonb_build_object(
      'reference', 'scoutnet:v1:' || repeat('g', 43),
      'name', 'Syntetlägret'
    ),
    'division', jsonb_build_object(
      'reference', 'scoutnet:v1:' || repeat('v', 43),
      'name', 'Syntetdivisionen'
    ),
    'patrol', jsonb_build_object(
      'reference', 'scoutnet:v1:' || repeat('p', 43),
      'name', 'Syntetpatrullen'
    ),
    'attendance', p_attendance,
    'attendanceWarnings', '[]'::jsonb,
    'specialDiet', p_special_diet
  );
$$;

insert into public.participants (
  id,
  organization_id,
  camp_id,
  display_name,
  division_id,
  patrol_id,
  meal_group_id,
  food_factor,
  source_reference
) values (
  '81000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Lokalt namn före länk',
  'd1000000-0000-0000-0000-000000000001',
  'd2000000-0000-0000-0000-000000000001',
  'd3000000-0000-0000-0000-000000000001',
  1.7500,
  'manual:81000000-0000-0000-0000-000000000001'
);

insert into public.participants (
  id,
  organization_id,
  camp_id,
  display_name,
  scoutnet_source_reference,
  scoutnet_registration_status,
  lifecycle_status,
  withdrawn_at
) values
  (
    '81000000-0000-0000-0000-000000000002',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Exakt före ändring',
    'scoutnet:v1:' || repeat('c', 43),
    'unconfirmed',
    'active',
    null
  ),
  (
    '81000000-0000-0000-0000-000000000003',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Återtagen före återaktivering',
    'scoutnet:v1:' || repeat('d', 43),
    'confirmed',
    'withdrawn',
    '2026-07-01T10:00:00Z'
  ),
  (
    '81000000-0000-0000-0000-000000000004',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Aktiv före avanmälan',
    'scoutnet:v1:' || repeat('e', 43),
    'confirmed',
    'active',
    null
  ),
  (
    '81000000-0000-0000-0000-000000000005',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Saknas i snapshot',
    'scoutnet:v1:' || repeat('f', 43),
    'confirmed',
    'active',
    null
  );

insert into public.participant_attendance (
  id,
  organization_id,
  camp_id,
  participant_id,
  starts_at,
  ends_at,
  source
) values
  (
    '82000000-0000-0000-0000-000000000001',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '81000000-0000-0000-0000-000000000001',
    '2026-08-02T06:00:00Z',
    '2026-08-03T18:00:00Z',
    'local'
  ),
  (
    '82000000-0000-0000-0000-000000000002',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '81000000-0000-0000-0000-000000000002',
    '2026-08-02T06:00:00Z',
    '2026-08-03T18:00:00Z',
    'scoutnet'
  );

insert into public.participant_dietary_needs (
  id,
  organization_id,
  camp_id,
  participant_id,
  raw_food_note,
  review_status,
  reviewed_by,
  reviewed_at
) values
  (
    '83000000-0000-0000-0000-000000000001',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '81000000-0000-0000-0000-000000000001',
    'Gammal lokal kostuppgift',
    'resolved',
    '11111111-1111-1111-1111-111111111111',
    '2026-07-01T10:00:00Z'
  ),
  (
    '83000000-0000-0000-0000-000000000002',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '81000000-0000-0000-0000-000000000002',
    'Gammal exakt kostuppgift',
    'resolved',
    '11111111-1111-1111-1111-111111111111',
    '2026-07-01T10:00:00Z'
  );

insert into public.dietary_need_tags (
  organization_id,
  camp_id,
  dietary_need_id,
  dietary_tag_id
) values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '83000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000001'
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '83000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000001'
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
  '84000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  999,
  'current',
  repeat('9', 64),
  '{}'::jsonb,
  '11111111-1111-1111-1111-111111111111'
);

create temporary table reconciliation_fixture (
  snapshot jsonb not null,
  decisions jsonb not null,
  state_digest text,
  idempotency_key uuid not null,
  result jsonb
) on commit drop;

insert into reconciliation_fixture (
  snapshot,
  decisions,
  idempotency_key
) values (
  jsonb_build_object(
    'complete', true,
    'participantCount', 6,
    'participants', jsonb_build_array(
      pg_temp.scoutnet_snapshot_row(
        'a',
        'Nyskapad syntetdeltagare',
        'confirmed',
        jsonb_build_array('Ny syntetkost'),
        jsonb_build_array(jsonb_build_object(
          'startsAt', '2026-08-02T06:00:00.000Z',
          'endsAt', '2026-08-05T18:00:00.000Z'
        ))
      ),
      pg_temp.scoutnet_snapshot_row(
        'b',
        'Scoutnetnamn efter explicit länk',
        'confirmed',
        jsonb_build_array('Ny länkad syntetkost'),
        jsonb_build_array(jsonb_build_object(
          'startsAt', '2026-08-03T06:00:00.000Z',
          'endsAt', '2026-08-05T18:00:00.000Z'
        ))
      ),
      pg_temp.scoutnet_snapshot_row(
        'c',
        'Exakt efter ändring',
        'confirmed',
        jsonb_build_array('Ny exakt syntetkost'),
        jsonb_build_array(jsonb_build_object(
          'startsAt', '2026-08-04T06:00:00.000Z',
          'endsAt', '2026-08-05T18:00:00.000Z'
        ))
      ),
      pg_temp.scoutnet_snapshot_row(
        'd',
        'Återaktiverad syntetdeltagare',
        'confirmed',
        '[]'::jsonb
      ),
      pg_temp.scoutnet_snapshot_row(
        'e',
        'Avanmäld syntetdeltagare',
        'cancelled',
        '[]'::jsonb
      ),
      pg_temp.scoutnet_snapshot_row(
        'x',
        'Avanmäld utan lokal rad',
        'cancelled',
        '[]'::jsonb
      )
    )
  ),
  jsonb_build_array(
    jsonb_build_object(
      'sourceReference', 'scoutnet:v1:' || repeat('a', 43),
      'action', 'apply'
    ),
    jsonb_build_object(
      'sourceReference', 'scoutnet:v1:' || repeat('b', 43),
      'action', 'link',
      'participantId', '81000000-0000-0000-0000-000000000001'
    ),
    jsonb_build_object(
      'sourceReference', 'scoutnet:v1:' || repeat('c', 43),
      'action', 'apply'
    ),
    jsonb_build_object(
      'sourceReference', 'scoutnet:v1:' || repeat('d', 43),
      'action', 'apply'
    ),
    jsonb_build_object(
      'sourceReference', 'scoutnet:v1:' || repeat('e', 43),
      'action', 'apply'
    ),
    jsonb_build_object(
      'sourceReference', 'scoutnet:v1:' || repeat('f', 43),
      'action', 'apply'
    ),
    jsonb_build_object(
      'sourceReference', 'scoutnet:v1:' || repeat('x', 43),
      'action', 'skip'
    )
  ),
  '85000000-0000-0000-0000-000000000001'
);

update reconciliation_fixture
set state_digest = public.get_scoutnet_reconciliation_context(
  '11111111-1111-1111-1111-111111111111',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
) ->> 'stateDigest';

select throws_ok(
  $$select public.apply_scoutnet_reconciliation(
    '22222222-2222-2222-2222-222222222222',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    snapshot,
    decisions,
    state_digest,
    idempotency_key
  ) from reconciliation_fixture$$,
  '42501',
  'Active organization administrator required',
  'an administrator from another tenant cannot apply a reconciliation'
);

select throws_ok(
  $$select public.apply_scoutnet_reconciliation(
    '11111111-1111-1111-1111-111111111111',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    snapshot,
    jsonb_build_array(decisions -> 0),
    state_digest,
    '85000000-0000-0000-0000-000000000002'
  ) from reconciliation_fixture$$,
  '22023',
  'Scoutnet reconciliation decisions are incomplete',
  'an incomplete review fails before any participant mutation'
);

select is(
  (
    select count(*)::integer
    from public.participants
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and scoutnet_source_reference =
        'scoutnet:v1:' || repeat('a', 43)
  ),
  0,
  'a rejected review leaves the participant set untouched'
);

update reconciliation_fixture
set result = public.apply_scoutnet_reconciliation(
  '11111111-1111-1111-1111-111111111111',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  snapshot,
  decisions,
  state_digest,
  idempotency_key
);

select is(
  result -> 'counts',
  '{
    "created":1,
    "linked":1,
    "updated":5,
    "reactivated":1,
    "withdrawn":2,
    "skipped":1
  }'::jsonb,
  'the application returns only bounded aggregate outcome counts'
)
from reconciliation_fixture;

select ok(
  exists (
    select 1
    from public.participants
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and scoutnet_source_reference =
        'scoutnet:v1:' || repeat('a', 43)
      and display_name = 'Nyskapad syntetdeltagare'
      and lifecycle_status = 'active'
      and scoutnet_registration_status = 'confirmed'
  ),
  'an approved new Scoutnet identity creates one active participant'
);

select ok(
  (
    select
      participant.pre_scoutnet_display_name =
        'Lokalt namn före länk'
      and participant.pre_scoutnet_division_id =
        'd1000000-0000-0000-0000-000000000001'
      and participant.pre_scoutnet_patrol_id =
        'd2000000-0000-0000-0000-000000000001'
      and participant.meal_group_id =
        'd3000000-0000-0000-0000-000000000001'
      and participant.food_factor = 1.7500
      and participant.source_reference =
        'manual:81000000-0000-0000-0000-000000000001'
    from public.participants as participant
    where participant.id =
      '81000000-0000-0000-0000-000000000001'
  ),
  'explicit linking backs up identity fields and preserves planner-owned fields'
);

select ok(
  (
    select
      participant.display_name =
        'Scoutnetnamn efter explicit länk'
      and participant.scoutnet_source_reference =
        'scoutnet:v1:' || repeat('b', 43)
      and division.name = 'Syntetdivisionen'
      and patrol.name = 'Syntetpatrullen'
    from public.participants as participant
    join public.camp_groups as division
      on division.id = participant.division_id
    join public.camp_groups as patrol
      on patrol.id = participant.patrol_id
    where participant.id =
      '81000000-0000-0000-0000-000000000001'
  ),
  'explicit linking applies only the reviewed Scoutnet-owned identity fields'
);

select ok(
  (
    select
      count(*) filter (
        where attendance.active
          and attendance.source = 'scoutnet'
          and attendance.starts_at = '2026-08-03T06:00:00Z'
      ) = 1
      and count(*) filter (
        where not attendance.active
          and attendance.superseded_at is not null
          and attendance.id =
            '82000000-0000-0000-0000-000000000001'
      ) = 1
    from public.participant_attendance as attendance
    where attendance.participant_id =
      '81000000-0000-0000-0000-000000000001'
  ),
  'changed attendance supersedes history and inserts the exact reviewed ranges'
);

select ok(
  (
    select
      need.raw_food_note = 'Ny länkad syntetkost'
      and need.scoutnet_managed
      and need.review_status = 'unreviewed'
      and need.reviewed_by is null
      and need.reviewed_at is null
      and exists (
        select 1
        from public.dietary_need_tags as link
        where link.dietary_need_id = need.id
          and not link.active
          and link.superseded_at is not null
      )
    from public.participant_dietary_needs as need
    where need.id = '83000000-0000-0000-0000-000000000001'
  ),
  'changed Scoutnet diet text resets review and supersedes prior tags'
);

select ok(
  (
    select
      participant.display_name = 'Exakt efter ändring'
      and participant.scoutnet_registration_status = 'confirmed'
      and participant.lifecycle_status = 'active'
    from public.participants as participant
    where participant.id =
      '81000000-0000-0000-0000-000000000002'
  ),
  'an exact pseudonymous identity is updated without any name matching'
);

select ok(
  (
    select
      participant.lifecycle_status = 'active'
      and participant.withdrawn_at is null
    from public.participants as participant
    where participant.id =
      '81000000-0000-0000-0000-000000000003'
  ),
  'a returning exact Scoutnet identity is recoverably reactivated'
);

select is(
  (
    select count(*)::integer
    from public.participants
    where id in (
      '81000000-0000-0000-0000-000000000004',
      '81000000-0000-0000-0000-000000000005'
    )
      and lifecycle_status = 'withdrawn'
      and withdrawn_at is not null
  ),
  2,
  'both an explicit cancellation and a reviewed missing row are withdrawn'
);

select is(
  (
    select count(*)::integer
    from public.participants
    where scoutnet_source_reference =
      'scoutnet:v1:' || repeat('x', 43)
  ),
  0,
  'a skipped cancelled row never creates a participant'
);

select is(
  (
    select revision.status::text
    from public.calculation_revisions as revision
    where revision.id =
      '84000000-0000-0000-0000-000000000001'
  ),
  'stale',
  'the previously current calculation is invalidated by the atomic apply'
);

select ok(
  (
    select
      connection.last_successful_sync_by =
        '11111111-1111-1111-1111-111111111111'
      and connection.last_successful_sync_at is not null
      and connection.last_successful_sync_participant_count = 6
    from app_private.scoutnet_connections as connection
    where connection.camp_id =
      'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  ),
  'the connection records the successful snapshot boundary without row data'
);

select ok(
  (
    select
      status ->> 'lastSuccessfulSyncAt' is not null
      and (status ->> 'lastSuccessfulSyncParticipantCount')::integer = 6
    from (
      select public.get_scoutnet_connection_status(
        '11111111-1111-1111-1111-111111111111',
        'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      ) as status
    ) as connection_status
  ),
  'the public administrator status exposes only sync time and participant count'
);

select ok(
  (
    select
      count(*) = 1
      and bool_and(
        event.payload ? 'created_count'
        and event.payload ? 'withdrawn_count'
        and event.payload::text not like '%Nyskapad%'
        and event.payload::text not like '%syntetkost%'
      )
    from public.audit_events as event
    where event.event_type = 'scoutnet_reconciliation_applied'
      and event.entity_id =
        'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  ),
  'one redacted audit event contains counts but no participant or diet text'
);

select ok(
  (
    select
      count(*) = 1
      and bool_and(
        application.snapshot_digest ~ '^[0-9a-f]{64}$'
        and application.decision_digest ~ '^[0-9a-f]{64}$'
        and application.result::text not like '%syntetkost%'
        and application.result::text not like '%deltagare%'
      )
    from app_private.scoutnet_reconciliation_applications as application
    where application.idempotency_key =
      '85000000-0000-0000-0000-000000000001'
  ),
  'the private idempotency receipt stores digests and a minimised result only'
);

select is(
  (
    select public.apply_scoutnet_reconciliation(
      '11111111-1111-1111-1111-111111111111',
      'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      snapshot,
      decisions,
      state_digest,
      idempotency_key
    )
    from reconciliation_fixture
  ),
  (select result from reconciliation_fixture),
  'an identical retry returns the original result before stale-state checking'
);

select ok(
  (
    select count(*) = 1
    from app_private.scoutnet_reconciliation_applications
    where idempotency_key =
      '85000000-0000-0000-0000-000000000001'
  )
    and (
      select count(*) = 1
      from public.audit_events
      where event_type = 'scoutnet_reconciliation_applied'
        and entity_id =
          'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    ),
  'an idempotent retry creates neither another receipt nor another audit event'
);

select throws_ok(
  $$select public.apply_scoutnet_reconciliation(
    '11111111-1111-1111-1111-111111111111',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    snapshot,
    jsonb_set(decisions, '{0,action}', '"skip"'::jsonb),
    state_digest,
    idempotency_key
  ) from reconciliation_fixture$$,
  '23505',
  'Scoutnet reconciliation idempotency key conflict',
  'reusing an idempotency key with different decisions is rejected'
);

select throws_ok(
  $$select public.apply_scoutnet_reconciliation(
    '11111111-1111-1111-1111-111111111111',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    snapshot,
    decisions,
    state_digest,
    '85000000-0000-0000-0000-000000000003'
  ) from reconciliation_fixture$$,
  '40001',
  'Scoutnet reconciliation state is stale',
  'a fresh idempotency key cannot apply an obsolete preview'
);

select ok(
  not app_private.valid_scoutnet_reconciliation_decisions(
    jsonb_build_array(
      jsonb_build_object(
        'sourceReference', 'scoutnet:v1:' || repeat('z', 43),
        'action', 'link',
        'participantId', '81000000-0000-0000-0000-000000000001'
      ),
      jsonb_build_object(
        'sourceReference', 'scoutnet:v1:' || repeat('y', 43),
        'action', 'link',
        'participantId', '81000000-0000-0000-0000-000000000001'
      )
    )
  ),
  'one local participant cannot be linked to two Scoutnet identities'
);

select * from finish();
rollback;
