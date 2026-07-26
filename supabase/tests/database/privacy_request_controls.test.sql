begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

select ok(
  has_function_privilege(
    'authenticated',
    'public.export_participant_privacy_data(uuid)',
    'EXECUTE'
  ),
  'authenticated users can reach the bounded participant export RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.export_participant_privacy_data(uuid)',
    'EXECUTE'
  ),
  'anonymous users cannot execute participant privacy exports'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.delete_participant_for_privacy(uuid)',
    'EXECUTE'
  ),
  'authenticated users can reach the bounded participant deletion RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.delete_participant_for_privacy(uuid)',
    'EXECUTE'
  ),
  'anonymous users cannot execute participant privacy deletions'
);
select ok(
  not has_table_privilege('authenticated', 'public.participants', 'DELETE'),
  'browser users cannot bypass the RPC with a direct participant delete'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-4444-444444444444',
  true
);
select set_config(
  'test.privacy_participant_id',
  public.create_participant(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Integritet Testperson',
    'Spårarna',
    'Igelkotten',
    'Matlag Granen',
    0.75,
    '2026-08-03T08:00:00Z',
    '2026-08-07T18:00:00Z',
    'Glutenfri testkost'
  )::text,
  true
);

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);
select set_config('request.jwt.claim.aal', 'aal1', true);

select throws_ok(
  $$select public.export_participant_privacy_data(
    current_setting('test.privacy_participant_id')::uuid
  )$$,
  '42501',
  'Two-step verification required',
  'an AAL1 administrator cannot export participant data'
);
select throws_ok(
  $$select public.delete_participant_for_privacy(
    current_setting('test.privacy_participant_id')::uuid
  )$$,
  '42501',
  'Two-step verification required',
  'an AAL1 administrator cannot delete a participant'
);

select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-4444-444444444444',
  true
);
select set_config('request.jwt.claim.aal', 'aal2', true);

select throws_ok(
  $$select public.export_participant_privacy_data(
    current_setting('test.privacy_participant_id')::uuid
  )$$,
  '42501',
  'Organization administrator required',
  'an AAL2 planner cannot export participant data'
);
select throws_ok(
  $$select public.delete_participant_for_privacy(
    current_setting('test.privacy_participant_id')::uuid
  )$$,
  '42501',
  'Organization administrator required',
  'an AAL2 planner cannot delete a participant'
);

select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222',
  true
);

select throws_ok(
  $$select public.export_participant_privacy_data(
    current_setting('test.privacy_participant_id')::uuid
  )$$,
  '42501',
  'Organization administrator required',
  'an administrator from another organization cannot export participant data'
);
select throws_ok(
  $$select public.delete_participant_for_privacy(
    current_setting('test.privacy_participant_id')::uuid
  )$$,
  '42501',
  'Organization administrator required',
  'an administrator from another organization cannot delete a participant'
);

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

select ok(
  set_config(
    'test.privacy_export',
    public.export_participant_privacy_data(
      current_setting('test.privacy_participant_id')::uuid
    )::text,
    true
  ) <> '',
  'an AAL2 organization administrator can export participant data'
);
select is(
  concat_ws(
    '|',
    current_setting('test.privacy_export')::jsonb ->> 'schema_version',
    current_setting('test.privacy_export')::jsonb #>> '{organization,name}',
    current_setting('test.privacy_export')::jsonb #>> '{camp,name}',
    current_setting('test.privacy_export')::jsonb #>> '{participant,display_name}',
    current_setting('test.privacy_export')::jsonb #>> '{participant,groups,division}',
    current_setting('test.privacy_export')::jsonb #>> '{participant,groups,patrol}',
    current_setting('test.privacy_export')::jsonb #>> '{participant,groups,meal_group}'
  ),
  '1|Björkstad scoutkår|Sommarläger 2026|Integritet Testperson|Spårarna|Igelkotten|Matlag Granen',
  'the export identifies its schema and includes the participant camp and groups'
);
select is(
  concat_ws(
    '|',
    current_setting('test.privacy_export')::jsonb #>> '{attendance,0,starts_at}',
    current_setting('test.privacy_export')::jsonb #>> '{attendance,0,ends_at}'
  ),
  '2026-08-03T08:00:00+00:00|2026-08-07T18:00:00+00:00',
  'the export includes participant attendance'
);
select is(
  concat_ws(
    '|',
    current_setting('test.privacy_export')::jsonb #>> '{dietary_needs,0,raw_food_note}',
    current_setting('test.privacy_export')::jsonb #>> '{dietary_needs,0,review_status}',
    jsonb_array_length(
      current_setting('test.privacy_export')::jsonb #> '{dietary_needs,0,tags}'
    )
  ),
  'Glutenfri testkost|unreviewed|0',
  'the export includes dietary data and its reviewed tag set'
);
select ok(
  current_setting('test.privacy_export')::jsonb
    #>> '{participant,source_reference}' like 'manual:%',
  'the export includes the participant source reference'
);
select is(
  jsonb_array_length(
    current_setting('test.privacy_export')::jsonb -> 'audit_events'
  ),
  2,
  'the export includes creation and privacy-export audit events'
);

select lives_ok(
  $$select public.delete_participant_for_privacy(
    current_setting('test.privacy_participant_id')::uuid
  )$$,
  'an AAL2 organization administrator can delete a participant'
);
select is(
  (
    select count(*)::integer
    from public.participants
    where id = current_setting('test.privacy_participant_id')::uuid
  ),
  0,
  'privacy deletion removes the participant'
);
select is(
  (
    select count(*)::integer
    from public.participant_attendance
    where participant_id = current_setting('test.privacy_participant_id')::uuid
  ),
  0,
  'privacy deletion cascades through attendance'
);
select is(
  (
    select count(*)::integer
    from public.participant_dietary_needs
    where participant_id = current_setting('test.privacy_participant_id')::uuid
  ),
  0,
  'privacy deletion cascades through dietary data'
);
select is(
  (
    select concat_ws(
      '|',
      event.event_type,
      event.entity_type,
      event.entity_id,
      event.payload ->> 'camp_id',
      event.payload ->> 'deleted_attendance_count',
      event.payload ->> 'deleted_dietary_need_count'
    )
    from public.audit_events as event
    where event.event_type = 'participant_privacy_deleted'
      and event.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    order by event.id desc
    limit 1
  ),
  'participant_privacy_deleted|privacy_request|deleted-participant|caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1|1|1',
  'privacy deletion leaves a bounded non-identifying audit event'
);
select ok(
  not exists (
    select 1
    from public.audit_events as event
    where event.event_type = 'participant_privacy_deleted'
      and (
        event.entity_id like '%Integritet%'
        or event.payload::text like '%Integritet%'
        or event.payload::text like '%Glutenfri%'
        or event.payload::text like '%' || current_setting('test.privacy_participant_id') || '%'
      )
  ),
  'the retained deletion audit contains no participant identifier name or dietary text'
);
select throws_ok(
  $$select public.delete_participant_for_privacy(
    current_setting('test.privacy_participant_id')::uuid
  )$$,
  '22023',
  'Participant not found',
  'a repeated deletion reports that the participant is already absent'
);

select * from finish();
rollback;
