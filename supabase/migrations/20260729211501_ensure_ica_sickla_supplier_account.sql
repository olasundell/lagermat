create unique index supplier_accounts_org_provider_location_unique
  on public.supplier_accounts (
    organization_id,
    provider_key,
    provider_location_id
  )
  where provider_location_id is not null;

create function public.ensure_ica_sickla_supplier_account(
  p_organization_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  existing_account_id uuid;
  existing_account_active boolean;
  saved_account_id uuid;
  audit_action text;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  select account.id, account.active
  into existing_account_id, existing_account_active
  from public.supplier_accounts as account
  where account.organization_id = p_organization_id
    and account.provider_key = 'ica'
    and account.provider_location_id = '1004021'
  for update;

  if existing_account_id is not null then
    if existing_account_active then
      return existing_account_id;
    end if;

    update public.supplier_accounts
    set
      active = true,
      updated_at = now()
    where organization_id = p_organization_id
      and id = existing_account_id
    returning id into saved_account_id;
    audit_action := 'reactivated';
  else
    begin
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
        extensions.gen_random_uuid(),
        'ica',
        '1004021',
        'ICA Kvantum Sickla',
        null,
        true,
        actor_user_id
      )
      returning id into saved_account_id;
      audit_action := 'created';
    exception
      when unique_violation then
        select account.id, account.active
        into existing_account_id, existing_account_active
        from public.supplier_accounts as account
        where account.organization_id = p_organization_id
          and account.provider_key = 'ica'
          and account.provider_location_id = '1004021'
        for update;

        if existing_account_id is null then
          raise;
        end if;

        saved_account_id := existing_account_id;
        if not existing_account_active then
          update public.supplier_accounts
          set
            active = true,
            updated_at = now()
          where organization_id = p_organization_id
            and id = existing_account_id;
          audit_action := 'reactivated';
        end if;
    end;
  end if;

  if audit_action is not null then
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
      'supplier_account_ica_sickla_enabled',
      'supplier_account',
      saved_account_id::text,
      jsonb_build_object(
        'action', audit_action,
        'provider_key', 'ica',
        'provider_location_id', '1004021'
      )
    );
  end if;

  return saved_account_id;
end;
$$;

revoke all on function public.ensure_ica_sickla_supplier_account(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.ensure_ica_sickla_supplier_account(uuid)
to authenticated;
