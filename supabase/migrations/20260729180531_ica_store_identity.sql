alter table public.supplier_accounts
  add column provider_location_id text
    check (
      provider_location_id is null
      or length(trim(provider_location_id)) between 1 and 120
    );

comment on column public.supplier_accounts.provider_location_id is
  'Provider-owned stable location identifier, for example ICA store id 1004021.';

drop function public.save_supplier_account_identity(
  uuid, uuid, text, text, text
);

create function public.save_supplier_account_identity(
  p_organization_id uuid,
  p_account_key uuid,
  p_provider_key text,
  p_display_name text,
  p_customer_number text,
  p_provider_location_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  normalized_provider_key text := lower(trim(coalesce(p_provider_key, '')));
  normalized_customer_number text := nullif(trim(p_customer_number), '');
  normalized_provider_location_id text :=
    nullif(trim(p_provider_location_id), '');
  saved_account_id uuid;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  if p_account_key is null
    or normalized_provider_key
      !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(trim(coalesce(p_display_name, ''))) not between 1 and 160
    or (
      normalized_customer_number is not null
      and length(normalized_customer_number) > 120
    )
    or (
      normalized_provider_location_id is not null
      and length(normalized_provider_location_id) > 120
    )
    or (
      normalized_provider_key = 'ica'
      and normalized_provider_location_id is null
    ) then
    raise exception 'Supplier account parameters failed validation'
      using errcode = '22023';
  end if;

  insert into public.supplier_accounts (
    organization_id,
    account_key,
    provider_key,
    provider_location_id,
    display_name,
    customer_number,
    active,
    created_by
  ) values (
    p_organization_id,
    p_account_key,
    normalized_provider_key,
    normalized_provider_location_id,
    trim(p_display_name),
    normalized_customer_number,
    true,
    actor_user_id
  )
  on conflict on constraint supplier_accounts_account_key_unique
  do update set
    provider_key = excluded.provider_key,
    provider_location_id = excluded.provider_location_id,
    display_name = excluded.display_name,
    customer_number = excluded.customer_number,
    active = true,
    updated_at = now()
  returning id into saved_account_id;

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
    'supplier_account_identity_saved',
    'supplier_account',
    saved_account_id::text,
    jsonb_build_object(
      'account_key', p_account_key,
      'provider_key', normalized_provider_key,
      'provider_location_id', normalized_provider_location_id
    )
  );

  return saved_account_id;
end;
$$;

revoke all on function public.save_supplier_account_identity(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.save_supplier_account_identity(
  uuid, uuid, text, text, text, text
) to authenticated;
