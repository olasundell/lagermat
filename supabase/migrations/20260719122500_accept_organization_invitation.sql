create function public.accept_organization_invitation(invitation_token text)
returns table (organization_id uuid, role public.organization_role)
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_invitation public.organization_invitations%rowtype;
  signed_in_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if invitation_token is null or length(invitation_token) < 32 then
    raise exception 'Invitation is invalid or expired' using errcode = '22023';
  end if;

  select lower(trim(users.email))
  into signed_in_email
  from auth.users as users
  where users.id = (select auth.uid());

  select invitations.*
  into matched_invitation
  from public.organization_invitations as invitations
  where invitations.token_hash = encode(
    extensions.digest(convert_to(invitation_token, 'UTF8'), 'sha256'),
    'hex'
  )
    and invitations.accepted_at is null
    and invitations.expires_at > now()
  for update;

  if not found or signed_in_email is null then
    raise exception 'Invitation is invalid or expired' using errcode = '22023';
  end if;

  if matched_invitation.email <> signed_in_email then
    raise exception 'Invitation belongs to another email address' using errcode = '42501';
  end if;

  insert into public.organization_memberships as memberships (
    organization_id,
    user_id,
    role,
    status
  ) values (
    matched_invitation.organization_id,
    (select auth.uid()),
    matched_invitation.role,
    'active'
  )
  on conflict on constraint organization_memberships_pkey do update
  set
    role = case
      when memberships.role = 'admin' then memberships.role
      else excluded.role
    end,
    status = 'active',
    updated_at = now();

  update public.organization_invitations
  set
    accepted_at = now(),
    accepted_by = (select auth.uid())
  where id = matched_invitation.id;

  return query
  select matched_invitation.organization_id, matched_invitation.role;
end;
$$;

revoke all on function public.accept_organization_invitation(text) from public, anon;
grant execute on function public.accept_organization_invitation(text) to authenticated;

create function public.list_organization_members(target_organization_id uuid)
returns table (
  user_id uuid,
  email text,
  display_name text,
  role public.organization_role,
  status public.membership_status
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_org_admin(target_organization_id) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  return query
  select
    memberships.user_id,
    users.email::text,
    coalesce(users.raw_user_meta_data ->> 'display_name', split_part(users.email, '@', 1))::text,
    memberships.role,
    memberships.status
  from public.organization_memberships as memberships
  join auth.users as users on users.id = memberships.user_id
  where memberships.organization_id = target_organization_id
  order by lower(users.email);
end;
$$;

revoke all on function public.list_organization_members(uuid) from public, anon;
grant execute on function public.list_organization_members(uuid) to authenticated;

-- The local invitation Edge Function uses service_role only for this bounded
-- write and compensating delete. RLS bypass does not itself grant privileges.
grant insert, delete on table public.organization_invitations to service_role;
