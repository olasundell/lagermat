-- Let the server verify explicit, labelled inner-unit counts without inferring
-- count from mass or volume. This keeps safe batch approval aligned with the
-- deterministic catalogue matcher.

create function public.supplier_verified_inner_unit_count(
  p_packaging_metadata jsonb
)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_packaging_metadata) = 'object'
      and jsonb_typeof(
        p_packaging_metadata -> 'inner_unit_label'
      ) = 'string'
      and length(trim(
        p_packaging_metadata ->> 'inner_unit_label'
      )) between 1 and 80
      and public.supplier_jsonb_integer(
        p_packaging_metadata -> 'inner_unit_count'
      ) between 1 and 10000
    then public.supplier_jsonb_integer(
      p_packaging_metadata -> 'inner_unit_count'
    )::numeric
    else null
  end;
$$;

create function public.supplier_product_expected_amount(
  p_package_amount numeric,
  p_package_unit text,
  p_packaging_metadata jsonb,
  p_required_unit text
)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when public.normalized_supplier_unit(p_required_unit) = 'st'
      and public.supplier_verified_inner_unit_count(
        p_packaging_metadata
      ) is not null
    then public.supplier_verified_inner_unit_count(
      p_packaging_metadata
    )
    else public.supplier_expected_amount(
      p_package_amount,
      p_package_unit,
      p_required_unit
    )
  end;
$$;

create or replace function public.supplier_safe_match_score(
  p_organization_id uuid,
  p_canonical_key text,
  p_supplier_account_id uuid,
  p_supplier_product_id uuid,
  p_required_unit text
)
returns numeric
language sql
stable
parallel safe
set search_path = ''
as $$
  select case
    when account.active
      and product.active
      and not product.catch_weight
      and length(trim(product.purchase_unit)) > 0
      and product.minimum_order_units > 0
      and public.canonical_ingredient_key(
        canonical.display_name,
        p_required_unit
      ) = p_canonical_key
      and public.normalized_supplier_search_name(
        canonical.display_name
      ) = public.normalized_supplier_match_name(
        product.display_name,
        product.brand
      )
      and public.supplier_product_expected_amount(
        product.package_amount,
        product.package_unit,
        product.packaging_metadata,
        p_required_unit
      ) is not null
    then 80
      + case
          when public.normalized_supplier_unit(p_required_unit) = 'st'
            and public.supplier_verified_inner_unit_count(
              product.packaging_metadata
            ) is not null
          then 15
          when public.normalized_supplier_unit(product.package_unit)
            = public.normalized_supplier_unit(p_required_unit)
          then 15
          else 12
        end
      + 5
    else null
  end
  from public.canonical_ingredients as canonical
  join public.supplier_products as product
    on product.organization_id = canonical.organization_id
    and product.supplier_account_id = p_supplier_account_id
    and product.id = p_supplier_product_id
  join public.supplier_accounts as account
    on account.organization_id = product.organization_id
    and account.id = product.supplier_account_id
  where canonical.organization_id = p_organization_id
    and canonical.canonical_key = p_canonical_key;
$$;

create or replace function public.is_supplier_candidate_current(
  p_organization_id uuid,
  p_candidate_id uuid,
  p_require_safe boolean
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.supplier_match_candidates as candidate
    join public.canonical_ingredients as canonical
      on canonical.organization_id = candidate.organization_id
      and canonical.canonical_key = candidate.canonical_key
    join public.supplier_products as product
      on product.organization_id = candidate.organization_id
      and product.supplier_account_id = candidate.supplier_account_id
      and product.id = candidate.supplier_product_id
    join public.supplier_accounts as account
      on account.organization_id = candidate.organization_id
      and account.id = candidate.supplier_account_id
    where candidate.organization_id = p_organization_id
      and candidate.id = p_candidate_id
      and candidate.status in ('safe', 'review')
      and (
        not p_require_safe
        or (
          candidate.status = 'safe'
          and candidate.score >= 96
          and not product.catch_weight
          and candidate.score = public.supplier_safe_match_score(
            candidate.organization_id,
            candidate.canonical_key,
            candidate.supplier_account_id,
            candidate.supplier_product_id,
            candidate.required_unit
          )
        )
      )
      and account.active
      and product.active
      and product.product_fingerprint = candidate.product_fingerprint
      and public.canonical_ingredient_key(
        canonical.display_name,
        candidate.required_unit
      ) = candidate.canonical_key
      and public.supplier_product_expected_amount(
        product.package_amount,
        product.package_unit,
        product.packaging_metadata,
        candidate.required_unit
      ) is not null
      and round(
        public.supplier_product_expected_amount(
          product.package_amount,
          product.package_unit,
          product.packaging_metadata,
          candidate.required_unit
        ),
        6
      ) = round(candidate.amount_per_purchase_unit, 6)
  );
$$;

create or replace function public.replace_supplier_match_candidates(
  p_organization_id uuid,
  p_supplier_account_id uuid,
  p_matcher_version text,
  p_candidates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  normalized_matcher_version text :=
    trim(coalesce(p_matcher_version, ''));
  superseded_count integer := 0;
  inserted_count integer := 0;
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

  if normalized_matcher_version
      !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$' then
    raise exception 'Matcher version failed validation'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'Candidates must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_candidates) > 500
    or pg_column_size(p_candidates) > 2000000 then
    raise exception 'Candidate replacement exceeds its bounded batch'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_candidates) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or (
        item.value - array[
          'canonical_key',
          'supplier_product_id',
          'status',
          'score',
          'signals',
          'product_fingerprint',
          'required_unit',
          'amount_per_purchase_unit',
          'import_run_id'
        ]
      ) <> '{}'::jsonb
      or jsonb_typeof(item.value -> 'canonical_key') <> 'string'
      or item.value ->> 'canonical_key' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(item.value -> 'supplier_product_id') <> 'string'
      or item.value ->> 'supplier_product_id'
        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(item.value -> 'status') <> 'string'
      or item.value ->> 'status' not in ('safe', 'review')
      or public.supplier_jsonb_numeric(item.value -> 'score') is null
      or public.supplier_jsonb_numeric(item.value -> 'score')
        not between 0 and 100
      or (
        item.value ->> 'status' = 'safe'
        and public.supplier_jsonb_numeric(item.value -> 'score') < 96
      )
      or jsonb_typeof(item.value -> 'signals') <> 'object'
      or pg_column_size(item.value -> 'signals') > 100000
      or jsonb_typeof(item.value -> 'product_fingerprint') <> 'string'
      or item.value ->> 'product_fingerprint' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(item.value -> 'required_unit') <> 'string'
      or length(trim(item.value ->> 'required_unit'))
        not between 1 and 30
      or public.supplier_jsonb_numeric(
        item.value -> 'amount_per_purchase_unit'
      ) is null
      or public.supplier_jsonb_numeric(
        item.value -> 'amount_per_purchase_unit'
      ) <= 0
      or public.supplier_jsonb_numeric(
        item.value -> 'amount_per_purchase_unit'
      ) > 99999999999999.999999
      or (
        item.value ? 'import_run_id'
        and item.value -> 'import_run_id' <> 'null'::jsonb
        and (
          jsonb_typeof(item.value -> 'import_run_id') <> 'string'
          or item.value ->> 'import_run_id'
            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      )
  ) then
    raise exception 'Candidate payload failed structural validation'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_candidates) as candidate_data(
      canonical_key text,
      supplier_product_id uuid
    )
    group by
      candidate_data.canonical_key,
      candidate_data.supplier_product_id
    having count(*) > 1
  ) then
    raise exception 'Candidate payload contains duplicates'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_candidates) as candidate_data(
      canonical_key text,
      supplier_product_id uuid,
      status text,
      score numeric,
      product_fingerprint text,
      required_unit text,
      amount_per_purchase_unit numeric,
      import_run_id uuid
    )
    left join public.canonical_ingredients as canonical
      on canonical.organization_id = p_organization_id
      and canonical.canonical_key = candidate_data.canonical_key
    left join public.supplier_products as product
      on product.organization_id = p_organization_id
      and product.supplier_account_id = p_supplier_account_id
      and product.id = candidate_data.supplier_product_id
    left join public.supplier_import_runs as import_run
      on import_run.organization_id = p_organization_id
      and import_run.supplier_account_id = p_supplier_account_id
      and import_run.id = candidate_data.import_run_id
    where canonical.canonical_key is null
      or product.id is null
      or not product.active
      or product.product_fingerprint
        <> candidate_data.product_fingerprint
      or public.canonical_ingredient_key(
        canonical.display_name,
        candidate_data.required_unit
      ) <> candidate_data.canonical_key
      or (
        candidate_data.import_run_id is not null
        and import_run.id is null
      )
      or (
        candidate_data.status = 'safe'
        and (
          product.catch_weight
          or public.supplier_safe_match_score(
            p_organization_id,
            candidate_data.canonical_key,
            p_supplier_account_id,
            candidate_data.supplier_product_id,
            candidate_data.required_unit
          ) is null
          or round(
            public.supplier_safe_match_score(
              p_organization_id,
              candidate_data.canonical_key,
              p_supplier_account_id,
              candidate_data.supplier_product_id,
              candidate_data.required_unit
            ),
            2
          ) <> round(candidate_data.score, 2)
          or public.supplier_product_expected_amount(
            product.package_amount,
            product.package_unit,
            product.packaging_metadata,
            candidate_data.required_unit
          ) is null
          or round(
            public.supplier_product_expected_amount(
              product.package_amount,
              product.package_unit,
              product.packaging_metadata,
              candidate_data.required_unit
            ),
            6
          ) <> round(candidate_data.amount_per_purchase_unit, 6)
        )
      )
  ) then
    raise exception
      'Candidates failed supplier ownership, fingerprint or unit validation'
      using errcode = '22023';
  end if;

  update public.supplier_match_candidates
  set
    status = 'superseded',
    updated_at = now()
  where organization_id = p_organization_id
    and supplier_account_id = p_supplier_account_id
    and matcher_version = normalized_matcher_version
    and status in ('safe', 'review');

  get diagnostics superseded_count = row_count;

  insert into public.supplier_match_candidates (
    organization_id,
    supplier_account_id,
    canonical_key,
    supplier_product_id,
    import_run_id,
    matcher_version,
    status,
    score,
    signals,
    product_fingerprint,
    required_unit,
    amount_per_purchase_unit,
    generated_by
  )
  select
    p_organization_id,
    p_supplier_account_id,
    candidate_data.canonical_key,
    candidate_data.supplier_product_id,
    candidate_data.import_run_id,
    normalized_matcher_version,
    candidate_data.status,
    candidate_data.score,
    candidate_data.signals,
    candidate_data.product_fingerprint,
    trim(candidate_data.required_unit),
    candidate_data.amount_per_purchase_unit,
    actor_user_id
  from jsonb_to_recordset(p_candidates) as candidate_data(
    canonical_key text,
    supplier_product_id uuid,
    import_run_id uuid,
    status text,
    score numeric,
    signals jsonb,
    product_fingerprint text,
    required_unit text,
    amount_per_purchase_unit numeric
  );

  get diagnostics inserted_count = row_count;

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
    'supplier_match_candidates_replaced',
    'supplier_account',
    p_supplier_account_id::text,
    jsonb_build_object(
      'matcher_version', normalized_matcher_version,
      'superseded_candidates', superseded_count,
      'inserted_candidates', inserted_count
    )
  );

  return jsonb_build_object(
    'supplier_account_id', p_supplier_account_id,
    'matcher_version', normalized_matcher_version,
    'superseded_candidates', superseded_count,
    'inserted_candidates', inserted_count
  );
end;
$$;

revoke all on function public.supplier_verified_inner_unit_count(jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.supplier_product_expected_amount(
  numeric, text, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function public.supplier_safe_match_score(
  uuid, text, uuid, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.is_supplier_candidate_current(
  uuid, uuid, boolean
) from public, anon, authenticated, service_role;

revoke all on function public.replace_supplier_match_candidates(
  uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.replace_supplier_match_candidates(
  uuid, uuid, text, jsonb
) to authenticated;
