alter table app_private.scoutnet_connections
  add column last_successful_sync_by uuid
    references auth.users(id) on delete restrict,
  add column last_successful_sync_at timestamptz,
  add column last_successful_sync_participant_count integer,
  add constraint scoutnet_connections_successful_sync_consistent check (
    (
      last_successful_sync_by is null
      and last_successful_sync_at is null
      and last_successful_sync_participant_count is null
    )
    or (
      last_successful_sync_by is not null
      and last_successful_sync_at is not null
      and last_successful_sync_participant_count between 1 and 5000
    )
  );

create index scoutnet_connections_last_successful_sync_by_idx
  on app_private.scoutnet_connections(last_successful_sync_by);

create function app_private.valid_scoutnet_reconciliation_decisions(
  p_decisions jsonb
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  decision jsonb;
begin
  if p_decisions is null
    or jsonb_typeof(p_decisions) <> 'array'
    or jsonb_array_length(p_decisions) not between 1 and 5000
    or pg_column_size(p_decisions) > 2000000 then
    return false;
  end if;

  for decision in
    select value from jsonb_array_elements(p_decisions)
  loop
    if jsonb_typeof(decision) <> 'object'
      or coalesce(decision ->> 'sourceReference', '')
        !~ '^scoutnet:v1:[A-Za-z0-9_-]{43}$'
      or coalesce(decision ->> 'action', '')
        not in ('apply', 'link', 'skip')
      or (
        decision ->> 'action' = 'link'
        and (
          decision - array[
            'sourceReference',
            'action',
            'participantId'
          ] <> '{}'::jsonb
          or coalesce(decision ->> 'participantId', '')
            !~ '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
        )
      )
      or (
        decision ->> 'action' <> 'link'
        and decision - array['sourceReference', 'action'] <> '{}'::jsonb
      ) then
      return false;
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_decisions) as source_row(value)
    group by source_row.value ->> 'sourceReference'
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(p_decisions) as source_row(value)
    where source_row.value ->> 'action' = 'link'
    group by source_row.value ->> 'participantId'
    having count(*) > 1
  ) then
    return false;
  end if;

  return true;
exception
  when others then return false;
end;
$$;

create function app_private.scoutnet_reconciliation_decision_digest(
  p_decisions jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(coalesce((
    select jsonb_agg(source_row.value order by
      source_row.value ->> 'sourceReference')
    from jsonb_array_elements(p_decisions) as source_row(value)
  ), '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
$$;

create function public.apply_scoutnet_reconciliation(
  p_actor_user_id uuid,
  p_camp_id uuid,
  p_snapshot jsonb,
  p_decisions jsonb,
  p_expected_state_digest text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  current_state_digest text;
  snapshot_digest text;
  decision_digest text;
  previous_application app_private.scoutnet_reconciliation_applications%rowtype;
  snapshot_row jsonb;
  decision_row jsonb;
  target_participant_id uuid;
  target_division_id uuid;
  target_patrol_id uuid;
  previous_lifecycle public.participant_lifecycle_status;
  attendance_changed boolean;
  diet_changed boolean;
  participant_changed boolean;
  participant_was_new boolean;
  affected_rows integer;
  created_count integer := 0;
  linked_count integer := 0;
  updated_count integer := 0;
  reactivated_count integer := 0;
  withdrawn_count integer := 0;
  skipped_count integer := 0;
  applied_at timestamptz := clock_timestamp();
  result_value jsonb;
begin
  target_organization_id := app_private.require_scoutnet_admin(
    p_actor_user_id,
    p_camp_id
  );

  if p_idempotency_key is null
    or coalesce(p_expected_state_digest, '') !~ '^[0-9a-f]{64}$'
    or not app_private.valid_scoutnet_reconciliation_snapshot(p_snapshot)
    or not app_private.valid_scoutnet_reconciliation_decisions(p_decisions)
  then
    raise exception 'Scoutnet reconciliation input is invalid'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from app_private.scoutnet_connections as connection
    where connection.organization_id = target_organization_id
      and connection.camp_id = p_camp_id
  ) then
    raise exception 'Scoutnet connection not found'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':' || p_camp_id::text,
    0
  ));

  snapshot_digest := encode(extensions.digest(convert_to(
    p_snapshot::text,
    'UTF8'
  ), 'sha256'), 'hex');
  decision_digest :=
    app_private.scoutnet_reconciliation_decision_digest(p_decisions);

  select application.*
  into previous_application
  from app_private.scoutnet_reconciliation_applications as application
  where application.organization_id = target_organization_id
    and application.camp_id = p_camp_id
    and application.idempotency_key = p_idempotency_key;

  if found then
    if previous_application.actor_user_id = p_actor_user_id
      and previous_application.snapshot_digest = snapshot_digest
      and previous_application.decision_digest = decision_digest
    then
      return previous_application.result;
    end if;
    raise exception 'Scoutnet reconciliation idempotency key conflict'
      using errcode = '23505';
  end if;

  current_state_digest :=
    app_private.scoutnet_reconciliation_state_digest(
      target_organization_id,
      p_camp_id
    );
  if current_state_digest <> p_expected_state_digest then
    raise exception 'Scoutnet reconciliation state is stale'
      using errcode = '40001';
  end if;

  if exists (
    (
      select snapshot_entry.value ->> 'sourceReference'
      from jsonb_array_elements(
        p_snapshot -> 'participants'
      ) as snapshot_entry(value)
      union
      select participant.scoutnet_source_reference
      from public.participants as participant
      where participant.organization_id = target_organization_id
        and participant.camp_id = p_camp_id
        and participant.lifecycle_status = 'active'
        and participant.scoutnet_source_reference is not null
        and not exists (
          select 1
          from jsonb_array_elements(
            p_snapshot -> 'participants'
          ) as incoming(value)
          where incoming.value ->> 'sourceReference' =
            participant.scoutnet_source_reference
        )
    )
    except
    select decision.value ->> 'sourceReference'
    from jsonb_array_elements(p_decisions) as decision(value)
  ) or exists (
    select decision.value ->> 'sourceReference'
    from jsonb_array_elements(p_decisions) as decision(value)
    except
    (
      select snapshot_entry.value ->> 'sourceReference'
      from jsonb_array_elements(
        p_snapshot -> 'participants'
      ) as snapshot_entry(value)
      union
      select participant.scoutnet_source_reference
      from public.participants as participant
      where participant.organization_id = target_organization_id
        and participant.camp_id = p_camp_id
        and participant.lifecycle_status = 'active'
        and participant.scoutnet_source_reference is not null
        and not exists (
          select 1
          from jsonb_array_elements(
            p_snapshot -> 'participants'
          ) as incoming(value)
          where incoming.value ->> 'sourceReference' =
            participant.scoutnet_source_reference
        )
    )
  ) then
    raise exception 'Scoutnet reconciliation decisions are incomplete'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_decisions) as decision(value)
    left join lateral (
      select incoming.value
      from jsonb_array_elements(
        p_snapshot -> 'participants'
      ) as incoming(value)
      where incoming.value ->> 'sourceReference' =
        decision.value ->> 'sourceReference'
    ) as incoming on true
    left join public.participants as exact_participant
      on exact_participant.organization_id = target_organization_id
     and exact_participant.camp_id = p_camp_id
     and exact_participant.scoutnet_source_reference =
       decision.value ->> 'sourceReference'
    left join public.participants as link_target
      on link_target.organization_id = target_organization_id
     and link_target.camp_id = p_camp_id
     and link_target.id =
       nullif(decision.value ->> 'participantId', '')::uuid
    where decision.value ->> 'action' = 'link'
      and (
        incoming.value is null
        or incoming.value ->> 'registrationStatus' = 'cancelled'
        or exact_participant.id is not null
        or link_target.id is null
        or link_target.scoutnet_source_reference is not null
      )
  ) then
    raise exception 'Scoutnet reconciliation link target is invalid'
      using errcode = '22023';
  end if;

  for snapshot_row in
    select incoming.value
    from jsonb_array_elements(
      p_snapshot -> 'participants'
    ) as incoming(value)
    order by incoming.value ->> 'sourceReference'
  loop
    select decision.value
    into decision_row
    from jsonb_array_elements(p_decisions) as decision(value)
    where decision.value ->> 'sourceReference' =
      snapshot_row ->> 'sourceReference';

    if decision_row ->> 'action' = 'skip' then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    select participant.id, participant.lifecycle_status
    into target_participant_id, previous_lifecycle
    from public.participants as participant
    where participant.organization_id = target_organization_id
      and participant.camp_id = p_camp_id
      and participant.scoutnet_source_reference =
        snapshot_row ->> 'sourceReference';

    participant_was_new := false;
    participant_changed := false;

    if decision_row ->> 'action' = 'link' then
      target_participant_id :=
        (decision_row ->> 'participantId')::uuid;
      select participant.lifecycle_status
      into previous_lifecycle
      from public.participants as participant
      where participant.organization_id = target_organization_id
        and participant.camp_id = p_camp_id
        and participant.id = target_participant_id
      for update;

      update public.participants
      set
        pre_scoutnet_display_name = coalesce(
          pre_scoutnet_display_name,
          display_name
        ),
        pre_scoutnet_division_id = coalesce(
          pre_scoutnet_division_id,
          division_id
        ),
        pre_scoutnet_patrol_id = coalesce(
          pre_scoutnet_patrol_id,
          patrol_id
        ),
        scoutnet_source_reference =
          snapshot_row ->> 'sourceReference',
        scoutnet_synced_at = applied_at
      where organization_id = target_organization_id
        and camp_id = p_camp_id
        and id = target_participant_id;
      participant_changed := true;
      linked_count := linked_count + 1;
    end if;

    if target_participant_id is null
      and snapshot_row ->> 'registrationStatus' = 'cancelled'
    then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    target_division_id := app_private.upsert_scoutnet_group(
      target_organization_id,
      p_camp_id,
      'division',
      snapshot_row -> 'division',
      null
    );
    target_patrol_id := app_private.upsert_scoutnet_group(
      target_organization_id,
      p_camp_id,
      'patrol',
      snapshot_row -> 'patrol',
      target_division_id
    );

    if target_participant_id is null then
      insert into public.participants (
        organization_id,
        camp_id,
        display_name,
        division_id,
        patrol_id,
        scoutnet_source_reference,
        scoutnet_registration_status,
        scoutnet_synced_at,
        lifecycle_status,
        withdrawn_at
      ) values (
        target_organization_id,
        p_camp_id,
        trim(snapshot_row ->> 'displayName'),
        target_division_id,
        target_patrol_id,
        snapshot_row ->> 'sourceReference',
        (snapshot_row ->> 'registrationStatus')
          ::public.scoutnet_registration_status,
        applied_at,
        'active',
        null
      )
      returning id into target_participant_id;
      participant_was_new := true;
      participant_changed := true;
      previous_lifecycle := null;
      created_count := created_count + 1;
    else
      update public.participants
      set
        display_name = trim(snapshot_row ->> 'displayName'),
        division_id = target_division_id,
        patrol_id = target_patrol_id,
        scoutnet_registration_status =
          (snapshot_row ->> 'registrationStatus')
            ::public.scoutnet_registration_status,
        scoutnet_synced_at = applied_at,
        lifecycle_status = case
          when snapshot_row ->> 'registrationStatus' = 'cancelled'
            then 'withdrawn'::public.participant_lifecycle_status
          else 'active'::public.participant_lifecycle_status
        end,
        withdrawn_at = case
          when snapshot_row ->> 'registrationStatus' = 'cancelled'
            then coalesce(withdrawn_at, applied_at)
          else null
        end
      where organization_id = target_organization_id
        and camp_id = p_camp_id
        and id = target_participant_id
        and (
          display_name,
          division_id,
          patrol_id,
          scoutnet_registration_status,
          lifecycle_status,
          withdrawn_at is null
        ) is distinct from (
          trim(snapshot_row ->> 'displayName'),
          target_division_id,
          target_patrol_id,
          (snapshot_row ->> 'registrationStatus')
            ::public.scoutnet_registration_status,
          case
            when snapshot_row ->> 'registrationStatus' = 'cancelled'
              then 'withdrawn'::public.participant_lifecycle_status
            else 'active'::public.participant_lifecycle_status
          end,
          snapshot_row ->> 'registrationStatus' <> 'cancelled'
        );
      get diagnostics affected_rows = row_count;
      participant_changed := participant_changed or affected_rows > 0;
    end if;

    select not (
      not exists (
        select attendance.starts_at, attendance.ends_at
        from public.participant_attendance as attendance
        where attendance.organization_id = target_organization_id
          and attendance.camp_id = p_camp_id
          and attendance.participant_id = target_participant_id
          and attendance.active
        except
        select
          (incoming.value ->> 'startsAt')::timestamptz,
          (incoming.value ->> 'endsAt')::timestamptz
        from jsonb_array_elements(
          snapshot_row -> 'attendance'
        ) as incoming(value)
      )
      and not exists (
        select
          (incoming.value ->> 'startsAt')::timestamptz,
          (incoming.value ->> 'endsAt')::timestamptz
        from jsonb_array_elements(
          snapshot_row -> 'attendance'
        ) as incoming(value)
        except
        select attendance.starts_at, attendance.ends_at
        from public.participant_attendance as attendance
        where attendance.organization_id = target_organization_id
          and attendance.camp_id = p_camp_id
          and attendance.participant_id = target_participant_id
          and attendance.active
      )
    ) into attendance_changed;

    if attendance_changed then
      update public.participant_attendance
      set
        active = false,
        superseded_at = applied_at
      where organization_id = target_organization_id
        and camp_id = p_camp_id
        and participant_id = target_participant_id
        and active;

      insert into public.participant_attendance (
        organization_id,
        camp_id,
        participant_id,
        starts_at,
        ends_at,
        source,
        active,
        superseded_at
      )
      select
        target_organization_id,
        p_camp_id,
        target_participant_id,
        (incoming.value ->> 'startsAt')::timestamptz,
        (incoming.value ->> 'endsAt')::timestamptz,
        'scoutnet',
        true,
        null
      from jsonb_array_elements(
        snapshot_row -> 'attendance'
      ) as incoming(value)
      order by
        (incoming.value ->> 'startsAt')::timestamptz,
        (incoming.value ->> 'endsAt')::timestamptz;
    end if;

    diet_changed := app_private.apply_scoutnet_dietary_note(
      target_organization_id,
      p_camp_id,
      target_participant_id,
      snapshot_row -> 'specialDiet'
    );

    if previous_lifecycle = 'withdrawn'
      and snapshot_row ->> 'registrationStatus' <> 'cancelled'
    then
      reactivated_count := reactivated_count + 1;
    elsif previous_lifecycle = 'active'
      and snapshot_row ->> 'registrationStatus' = 'cancelled'
    then
      withdrawn_count := withdrawn_count + 1;
    end if;

    if not participant_was_new
      and (
        participant_changed
        or attendance_changed
        or diet_changed
      )
    then
      updated_count := updated_count + 1;
    end if;
  end loop;

  for decision_row in
    select decision.value
    from jsonb_array_elements(p_decisions) as decision(value)
    where decision.value ->> 'action' in ('apply', 'skip')
      and not exists (
        select 1
        from jsonb_array_elements(
          p_snapshot -> 'participants'
        ) as incoming(value)
        where incoming.value ->> 'sourceReference' =
          decision.value ->> 'sourceReference'
      )
    order by decision.value ->> 'sourceReference'
  loop
    if decision_row ->> 'action' = 'skip' then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    update public.participants
    set
      lifecycle_status = 'withdrawn',
      withdrawn_at = coalesce(withdrawn_at, applied_at),
      scoutnet_synced_at = applied_at
    where organization_id = target_organization_id
      and camp_id = p_camp_id
      and scoutnet_source_reference =
        decision_row ->> 'sourceReference'
      and lifecycle_status = 'active';
    get diagnostics affected_rows = row_count;
    if affected_rows = 1 then
      withdrawn_count := withdrawn_count + 1;
      updated_count := updated_count + 1;
    end if;
  end loop;

  update app_private.scoutnet_connections
  set
    last_successful_sync_by = p_actor_user_id,
    last_successful_sync_at = applied_at,
    last_successful_sync_participant_count =
      (p_snapshot ->> 'participantCount')::integer,
    updated_at = applied_at
  where organization_id = target_organization_id
    and camp_id = p_camp_id;

  current_state_digest :=
    app_private.scoutnet_reconciliation_state_digest(
      target_organization_id,
      p_camp_id
    );
  result_value := jsonb_build_object(
    'campId', p_camp_id,
    'stateDigest', current_state_digest,
    'appliedAt', applied_at,
    'snapshotParticipantCount',
      (p_snapshot ->> 'participantCount')::integer,
    'counts', jsonb_build_object(
      'created', created_count,
      'linked', linked_count,
      'updated', updated_count,
      'reactivated', reactivated_count,
      'withdrawn', withdrawn_count,
      'skipped', skipped_count
    )
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
    'scoutnet_reconciliation_applied',
    'camp',
    p_camp_id::text,
    jsonb_build_object(
      'snapshot_participant_count',
        (p_snapshot ->> 'participantCount')::integer,
      'created_count', created_count,
      'linked_count', linked_count,
      'updated_count', updated_count,
      'reactivated_count', reactivated_count,
      'withdrawn_count', withdrawn_count,
      'skipped_count', skipped_count
    )
  );

  insert into app_private.scoutnet_reconciliation_applications (
    organization_id,
    camp_id,
    actor_user_id,
    idempotency_key,
    snapshot_digest,
    decision_digest,
    result
  ) values (
    target_organization_id,
    p_camp_id,
    p_actor_user_id,
    p_idempotency_key,
    snapshot_digest,
    decision_digest,
    result_value
  );

  return result_value;
end;
$$;

revoke all on function app_private.valid_scoutnet_reconciliation_decisions(
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function app_private.scoutnet_reconciliation_decision_digest(
  jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.apply_scoutnet_reconciliation(
  uuid, uuid, jsonb, jsonb, text, uuid
) from public, anon, authenticated;
grant execute on function public.apply_scoutnet_reconciliation(
  uuid, uuid, jsonb, jsonb, text, uuid
) to service_role;

comment on function public.apply_scoutnet_reconciliation(
  uuid, uuid, jsonb, jsonb, text, uuid
) is
  'Service-only, atomic and idempotent application of an admin-reviewed Scoutnet snapshot.';
