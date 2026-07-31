begin;

create extension if not exists pgtap with schema extensions;
select plan(36);

select ok(
  not has_table_privilege(
    'anon',
    'app_private.scoutnet_connections',
    'SELECT'
  )
    and not has_table_privilege(
      'authenticated',
      'app_private.scoutnet_connections',
      'SELECT'
    )
    and not has_table_privilege(
      'service_role',
      'app_private.scoutnet_connections',
      'SELECT'
    ),
  'no Data API role can read private Scoutnet connection metadata directly'
);

select ok(
  not has_schema_privilege('anon', 'app_private', 'USAGE')
    and not has_schema_privilege('authenticated', 'app_private', 'USAGE')
    and not has_schema_privilege('service_role', 'app_private', 'USAGE')
    and not has_schema_privilege('anon', 'vault', 'USAGE')
    and not has_schema_privilege('authenticated', 'vault', 'USAGE'),
  'browser roles have no private or Vault schema access and service_role has no private schema access'
);

select ok(
  not has_table_privilege('anon', 'vault.secrets', 'SELECT')
    and not has_table_privilege(
      'authenticated',
      'vault.decrypted_secrets',
      'SELECT'
    ),
  'browser roles cannot read Vault ciphertext or decrypted values'
);

select ok(
  not has_function_privilege(
    'anon',
    'vault.create_secret(text,text,text,uuid)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'authenticated',
      'vault.update_secret(uuid,text,text,text,uuid)',
      'EXECUTE'
    ),
  'browser roles cannot create or rotate Vault values'
);

select ok(
  (
    select bool_and(
      has_function_privilege(
        'service_role',
        function_name,
        'EXECUTE'
      )
        and not has_function_privilege(
          'anon',
          function_name,
          'EXECUTE'
        )
        and not has_function_privilege(
          'authenticated',
          function_name,
          'EXECUTE'
        )
    )
    from unnest(array[
      'public.get_scoutnet_connection_status(uuid,uuid)',
      'public.connect_scoutnet_project(uuid,text,uuid,text,text,text)',
      'public.rotate_scoutnet_connection(uuid,text,uuid,text,text,text)',
      'public.update_scoutnet_question_mapping(uuid,text,uuid,jsonb)',
      'public.disconnect_scoutnet_project(uuid,text,uuid)',
      'public.get_scoutnet_connection_credentials(uuid,uuid)'
    ]) as wrapper(function_name)
  ),
  'only service_role can execute every public Scoutnet wrapper'
);

select ok(
  not has_function_privilege(
    'service_role',
    'app_private.require_scoutnet_member(uuid,uuid)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'service_role',
      'app_private.require_scoutnet_admin(uuid,uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'app_private.scoutnet_connection_status_json(uuid)',
      'EXECUTE'
    ),
  'service_role cannot execute private helper functions directly'
);

select ok(
  (
    select table_entry.relrowsecurity and table_entry.relforcerowsecurity
    from pg_class as table_entry
    where table_entry.oid =
      'app_private.scoutnet_connections'::regclass
  ),
  'the private metadata table has RLS enabled and forced'
);

select is(
  public.get_scoutnet_connection_status(
    '11111111-1111-1111-1111-111111111111',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  ) ->> 'connected',
  'false',
  'an unconfigured camp has an explicit disconnected status'
);

select throws_ok(
  $$select public.connect_scoutnet_project(
    '44444444-4444-4444-4444-444444444444',
    'aal2',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '7701',
    'synthetic-participants-key',
    'synthetic-questions-key'
  )$$,
  '42501',
  'Active organization administrator required',
  'a planner cannot connect Scoutnet even when the Edge reports AAL2'
);

select throws_ok(
  $$select public.connect_scoutnet_project(
    '22222222-2222-2222-2222-222222222222',
    'aal2',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '7701',
    'synthetic-participants-key',
    'synthetic-questions-key'
  )$$,
  '42501',
  'Active organization administrator required',
  'an administrator from another organization cannot target this camp'
);

select throws_ok(
  $$select public.connect_scoutnet_project(
    '11111111-1111-1111-1111-111111111111',
    'aal1',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '7701',
    'synthetic-participants-key',
    'synthetic-questions-key'
  )$$,
  '42501',
  'AAL2 administrator session required',
  'an administrator cannot change secrets without AAL2'
);

select throws_ok(
  $$select public.connect_scoutnet_project(
    '11111111-1111-1111-1111-111111111111',
    'aal2',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '7701',
    'same-synthetic-endpoint-key',
    'same-synthetic-endpoint-key'
  )$$,
  '22023',
  'Separate Scoutnet endpoint keys are required',
  'participants and questions must have separate endpoint keys'
);

select is(
  public.connect_scoutnet_project(
    '11111111-1111-1111-1111-111111111111',
    'aal2',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '7701',
    'synthetic-participants-key',
    'synthetic-questions-key'
  ) ->> 'connected',
  'true',
  'an AAL2 organization administrator can connect both endpoint keys'
);

create temporary table test_scoutnet_secret_ids (
  participants_secret_id uuid primary key,
  questions_secret_id uuid unique not null
) on commit drop;

insert into test_scoutnet_secret_ids
select
  connection.participants_secret_id,
  connection.questions_secret_id
from app_private.scoutnet_connections as connection
where connection.camp_id =
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';

select is(
  (
    select count(*)::integer
    from app_private.scoutnet_connections
    where organization_id =
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and camp_id =
        'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  ),
  1,
  'the connection is bound to exactly one organization and camp'
);

select is(
  (
    select count(*)::integer
    from vault.secrets as secret
    join test_scoutnet_secret_ids as ids
      on secret.id in (
        ids.participants_secret_id,
        ids.questions_secret_id
      )
  ),
  2,
  'the two endpoint keys create two distinct Vault secrets'
);

select ok(
  (
    select bool_and(
      secret.secret not in (
        'synthetic-participants-key',
        'synthetic-questions-key'
      )
    )
    from vault.secrets as secret
    join test_scoutnet_secret_ids as ids
      on secret.id in (
        ids.participants_secret_id,
        ids.questions_secret_id
      )
  ),
  'Vault stores ciphertext rather than either readable endpoint key'
);

select is(
  (
    select
      participants_secret.decrypted_secret
      || '|'
      || questions_secret.decrypted_secret
    from test_scoutnet_secret_ids as ids
    join vault.decrypted_secrets as participants_secret
      on participants_secret.id = ids.participants_secret_id
    join vault.decrypted_secrets as questions_secret
      on questions_secret.id = ids.questions_secret_id
  ),
  'synthetic-participants-key|synthetic-questions-key',
  'the owner-only Vault view can recover each exact key independently'
);

select ok(
  (
    select row_to_json(connection)::text
      not like '%synthetic-participants-key%'
      and row_to_json(connection)::text
        not like '%synthetic-questions-key%'
    from app_private.scoutnet_connections as connection
    where connection.camp_id =
      'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  ),
  'private connection metadata itself contains no readable key'
);

select is(
  (
    select array_agg(key order by key)::text
    from jsonb_object_keys(
      public.get_scoutnet_connection_status(
        '11111111-1111-1111-1111-111111111111',
        'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      )
    ) as status_key(key)
  ),
  ARRAY[
    'campId',
    'connected',
    'connectedAt',
    'credentialsRotatedAt',
    'hasParticipantsApiKey',
    'hasQuestionsApiKey',
    'lastSuccessfulSyncAt',
    'lastSuccessfulSyncParticipantCount',
    'projectId',
    'questionMapping',
    'questionMappingUpdatedAt'
  ]::text,
  'status exposes only the bounded non-secret contract'
);

select is(
  (
    select credentials.participants_api_key
      || '|'
      || credentials.questions_api_key
    from public.get_scoutnet_connection_credentials(
      '44444444-4444-4444-4444-444444444444',
      'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    ) as credentials
  ),
  'synthetic-participants-key|synthetic-questions-key',
  'the service wrapper can mediate credentials for an active camp member'
);

select throws_ok(
  $$select *
  from public.get_scoutnet_connection_credentials(
    '22222222-2222-2222-2222-222222222222',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  )$$,
  '42501',
  'Active organization membership required',
  'the credential wrapper rejects an actor from another organization'
);

select throws_ok(
  $$select public.connect_scoutnet_project(
    '11111111-1111-1111-1111-111111111111',
    'aal2',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '7701',
    'another-participants-key',
    'another-questions-key'
  )$$,
  '23505',
  'Scoutnet connection already exists',
  'a second connect cannot silently overwrite the camp credentials'
);

select throws_ok(
  $$select public.update_scoutnet_question_mapping(
    '11111111-1111-1111-1111-111111111111',
    'aal2',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '{"special_diet_question_id":"free text"}'::jsonb
  )$$,
  '22023',
  'Scoutnet question mapping is invalid',
  'question mapping cannot persist free text in place of question IDs'
);

select is(
  public.update_scoutnet_question_mapping(
    '11111111-1111-1111-1111-111111111111',
    'aal2',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '{
      "division_question_id":"1001",
      "special_diet_question_id":"1201",
      "attendance_intervals":[{
        "starts_at_question_id":"1101",
        "ends_at_question_id":"1102"
      }]
    }'::jsonb
  ) #>> '{questionMapping,special_diet_question_id}',
  '1201',
  'an AAL2 administrator can persist a bounded question-ID mapping'
);

select is(
  (
    select event.payload::text
    from public.audit_events as event
    where event.event_type = 'scoutnet_question_mapping_updated'
      and event.entity_id =
        'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    order by event.id desc
    limit 1
  ),
  '{"mapping_field_count": 3}',
  'mapping audit stores only the number of configured fields'
);

select ok(
  (
    public.rotate_scoutnet_connection(
      '11111111-1111-1111-1111-111111111111',
      'aal2',
      'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      null,
      'synthetic-participants-rotated',
      null
    ) ->> 'credentialsRotatedAt'
  ) is not null,
  'an AAL2 administrator can rotate one endpoint key independently'
);

select is(
  (
    select secret.decrypted_secret
    from test_scoutnet_secret_ids as ids
    join vault.decrypted_secrets as secret
      on secret.id = ids.participants_secret_id
  ),
  'synthetic-participants-rotated',
  'participants key rotation replaces the participants Vault value'
);

select is(
  (
    select secret.decrypted_secret
    from test_scoutnet_secret_ids as ids
    join vault.decrypted_secrets as secret
      on secret.id = ids.questions_secret_id
  ),
  'synthetic-questions-key',
  'participants key rotation leaves the questions Vault value unchanged'
);

select is(
  (
    select event.payload::text
    from public.audit_events as event
    where event.event_type = 'scoutnet_connection_rotated'
      and event.entity_id =
        'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    order by event.id desc
    limit 1
  ),
  '{"credential_count": 1, "changed_field_count": 1}',
  'rotation audit records counts but no project or credential material'
);

select ok(
  not exists (
    select 1
    from public.audit_events as event
    cross join lateral jsonb_object_keys(event.payload) as payload_key(key)
    where event.event_type like 'scoutnet_%'
      and payload_key.key not in (
        'credential_count',
        'changed_field_count',
        'mapping_field_count'
      )
  )
    and not exists (
      select 1
      from public.audit_events as event
      where event.event_type like 'scoutnet_%'
        and event.payload::text ~
          '(synthetic-|7701|1001|1101|1102|1201)'
    ),
  'every Scoutnet audit payload is limited to action counts'
);

select is(
  public.disconnect_scoutnet_project(
    '11111111-1111-1111-1111-111111111111',
    'aal2',
    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  ) ->> 'connected',
  'false',
  'an AAL2 administrator can disconnect the camp'
);

select is(
  (
    select count(*)::integer
    from app_private.scoutnet_connections
    where camp_id =
      'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  ),
  0,
  'disconnect removes the private connection metadata'
);

select is(
  (
    select count(*)::integer
    from vault.secrets as secret
    join test_scoutnet_secret_ids as ids
      on secret.id in (
        ids.participants_secret_id,
        ids.questions_secret_id
      )
  ),
  0,
  'disconnect removes both Vault secrets'
);

select is(
  (
    select string_agg(
      event.event_type,
      '|' order by event.id
    )
    from public.audit_events as event
    where event.entity_id =
      'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and event.event_type like 'scoutnet_%'
  ),
  'scoutnet_connection_connected|scoutnet_question_mapping_updated|scoutnet_connection_rotated|scoutnet_connection_disconnected',
  'the audit trail contains only the four performed actions in order'
);

select lives_ok(
  $$select public.connect_scoutnet_project(
    '22222222-2222-2222-2222-222222222222',
    'aal2',
    'cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
    '8802',
    'cascade-participants-key',
    'cascade-questions-key'
  )$$,
  'a second tenant connection can be created for cascade cleanup proof'
);

create temporary table test_scoutnet_cascade_secret_ids (
  secret_id uuid primary key
) on commit drop;

insert into test_scoutnet_cascade_secret_ids
select connection.participants_secret_id
from app_private.scoutnet_connections as connection
where connection.camp_id =
  'cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'
union all
select connection.questions_secret_id
from app_private.scoutnet_connections as connection
where connection.camp_id =
  'cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';

delete from public.camps
where id = 'cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';

select is(
  (
    select
      (select count(*) from app_private.scoutnet_connections
       where camp_id =
         'cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2')::text
      || '|'
      || (select count(*)
          from vault.secrets as secret
          join test_scoutnet_cascade_secret_ids as ids
            on ids.secret_id = secret.id)::text
  ),
  '0|0',
  'camp deletion cascades through metadata and deletes both Vault secrets'
);

select * from finish();
rollback;
