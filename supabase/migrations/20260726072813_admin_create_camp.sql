create function public.create_camp(
  p_organization_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  new_camp_id uuid;
begin
  if actor_user_id is null
    or not public.is_org_admin(p_organization_id) then
    raise exception 'Organization administrator required'
      using errcode = '42501';
  end if;

  if length(trim(coalesce(p_name, ''))) not between 2 and 160
    or p_starts_on is null
    or p_ends_on is null
    or p_ends_on < p_starts_on then
    raise exception 'Camp parameters failed validation'
      using errcode = '22023';
  end if;

  if p_timezone is null
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names
      where name = p_timezone
    ) then
    raise exception 'Unknown camp timezone'
      using errcode = '22023';
  end if;

  insert into public.camps (
    organization_id,
    name,
    starts_on,
    ends_on,
    timezone,
    status,
    created_by
  ) values (
    p_organization_id,
    trim(p_name),
    p_starts_on,
    p_ends_on,
    p_timezone,
    'draft',
    actor_user_id
  )
  returning id into new_camp_id;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    p_organization_id,
    actor_user_id,
    'camp_created',
    'camp',
    new_camp_id::text,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'starts_on', p_starts_on,
      'ends_on', p_ends_on
    )
  );

  return new_camp_id;
end;
$$;

revoke all on function public.create_camp(
  uuid, text, date, date, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_camp(
  uuid, text, date, date, text
) to authenticated;
