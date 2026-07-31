begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

select ok(
  app_private.valid_scoutnet_question_mapping(
    '{
      "division_question_id":"1301",
      "special_diet_question_ids":["1201","1202"],
      "attendance_intervals":[{
        "starts_at_question_id":"1101",
        "ends_at_question_id":"1102"
      }]
    }'::jsonb
  ),
  'the database accepts multiple special-diet question IDs'
);

select ok(
  app_private.valid_scoutnet_question_mapping(
    '{
      "special_diet_question_ids":["1201"],
      "attendance_days":[
        {"question_id":"1401","date":"2026-08-02"},
        {"question_id":"1402","date":"2026-08-04"}
      ]
    }'::jsonb
  ),
  'the database accepts explicit selected-day mappings'
);

select ok(
  not app_private.valid_scoutnet_question_mapping(
    '{
      "special_diet_question_id":"1201",
      "special_diet_question_ids":["1202"]
    }'::jsonb
  ),
  'singular and plural special-diet mappings cannot coexist'
);

select ok(
  not app_private.valid_scoutnet_question_mapping(
    '{
      "special_diet_question_ids":["1201"],
      "attendance_intervals":[{
        "starts_at_question_id":"1101",
        "ends_at_question_id":"1102"
      }],
      "attendance_days":[
        {"question_id":"1401","date":"2026-08-02"}
      ]
    }'::jsonb
  ),
  'arrival/departure and selected-day attendance modes cannot coexist'
);

select ok(
  not app_private.valid_scoutnet_question_mapping(
    '{
      "special_diet_question_ids":["1201","1201"],
      "attendance_intervals":[{
        "starts_at_question_id":"1101",
        "ends_at_question_id":"1102"
      }]
    }'::jsonb
  ),
  'a question ID cannot be mapped twice'
);

select ok(
  not app_private.valid_scoutnet_question_mapping(
    '{
      "special_diet_question_ids":["1201"],
      "attendance_days":[
        {"question_id":"1401","date":"2026-02-30"}
      ]
    }'::jsonb
  ),
  'selected-day mappings require real ISO dates'
);

select lives_ok(
  $$select public.connect_scoutnet_project(
    '11111111-1111-1111-1111-111111111111',
    'aal2',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '7701',
    'adapter-participants-key',
    'adapter-questions-key'
  )$$,
  'an AAL2 administrator can create the adapter test connection'
);

select is(
  public.update_scoutnet_question_mapping(
    '11111111-1111-1111-1111-111111111111',
    'aal2',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '{
      "division_question_id":"1301",
      "special_diet_question_ids":["1201","1202"],
      "attendance_intervals":[{
        "starts_at_question_id":"1101",
        "ends_at_question_id":"1102"
      }]
    }'::jsonb
  ) #>> '{questionMapping,special_diet_question_ids,1}',
  '1202',
  'the service wrapper persists a plural diet mapping'
);

select is(
  public.update_scoutnet_question_mapping(
    '11111111-1111-1111-1111-111111111111',
    'aal2',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '{
      "special_diet_question_ids":["1201"],
      "attendance_days":[
        {"question_id":"1401","date":"2026-08-02"},
        {"question_id":"1402","date":"2026-08-04"}
      ]
    }'::jsonb
  ) #>> '{questionMapping,attendance_days,1,date}',
  '2026-08-04',
  'the service wrapper persists a selected-day mapping'
);

select is(
  (
    select
      credentials.starts_on::text
      || '|'
      || credentials.ends_on::text
      || '|'
      || credentials.timezone
    from public.get_scoutnet_connection_credentials(
      '44444444-4444-4444-4444-444444444444',
      'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    ) as credentials
  ),
  '2026-08-02|2026-08-05|Europe/Stockholm',
  'the server credential wrapper returns bounded camp date context'
);

select is(
  (
    select
      credentials.organization_id::text
      || '|'
      || credentials.project_id
    from public.get_scoutnet_connection_credentials(
      '44444444-4444-4444-4444-444444444444',
      'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    ) as credentials
  ),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1|7701',
  'the adapter context remains bound to the active member tenant'
);

select throws_ok(
  $$select *
  from public.get_scoutnet_connection_credentials(
    '22222222-2222-2222-2222-222222222222',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  )$$,
  '42501',
  'Active organization membership required',
  'another tenant cannot load the adapter context'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.get_scoutnet_connection_credentials(uuid,uuid)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'anon',
      'public.get_scoutnet_connection_credentials(uuid,uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.get_scoutnet_connection_credentials(uuid,uuid)',
      'EXECUTE'
    ),
  'only the server trust boundary can load adapter credentials'
);

select * from finish();
rollback;
