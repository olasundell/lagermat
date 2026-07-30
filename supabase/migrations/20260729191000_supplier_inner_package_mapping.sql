-- Keep the saved import profile aligned with the client-side catalogue format.
-- Inner package fields let the UI express one supplier case as, for example,
-- six consumer tins without changing the supplier's actual order unit.

create or replace function public.save_supplier_import_column_profile(
  p_organization_id uuid,
  p_supplier_account_id uuid,
  p_profile_name text,
  p_source_kind text,
  p_column_mapping jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  normalized_source_kind text :=
    lower(trim(coalesce(p_source_kind, '')));
  mapping_targets text[];
  saved_profile_id uuid;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.supplier_accounts as account
    where account.organization_id = p_organization_id
      and account.id = p_supplier_account_id
      and account.active
  ) then
    raise exception 'Active supplier account required'
      using errcode = '22023';
  end if;

  if length(trim(coalesce(p_profile_name, ''))) not between 1 and 120
    or normalized_source_kind not in ('csv', 'xlsx', 'json', 'api')
    or jsonb_typeof(p_column_mapping) <> 'array'
    or pg_column_size(p_column_mapping) > 100000 then
    raise exception 'Column profile failed validation'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_column_mapping) not between 1 and 250 then
    raise exception 'Column profile failed validation'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_column_mapping) as mapping(value)
    where jsonb_typeof(mapping.value) <> 'object'
      or (
        mapping.value - array['index', 'source', 'target']
      ) <> '{}'::jsonb
      or public.supplier_jsonb_integer(mapping.value -> 'index') is null
      or public.supplier_jsonb_integer(mapping.value -> 'index')
        not between 0 and 10000
      or jsonb_typeof(mapping.value -> 'source') <> 'string'
      or length(trim(mapping.value ->> 'source')) not between 1 and 200
      or jsonb_typeof(mapping.value -> 'target') <> 'string'
      or mapping.value ->> 'target' not in (
        'supplier_article_number',
        'display_name',
        'purchase_unit',
        'total_quantity',
        'total_amount',
        'total_unit',
        'gtin',
        'price',
        'minimum_order_units',
        'inner_unit_count',
        'inner_unit_label',
        'valid_from',
        'valid_to',
        'category',
        'brand',
        'catch_weight',
        'ignore'
      )
  ) or exists (
    select 1
    from jsonb_array_elements(p_column_mapping) as mapping(value)
    group by public.supplier_jsonb_integer(mapping.value -> 'index')
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(p_column_mapping) as mapping(value)
    where mapping.value ->> 'target' <> 'ignore'
    group by mapping.value ->> 'target'
    having count(*) > 1
  ) then
    raise exception 'Column mapping failed validation'
      using errcode = '22023';
  end if;

  select coalesce(
    array_agg(mapping.value ->> 'target') filter (
      where mapping.value ->> 'target' <> 'ignore'
    ),
    array[]::text[]
  )
  into mapping_targets
  from jsonb_array_elements(p_column_mapping) as mapping(value);

  if not (
    mapping_targets @> array[
      'supplier_article_number',
      'display_name',
      'purchase_unit'
    ]
    and (
      'total_quantity' = any(mapping_targets)
      or mapping_targets @> array['total_amount', 'total_unit']
    )
  ) then
    raise exception 'Column mapping failed validation'
      using errcode = '22023';
  end if;

  insert into public.supplier_import_column_profiles as profile (
    organization_id,
    supplier_account_id,
    profile_name,
    source_kind,
    column_mapping,
    created_by
  ) values (
    p_organization_id,
    p_supplier_account_id,
    trim(p_profile_name),
    normalized_source_kind,
    p_column_mapping,
    actor_user_id
  )
  on conflict on constraint supplier_import_column_profiles_name_unique
  do update set
    source_kind = excluded.source_kind,
    column_mapping = excluded.column_mapping,
    updated_at = now()
  returning id into saved_profile_id;

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
    'supplier_import_column_profile_saved',
    'supplier_import_column_profile',
    saved_profile_id::text,
    jsonb_build_object(
      'supplier_account_id', p_supplier_account_id,
      'source_kind', normalized_source_kind
    )
  );

  return saved_profile_id;
end;
$$;
