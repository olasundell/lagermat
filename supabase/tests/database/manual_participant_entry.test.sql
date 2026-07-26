begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_participant(uuid,uuid,text,text,text,text,numeric,timestamp with time zone,timestamp with time zone,text)',
    'EXECUTE'
  ),
  'authenticated users can reach the bounded participant creation RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_participant(uuid,uuid,text,text,text,text,numeric,timestamp with time zone,timestamp with time zone,text)',
    'EXECUTE'
  ),
  'anonymous users cannot execute participant creation'
);
select ok(
  not has_table_privilege('authenticated', 'public.participants', 'INSERT'),
  'browser users cannot bypass the RPC with a direct participant insert'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-4444-444444444444',
  true
);

select ok(
  set_config(
    'test.manual_participant_id',
    public.create_participant(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      '  Manuell Ledare  ',
      '  ledare  ',
      '  KORPEN  ',
      '  matlag granen  ',
      1.1,
      '2026-08-03T08:00:00Z',
      '2026-08-10T18:00:00Z',
      '  Nötallergi  '
    )::text,
    true
  ) <> '',
  'a planner can create a participant'
);

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

select is(
  (
    select concat_ws(
      '|',
      participant.display_name,
      participant.food_factor,
      participant.source_reference,
      coalesce(participant.import_batch_id::text, 'none'),
      division.name,
      patrol.name,
      meal_group.name
    )
    from public.participants participant
    left join public.camp_groups division on division.id = participant.division_id
    left join public.camp_groups patrol on patrol.id = participant.patrol_id
    left join public.camp_groups meal_group on meal_group.id = participant.meal_group_id
    where participant.id = current_setting('test.manual_participant_id')::uuid
  ),
  'Manuell Ledare|1.1000|manual:44444444-4444-4444-4444-444444444444|none|Ledare|Korpen|Matlag Granen',
  'manual creation trims values, reuses groups and records its actor without an import batch'
);
select is(
  (
    select concat_ws('|', attendance.starts_at, attendance.ends_at)
    from public.participant_attendance attendance
    where attendance.participant_id = current_setting('test.manual_participant_id')::uuid
  ),
  '2026-08-03 08:00:00+00|2026-08-10 18:00:00+00',
  'manual creation persists the bounded attendance period'
);
select is(
  (
    select concat_ws('|', need.raw_food_note, need.review_status)
    from public.participant_dietary_needs need
    where need.participant_id = current_setting('test.manual_participant_id')::uuid
  ),
  'Nötallergi|unreviewed',
  'manual dietary text enters the unresolved special-diet gate'
);
select is(
  (
    select concat_ws(
      '|',
      event.event_type,
      event.entity_type,
      event.actor_user_id,
      event.payload ->> 'camp_id'
    )
    from public.audit_events event
    where event.entity_id = current_setting('test.manual_participant_id')
      and event.event_type = 'participant_created'
  ),
  'participant_created|participant|44444444-4444-4444-4444-444444444444|caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'manual creation writes a bounded audit event for the acting member'
);
select is(
  (
    select count(*)::integer
    from public.camp_groups group_row
    where group_row.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and group_row.camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and (
        (group_row.kind = 'division' and lower(group_row.name) = 'ledare')
        or (group_row.kind = 'patrol' and lower(group_row.name) = 'korpen')
        or (group_row.kind = 'meal_group' and lower(group_row.name) = 'matlag granen')
      )
  ),
  3,
  'case-insensitive matching does not duplicate existing groups'
);

select ok(
  set_config(
    'test.admin_participant_id',
    public.create_participant(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'Administratörens gäst',
      'Tillfällig avdelning',
      'Tillfällig patrull',
      'Tillfälligt matlag',
      0.75,
      '2026-08-04T08:00:00Z',
      '2026-08-05T18:00:00Z',
      null
    )::text,
    true
  ) <> '',
  'an organization administrator can create a participant'
);
select is(
  (
    select concat_ws(
      '|',
      division.name,
      patrol.name,
      parent.name,
      meal_group.name,
      participant.source_reference
    )
    from public.participants participant
    join public.camp_groups division on division.id = participant.division_id
    join public.camp_groups patrol on patrol.id = participant.patrol_id
    join public.camp_groups parent on parent.id = patrol.parent_group_id
    join public.camp_groups meal_group on meal_group.id = participant.meal_group_id
    where participant.id = current_setting('test.admin_participant_id')::uuid
  ),
  'Tillfällig avdelning|Tillfällig patrull|Tillfällig avdelning|Tillfälligt matlag|manual:11111111-1111-1111-1111-111111111111',
  'new groups are created with the patrol linked to its division'
);

select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222',
  true
);
select throws_ok(
  $$select public.create_participant(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Intrång',
    '', '', '', 1,
    '2026-08-03T08:00:00Z',
    '2026-08-04T18:00:00Z',
    null
  )$$,
  '42501',
  'Active organization membership required',
  'a non-member cannot create a participant'
);

select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-4444-444444444444',
  true
);
select throws_ok(
  $$select public.create_participant(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
    'Fel läger',
    '', '', '', 1,
    '2026-09-18T08:00:00Z',
    '2026-09-19T18:00:00Z',
    null
  )$$,
  '42501',
  'Camp does not belong to organization',
  'a member cannot cross organizations by pairing the wrong camp and organization'
);
select throws_ok(
  $$select public.create_participant(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    ' ',
    '', '', '', 1,
    '2026-08-03T08:00:00Z',
    '2026-08-04T18:00:00Z',
    null
  )$$,
  '22023',
  'Participant parameters failed validation',
  'a blank participant name is rejected'
);
select throws_ok(
  $$select public.create_participant(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'För lång grupp',
    repeat('g', 121), '', '', 1,
    '2026-08-03T08:00:00Z',
    '2026-08-04T18:00:00Z',
    null
  )$$,
  '22023',
  'Participant group name is too long',
  'group names longer than 120 characters are rejected'
);
select throws_ok(
  $$select public.create_participant(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Fel portion',
    '', '', '', 0,
    '2026-08-03T08:00:00Z',
    '2026-08-04T18:00:00Z',
    null
  )$$,
  '22023',
  'Participant parameters failed validation',
  'a non-positive food factor is rejected'
);
select throws_ok(
  $$select public.create_participant(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Fel datum',
    '', '', '', 1,
    '2026-08-04T18:00:00Z',
    '2026-08-03T08:00:00Z',
    null
  )$$,
  '22023',
  'Participant parameters failed validation',
  'attendance must end after it starts'
);
select throws_ok(
  $$select public.create_participant(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'För lång specialkost',
    '', '', '', 1,
    '2026-08-03T08:00:00Z',
    '2026-08-04T18:00:00Z',
    repeat('d', 2001)
  )$$,
  '22023',
  'Dietary note is too long',
  'dietary text longer than 2000 characters is rejected'
);

select * from finish();
rollback;
