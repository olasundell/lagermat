-- Private, camp-bound Scoutnet credentials and service-mediated access.
--
-- The browser never receives Vault identifiers or decrypted secrets. All
-- public-schema entry points below are executable by service_role only and are
-- called from the JWT/origin-protected Edge Function. The Edge Function passes
-- the verified Auth user and assurance level; the database independently
-- rechecks active organization membership and the administrator role.

create extension if not exists supabase_vault with schema vault;

create function app_private.valid_scoutnet_question_mapping(mapping jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    mapping is not null
    and jsonb_typeof(mapping) = 'object'
    and octet_length(mapping::text) <= 16384
    and not exists (
      select 1
      from jsonb_object_keys(mapping) as entry(key)
      where entry.key not in (
        'group_question_id',
        'division_question_id',
        'patrol_question_id',
        'special_diet_question_id',
        'attendance_intervals'
      )
    )
    and not exists (
      select 1
      from jsonb_each(mapping) as entry(key, value)
      where entry.key <> 'attendance_intervals'
        and (
          jsonb_typeof(entry.value) <> 'string'
          or trim(both '"' from entry.value::text) !~ '^[0-9]{1,20}$'
        )
    )
    and (
      not (mapping ? 'attendance_intervals')
      or (
        jsonb_typeof(mapping -> 'attendance_intervals') = 'array'
        and jsonb_array_length(mapping -> 'attendance_intervals') <= 8
        and not exists (
          select 1
          from jsonb_array_elements(
            mapping -> 'attendance_intervals'
          ) as interval_entry(value)
          where jsonb_typeof(interval_entry.value) <> 'object'
            or (
              select count(*)
              from jsonb_object_keys(interval_entry.value)
            ) <> 2
            or not (
              interval_entry.value ? 'starts_at_question_id'
              and interval_entry.value ? 'ends_at_question_id'
            )
            or jsonb_typeof(
              interval_entry.value -> 'starts_at_question_id'
            ) <> 'string'
            or jsonb_typeof(
              interval_entry.value -> 'ends_at_question_id'
            ) <> 'string'
            or trim(
              both '"' from (
                interval_entry.value -> 'starts_at_question_id'
              )::text
            ) !~ '^[0-9]{1,20}$'
            or trim(
              both '"' from (
                interval_entry.value -> 'ends_at_question_id'
              )::text
            ) !~ '^[0-9]{1,20}$'
        )
      )
    );
$$;

create table app_private.scoutnet_connections (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  project_id text not null
    check (project_id ~ '^[0-9]{1,32}$'),
  participants_secret_id uuid not null unique
    references vault.secrets(id) on delete restrict,
  questions_secret_id uuid not null unique
    references vault.secrets(id) on delete restrict,
  question_mapping jsonb not null default '{}'::jsonb
    check (app_private.valid_scoutnet_question_mapping(question_mapping)),
  connected_by uuid not null references auth.users(id) on delete restrict,
  connected_at timestamptz not null default clock_timestamp(),
  credentials_rotated_by uuid references auth.users(id) on delete restrict,
  credentials_rotated_at timestamptz,
  question_mapping_updated_by uuid references auth.users(id) on delete restrict,
  question_mapping_updated_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, camp_id),
  unique (camp_id),
  constraint scoutnet_connections_camp_fk
    foreign key (organization_id, camp_id)
    references public.camps(organization_id, id) on delete cascade,
  constraint scoutnet_connections_distinct_secrets_check
    check (participants_secret_id <> questions_secret_id),
  constraint scoutnet_connections_rotation_pair_check
    check (
      (credentials_rotated_by is null)
      = (credentials_rotated_at is null)
    ),
  constraint scoutnet_connections_mapping_update_pair_check
    check (
      (question_mapping_updated_by is null)
      = (question_mapping_updated_at is null)
    )
);

create index scoutnet_connections_connected_by_idx
  on app_private.scoutnet_connections(connected_by);
create index scoutnet_connections_credentials_rotated_by_idx
  on app_private.scoutnet_connections(credentials_rotated_by);
create index scoutnet_connections_question_mapping_updated_by_idx
  on app_private.scoutnet_connections(question_mapping_updated_by);

alter table app_private.scoutnet_connections enable row level security;
alter table app_private.scoutnet_connections force row level security;

create policy scoutnet_connections_browser_deny
  on app_private.scoutnet_connections
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create function app_private.delete_scoutnet_vault_secrets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets
  where id in (
    old.participants_secret_id,
    old.questions_secret_id
  );
  return old;
end;
$$;

create trigger scoutnet_connections_delete_vault_secrets
after delete on app_private.scoutnet_connections
for each row
execute function app_private.delete_scoutnet_vault_secrets();

create function app_private.require_scoutnet_member(
  p_actor_user_id uuid,
  p_camp_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
begin
  select camp.organization_id
  into target_organization_id
  from public.camps as camp
  join public.organization_memberships as membership
    on membership.organization_id = camp.organization_id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active'
  where camp.id = p_camp_id;

  if not found then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  return target_organization_id;
end;
$$;

create function app_private.require_scoutnet_admin(
  p_actor_user_id uuid,
  p_camp_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
begin
  select camp.organization_id
  into target_organization_id
  from public.camps as camp
  join public.organization_memberships as membership
    on membership.organization_id = camp.organization_id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and membership.role = 'admin'
  where camp.id = p_camp_id;

  if not found then
    raise exception 'Active organization administrator required'
      using errcode = '42501';
  end if;

  return target_organization_id;
end;
$$;

create function app_private.require_scoutnet_aal2(p_actor_aal text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_actor_aal is distinct from 'aal2' then
    raise exception 'AAL2 administrator session required'
      using errcode = '42501';
  end if;
end;
$$;

create function app_private.valid_scoutnet_api_key(api_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select api_key is not null
    and octet_length(api_key) between 8 and 4096
    and api_key = btrim(api_key)
    and api_key !~ '[[:cntrl:]]'
    and api_key ~ '^[\x21-\x7e]+$';
$$;

create function app_private.scoutnet_connection_status_json(
  p_camp_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'campId', connection.camp_id,
        'connected', true,
        'projectId', connection.project_id,
        'hasParticipantsApiKey', true,
        'hasQuestionsApiKey', true,
        'questionMapping', connection.question_mapping,
        'connectedAt', connection.connected_at,
        'credentialsRotatedAt', connection.credentials_rotated_at,
        'questionMappingUpdatedAt',
          connection.question_mapping_updated_at
      )
      from app_private.scoutnet_connections as connection
      where connection.camp_id = p_camp_id
    ),
    jsonb_build_object(
      'campId', p_camp_id,
      'connected', false,
      'projectId', null,
      'hasParticipantsApiKey', false,
      'hasQuestionsApiKey', false,
      'questionMapping', '{}'::jsonb,
      'connectedAt', null,
      'credentialsRotatedAt', null,
      'questionMappingUpdatedAt', null
    )
  );
$$;

create function public.get_scoutnet_connection_status(
  p_actor_user_id uuid,
  p_camp_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_scoutnet_admin(
    p_actor_user_id,
    p_camp_id
  );
  return app_private.scoutnet_connection_status_json(p_camp_id);
end;
$$;

create function public.connect_scoutnet_project(
  p_actor_user_id uuid,
  p_actor_aal text,
  p_camp_id uuid,
  p_project_id text,
  p_participants_api_key text,
  p_questions_api_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  connection_id uuid := extensions.gen_random_uuid();
  participants_secret_id uuid;
  questions_secret_id uuid;
begin
  perform app_private.require_scoutnet_aal2(p_actor_aal);
  target_organization_id := app_private.require_scoutnet_admin(
    p_actor_user_id,
    p_camp_id
  );

  if p_project_id is null
    or p_project_id !~ '^[0-9]{1,32}$' then
    raise exception 'Scoutnet project ID is invalid'
      using errcode = '22023';
  end if;
  if not app_private.valid_scoutnet_api_key(p_participants_api_key)
    or not app_private.valid_scoutnet_api_key(p_questions_api_key) then
    raise exception 'Scoutnet endpoint key is invalid'
      using errcode = '22023';
  end if;
  if p_participants_api_key = p_questions_api_key then
    raise exception 'Separate Scoutnet endpoint keys are required'
      using errcode = '22023';
  end if;

  perform 1
  from app_private.scoutnet_connections as connection
  where connection.camp_id = p_camp_id
  for update;
  if found then
    raise exception 'Scoutnet connection already exists'
      using errcode = '23505';
  end if;

  participants_secret_id := vault.create_secret(
    p_participants_api_key,
    'scoutmat-scoutnet-participants-' || connection_id::text,
    'Lägermat Scoutnet participants endpoint key'
  );
  questions_secret_id := vault.create_secret(
    p_questions_api_key,
    'scoutmat-scoutnet-questions-' || connection_id::text,
    'Lägermat Scoutnet questions endpoint key'
  );

  insert into app_private.scoutnet_connections (
    id,
    organization_id,
    camp_id,
    project_id,
    participants_secret_id,
    questions_secret_id,
    connected_by
  ) values (
    connection_id,
    target_organization_id,
    p_camp_id,
    p_project_id,
    participants_secret_id,
    questions_secret_id,
    p_actor_user_id
  );

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    target_organization_id,
    p_actor_user_id,
    'scoutnet_connection_connected',
    'camp',
    p_camp_id::text,
    jsonb_build_object('credential_count', 2)
  );

  return app_private.scoutnet_connection_status_json(p_camp_id);
end;
$$;

create function public.rotate_scoutnet_connection(
  p_actor_user_id uuid,
  p_actor_aal text,
  p_camp_id uuid,
  p_project_id text default null,
  p_participants_api_key text default null,
  p_questions_api_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  connection app_private.scoutnet_connections%rowtype;
  credential_count integer :=
    (p_participants_api_key is not null)::integer
    + (p_questions_api_key is not null)::integer;
  changed_field_count integer :=
    (p_project_id is not null)::integer
    + (p_participants_api_key is not null)::integer
    + (p_questions_api_key is not null)::integer;
begin
  perform app_private.require_scoutnet_aal2(p_actor_aal);
  target_organization_id := app_private.require_scoutnet_admin(
    p_actor_user_id,
    p_camp_id
  );

  if changed_field_count = 0 then
    raise exception 'At least one Scoutnet connection field must change'
      using errcode = '22023';
  end if;
  if p_project_id is not null
    and p_project_id !~ '^[0-9]{1,32}$' then
    raise exception 'Scoutnet project ID is invalid'
      using errcode = '22023';
  end if;
  if p_participants_api_key is not null
    and not app_private.valid_scoutnet_api_key(
      p_participants_api_key
    ) then
    raise exception 'Scoutnet participants endpoint key is invalid'
      using errcode = '22023';
  end if;
  if p_questions_api_key is not null
    and not app_private.valid_scoutnet_api_key(
      p_questions_api_key
    ) then
    raise exception 'Scoutnet questions endpoint key is invalid'
      using errcode = '22023';
  end if;

  select candidate.*
  into connection
  from app_private.scoutnet_connections as candidate
  where candidate.camp_id = p_camp_id
    and candidate.organization_id = target_organization_id
  for update;

  if not found then
    raise exception 'Scoutnet connection not found'
      using errcode = '22023';
  end if;

  if p_participants_api_key is not null
    and p_questions_api_key is not null
    and p_participants_api_key = p_questions_api_key then
    raise exception 'Separate Scoutnet endpoint keys are required'
      using errcode = '22023';
  end if;
  if p_participants_api_key is not null
    and p_questions_api_key is null
    and exists (
      select 1
      from vault.decrypted_secrets as secret
      where secret.id = connection.questions_secret_id
        and secret.decrypted_secret = p_participants_api_key
    ) then
    raise exception 'Separate Scoutnet endpoint keys are required'
      using errcode = '22023';
  end if;
  if p_questions_api_key is not null
    and p_participants_api_key is null
    and exists (
      select 1
      from vault.decrypted_secrets as secret
      where secret.id = connection.participants_secret_id
        and secret.decrypted_secret = p_questions_api_key
    ) then
    raise exception 'Separate Scoutnet endpoint keys are required'
      using errcode = '22023';
  end if;

  if p_participants_api_key is not null then
    perform vault.update_secret(
      connection.participants_secret_id,
      p_participants_api_key
    );
  end if;
  if p_questions_api_key is not null then
    perform vault.update_secret(
      connection.questions_secret_id,
      p_questions_api_key
    );
  end if;

  update app_private.scoutnet_connections
  set project_id = coalesce(p_project_id, project_id),
      credentials_rotated_by = case
        when credential_count > 0 then p_actor_user_id
        else credentials_rotated_by
      end,
      credentials_rotated_at = case
        when credential_count > 0 then clock_timestamp()
        else credentials_rotated_at
      end,
      updated_at = clock_timestamp()
  where id = connection.id;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    target_organization_id,
    p_actor_user_id,
    'scoutnet_connection_rotated',
    'camp',
    p_camp_id::text,
    jsonb_build_object(
      'credential_count', credential_count,
      'changed_field_count', changed_field_count
    )
  );

  return app_private.scoutnet_connection_status_json(p_camp_id);
end;
$$;

create function public.update_scoutnet_question_mapping(
  p_actor_user_id uuid,
  p_actor_aal text,
  p_camp_id uuid,
  p_question_mapping jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  mapping_field_count integer;
begin
  perform app_private.require_scoutnet_aal2(p_actor_aal);
  target_organization_id := app_private.require_scoutnet_admin(
    p_actor_user_id,
    p_camp_id
  );

  if not app_private.valid_scoutnet_question_mapping(
    p_question_mapping
  ) then
    raise exception 'Scoutnet question mapping is invalid'
      using errcode = '22023';
  end if;

  update app_private.scoutnet_connections
  set question_mapping = p_question_mapping,
      question_mapping_updated_by = p_actor_user_id,
      question_mapping_updated_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where organization_id = target_organization_id
    and camp_id = p_camp_id;

  if not found then
    raise exception 'Scoutnet connection not found'
      using errcode = '22023';
  end if;

  mapping_field_count := (
    select count(*)::integer
    from jsonb_object_keys(p_question_mapping)
  );

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    target_organization_id,
    p_actor_user_id,
    'scoutnet_question_mapping_updated',
    'camp',
    p_camp_id::text,
    jsonb_build_object('mapping_field_count', mapping_field_count)
  );

  return app_private.scoutnet_connection_status_json(p_camp_id);
end;
$$;

create function public.disconnect_scoutnet_project(
  p_actor_user_id uuid,
  p_actor_aal text,
  p_camp_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  connection app_private.scoutnet_connections%rowtype;
begin
  perform app_private.require_scoutnet_aal2(p_actor_aal);
  target_organization_id := app_private.require_scoutnet_admin(
    p_actor_user_id,
    p_camp_id
  );

  select candidate.*
  into connection
  from app_private.scoutnet_connections as candidate
  where candidate.organization_id = target_organization_id
    and candidate.camp_id = p_camp_id
  for update;

  if not found then
    raise exception 'Scoutnet connection not found'
      using errcode = '22023';
  end if;

  delete from app_private.scoutnet_connections
  where id = connection.id;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    target_organization_id,
    p_actor_user_id,
    'scoutnet_connection_disconnected',
    'camp',
    p_camp_id::text,
    jsonb_build_object('credential_count', 2)
  );

  return app_private.scoutnet_connection_status_json(p_camp_id);
end;
$$;

create function public.get_scoutnet_connection_credentials(
  p_actor_user_id uuid,
  p_camp_id uuid
)
returns table (
  connection_id uuid,
  organization_id uuid,
  camp_id uuid,
  project_id text,
  participants_api_key text,
  questions_api_key text,
  question_mapping jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
begin
  target_organization_id := app_private.require_scoutnet_member(
    p_actor_user_id,
    p_camp_id
  );

  return query
  select
    connection.id,
    connection.organization_id,
    connection.camp_id,
    connection.project_id,
    participants_secret.decrypted_secret,
    questions_secret.decrypted_secret,
    connection.question_mapping
  from app_private.scoutnet_connections as connection
  join vault.decrypted_secrets as participants_secret
    on participants_secret.id = connection.participants_secret_id
  join vault.decrypted_secrets as questions_secret
    on questions_secret.id = connection.questions_secret_id
  where connection.organization_id = target_organization_id
    and connection.camp_id = p_camp_id;

  if not found then
    raise exception 'Scoutnet connection credentials not found'
      using errcode = '22023';
  end if;
end;
$$;

-- Supabase Vault deliberately grants its platform service_role direct access
-- and restores those extension-owned grants when the local stack restarts.
-- Treat that role as the server trust boundary: no service key reaches the
-- browser, browser roles are explicitly denied below, private application
-- metadata remains inaccessible even to service_role, and application code
-- uses only the camp-scoped wrappers above.
revoke all on schema vault
  from public, anon, authenticated;
revoke all on all tables in schema vault
  from public, anon, authenticated;
revoke all on function vault.create_secret(text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function vault.update_secret(uuid, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function vault._crypto_aead_det_decrypt(
  bytea, bytea, bigint, bytea, bytea
)
  from public, anon, authenticated;

revoke all on schema app_private
  from public, anon, authenticated, service_role;
revoke all on table app_private.scoutnet_connections
  from public, anon, authenticated, service_role;

revoke all on function app_private.valid_scoutnet_question_mapping(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_private.delete_scoutnet_vault_secrets()
  from public, anon, authenticated, service_role;
revoke all on function app_private.require_scoutnet_member(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.require_scoutnet_admin(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.require_scoutnet_aal2(text)
  from public, anon, authenticated, service_role;
revoke all on function app_private.valid_scoutnet_api_key(text)
  from public, anon, authenticated, service_role;
revoke all on function app_private.scoutnet_connection_status_json(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.get_scoutnet_connection_status(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.connect_scoutnet_project(
  uuid, text, uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.rotate_scoutnet_connection(
  uuid, text, uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.update_scoutnet_question_mapping(
  uuid, text, uuid, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.disconnect_scoutnet_project(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_scoutnet_connection_credentials(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_scoutnet_connection_status(uuid, uuid)
  to service_role;
grant execute on function public.connect_scoutnet_project(
  uuid, text, uuid, text, text, text
) to service_role;
grant execute on function public.rotate_scoutnet_connection(
  uuid, text, uuid, text, text, text
) to service_role;
grant execute on function public.update_scoutnet_question_mapping(
  uuid, text, uuid, jsonb
) to service_role;
grant execute on function public.disconnect_scoutnet_project(uuid, text, uuid)
  to service_role;
grant execute on function public.get_scoutnet_connection_credentials(uuid, uuid)
  to service_role;
