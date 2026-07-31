create or replace function app_private.scoutnet_connection_status_json(
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
          connection.question_mapping_updated_at,
        'lastSuccessfulSyncAt',
          connection.last_successful_sync_at,
        'lastSuccessfulSyncParticipantCount',
          connection.last_successful_sync_participant_count
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
      'questionMappingUpdatedAt', null,
      'lastSuccessfulSyncAt', null,
      'lastSuccessfulSyncParticipantCount', null
    )
  );
$$;
