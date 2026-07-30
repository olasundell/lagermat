begin;

create extension if not exists pgtap with schema extensions;
select plan(50);

-- 1
select is(
  (
    select count(*)::integer
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'supplier_import_column_profiles',
        'supplier_import_runs',
        'supplier_import_rows',
        'supplier_match_candidates',
        'preferred_supplier_matches'
      )
  ),
  5,
  'the supplier import and matching relations exist'
);

-- 2
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and (
        (
          table_name = 'supplier_accounts'
          and column_name in ('account_key', 'provider_location_id')
        )
        or (
          table_name = 'supplier_products'
          and column_name in (
            'source_metadata',
            'normalized_search_name',
            'brand',
            'category',
            'packaging_metadata',
            'catch_weight',
            'product_fingerprint',
            'latest_import_run_id'
          )
        )
        or (
          table_name = 'ingredient_supplier_matches'
          and column_name in (
            'supplier_account_id',
            'approved_product_fingerprint'
          )
        )
      )
  ),
  12,
  'stable account and store identities, searchable product metadata and approval snapshots are stored'
);

-- 3
select has_index(
  'public',
  'supplier_products',
  'supplier_products_catalogue_search_idx',
  'catalogue name searches have an organization/account/name index'
);

select has_index(
  'public',
  'supplier_accounts',
  'supplier_accounts_org_provider_location_unique',
  'one organization cannot create duplicate accounts for the same provider location'
);

-- 4
select ok(
  (
    select bool_and(relation.relrowsecurity)
    from pg_class as relation
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'supplier_import_column_profiles',
        'supplier_import_runs',
        'supplier_import_rows',
        'supplier_match_candidates',
        'preferred_supplier_matches'
      )
  ),
  'RLS is enabled on every new supplier relation'
);

-- 5
select ok(
  (
    select bool_and(
      has_table_privilege(
        'authenticated',
        format('public.%I', supplier_table.table_name),
        'SELECT'
      )
    )
    from unnest(array[
      'supplier_import_column_profiles',
      'supplier_import_runs',
      'supplier_import_rows',
      'supplier_match_candidates',
      'preferred_supplier_matches'
    ]) as supplier_table(table_name)
  ),
  'authenticated members receive RLS-protected read access'
);

-- 6
select ok(
  (
    select bool_and(
      not has_table_privilege(
        'authenticated',
        format('public.%I', supplier_table.table_name),
        'INSERT,UPDATE,DELETE'
      )
    )
    from unnest(array[
      'supplier_import_column_profiles',
      'supplier_import_runs',
      'supplier_import_rows',
      'supplier_match_candidates',
      'preferred_supplier_matches'
    ]) as supplier_table(table_name)
  ),
  'authenticated members cannot mutate supplier workflow tables directly'
);

-- 7
select ok(
  has_function_privilege(
    'authenticated',
    'public.ensure_ica_sickla_supplier_account(uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.save_supplier_account_identity(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.save_supplier_import_column_profile(uuid,uuid,text,text,jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.start_supplier_import(uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.stage_supplier_import_rows(uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.finalize_supplier_import(uuid,uuid,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.replace_supplier_match_candidates(uuid,uuid,text,jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.decide_supplier_match_candidate(uuid,uuid,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.approve_safe_supplier_match_candidates(uuid,uuid,text,uuid[])',
    'EXECUTE'
  ),
  'authenticated users can execute the bounded supplier workflow RPCs'
);

-- 8
select ok(
  not has_function_privilege(
    'anon',
    'public.ensure_ica_sickla_supplier_account(uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.save_supplier_account_identity(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.stage_supplier_import_rows(uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.approve_safe_supplier_match_candidates(uuid,uuid,text,uuid[])',
    'EXECUTE'
  ),
  'anonymous callers cannot use supplier mutation RPCs'
);

-- 9
select ok(
  (
    select bool_and(
      procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
    )
    from pg_proc as procedure
    where procedure.oid in (
      'public.ensure_ica_sickla_supplier_account(uuid)'::regprocedure,
      'public.save_supplier_account_identity(uuid,uuid,text,text,text,text)'::regprocedure,
      'public.save_supplier_import_column_profile(uuid,uuid,text,text,jsonb)'::regprocedure,
      'public.start_supplier_import(uuid,uuid,uuid,text,text,text)'::regprocedure,
      'public.stage_supplier_import_rows(uuid,uuid,uuid,jsonb)'::regprocedure,
      'public.finalize_supplier_import(uuid,uuid,uuid)'::regprocedure,
      'public.replace_supplier_match_candidates(uuid,uuid,text,jsonb)'::regprocedure,
      'public.decide_supplier_match_candidate(uuid,uuid,text)'::regprocedure,
      'public.approve_safe_supplier_match_candidates(uuid,uuid,text,uuid[])'::regprocedure
    )
  ),
  'supplier mutation RPCs are security-definer functions with empty search paths'
);

-- 10
select ok(
  not has_function_privilege(
    'authenticated',
    'public.apply_supplier_candidate_approval(uuid,uuid,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.supplier_product_fingerprint(text,text,text,text,numeric,text,integer,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.supersede_older_supplier_match_candidates()',
    'EXECUTE'
  ),
  'internal approval and fingerprint helpers are not Data API surfaces'
);

delete from public.supplier_accounts
where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  and provider_key = 'ica'
  and provider_location_id = '1004021';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

select set_config(
  'scoutmat_test.supplier_account_id',
  public.save_supplier_account_identity(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca000000-0000-4000-8000-000000000001',
    'martin_servera',
    'Martin & Servera original',
    null,
    null
  )::text,
  true
);

-- 11
select ok(
  current_setting('scoutmat_test.supplier_account_id')::uuid is not null,
  'a member can create a supplier account with a stable account key'
);

select set_config(
  'scoutmat_test.renamed_supplier_account_id',
  public.save_supplier_account_identity(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca000000-0000-4000-8000-000000000001',
    'martin_servera',
    'Martin & Servera omdöpt',
    null,
    null
  )::text,
  true
);

-- 12
select is(
  current_setting('scoutmat_test.renamed_supplier_account_id')::uuid,
  current_setting('scoutmat_test.supplier_account_id')::uuid,
  'renaming a customerless account preserves its stable identity'
);

-- 13
select is(
  (
    select display_name
    from public.supplier_accounts
    where id =
      current_setting('scoutmat_test.supplier_account_id')::uuid
  ),
  'Martin & Servera omdöpt',
  'the stable account identity updates mutable display data'
);

select set_config(
  'scoutmat_test.column_profile_id',
  public.save_supplier_import_column_profile(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    current_setting('scoutmat_test.supplier_account_id')::uuid,
    'Grossistfil',
    'xlsx',
    '[
      {"index":0,"source":"Artikelnr","target":"supplier_article_number"},
      {"index":1,"source":"Benämning","target":"display_name"},
      {"index":2,"source":"Best enhet","target":"purchase_unit"},
      {"index":3,"source":"Mängd","target":"total_amount"},
      {"index":4,"source":"Mängdenhet","target":"total_unit"},
      {"index":5,"source":"Varumärke","target":"brand"},
      {"index":6,"source":"Viktvara","target":"catch_weight"},
      {"index":7,"source":"Antal innerförpackningar","target":"inner_unit_count"},
      {"index":8,"source":"Innerförpackning","target":"inner_unit_label"}
    ]'::jsonb
  )::text,
  true
);

-- 14
select ok(
  current_setting('scoutmat_test.column_profile_id')::uuid is not null,
  'the UI column-profile shape can be persisted'
);

-- 15
select is(
  (
    select concat_ws(
      ',',
      column_mapping -> 3 ->> 'target',
      column_mapping -> 7 ->> 'target',
      column_mapping -> 8 ->> 'target'
    )
    from public.supplier_import_column_profiles
    where id = current_setting('scoutmat_test.column_profile_id')::uuid
  ),
  'total_amount,inner_unit_count,inner_unit_label',
  'the raw UI mapping and inner package fields are retained for reuse'
);

-- 16
select throws_ok(
  format(
    $profile$
      select public.save_supplier_import_column_profile(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        %L,
        'Gammalt format',
        'csv',
        '[{"index":0,"source":"Art","target":"package_amount"}]'::jsonb
      )
    $profile$,
    current_setting('scoutmat_test.supplier_account_id')::uuid
  ),
  '22023',
  'Column mapping failed validation',
  'a profile cannot persist targets outside the real UI contract'
);

select set_config(
  'scoutmat_test.import_run_1',
  public.start_supplier_import(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    current_setting('scoutmat_test.supplier_account_id')::uuid,
    current_setting('scoutmat_test.column_profile_id')::uuid,
    'grossist-1.xlsx',
    'xlsx',
    repeat('a', 64)
  )::text,
  true
);

-- 17
select ok(
  current_setting('scoutmat_test.import_run_1')::uuid is not null,
  'a member can start an account-scoped import run'
);

-- 18
select is(
  public.start_supplier_import(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    current_setting('scoutmat_test.supplier_account_id')::uuid,
    current_setting('scoutmat_test.column_profile_id')::uuid,
    'grossist-1.xlsx',
    'xlsx',
    repeat('a', 64)
  ),
  current_setting('scoutmat_test.import_run_1')::uuid,
  'the same account/source fingerprint starts idempotently'
);

select set_config(
  'scoutmat_test.stage_1',
  public.stage_supplier_import_rows(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    current_setting('scoutmat_test.supplier_account_id')::uuid,
    current_setting('scoutmat_test.import_run_1')::uuid,
    jsonb_build_array(
      jsonb_build_object(
        'source_row', 2,
        'raw_data', jsonb_build_object('Artikelnr', 'AUTO-A'),
        'normalized_data', jsonb_build_object(
          'supplier_article_number', 'AUTO-A',
          'display_name', 'Krossade tomater 6 x 2,5 kg',
          'purchase_unit', 'kartong',
          'package_amount', 15,
          'package_unit', 'kg',
          'gtin', '07350001234567',
          'minimum_order_units', 1,
          'price', 129.50,
          'valid_from', current_date::text,
          'brand', 'Grossistens',
          'category', 'Konserver',
          'catch_weight', false,
          'metadata', jsonb_build_object('source_row_id', 'dabas-1')
        )
      ),
      jsonb_build_object(
        'source_row', 3,
        'raw_data', jsonb_build_object('Artikelnr', 'AUTO-B'),
        'normalized_data', jsonb_build_object(
          'supplier_article_number', 'AUTO-B',
          'display_name', 'Krossade tomater viktvara',
          'purchase_unit', 'kartong',
          'package_amount', 5,
          'package_unit', 'kg',
          'catch_weight', true
        )
      ),
      jsonb_build_object(
        'source_row', 4,
        'raw_data', jsonb_build_object('Artikelnr', 'INVALID'),
        'normalized_data', jsonb_build_object(
          'supplier_article_number', 'INVALID',
          'display_name', 'Ogiltig rad',
          'purchase_unit', 'kartong',
          'package_amount', 0,
          'package_unit', 'kg'
        )
      )
    )
  )::text,
  true
);

-- 19
select is(
  (
    current_setting('scoutmat_test.stage_1')::jsonb
      ->> 'valid_rows'
  )::integer,
  2,
  'staging records two valid rows and keeps one invalid row for review'
);

select set_config(
  'scoutmat_test.finalize_1',
  public.finalize_supplier_import(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    current_setting('scoutmat_test.supplier_account_id')::uuid,
    current_setting('scoutmat_test.import_run_1')::uuid
  )::text,
  true
);

-- 20
select ok(
  (
    current_setting('scoutmat_test.finalize_1')::jsonb
      ->> 'imported_rows'
  )::integer = 2
  and (
    current_setting('scoutmat_test.finalize_1')::jsonb
      ->> 'invalid_rows'
  )::integer = 1,
  'finalization imports only server-valid rows'
);

-- 21
select ok(
  (
    select count(*) = 2
      and bool_and(product.product_fingerprint ~ '^[0-9a-f]{64}$')
      and bool_and(product.normalized_search_name <> '')
      and bool_or(product.brand = 'Grossistens')
      and bool_or(product.category = 'Konserver')
      and bool_or(product.catch_weight)
      and bool_and(product.latest_import_run_id =
        current_setting('scoutmat_test.import_run_1')::uuid)
    from public.supplier_products as product
    where product.supplier_account_id =
      current_setting('scoutmat_test.supplier_account_id')::uuid
  ),
  'valid products receive searchable metadata, catch-weight and import lineage'
);

-- 22
select ok(
  not exists (
    select 1
    from public.supplier_products
    where supplier_account_id =
      current_setting('scoutmat_test.supplier_account_id')::uuid
      and supplier_article_number = 'INVALID'
  )
  and exists (
    select 1
    from public.supplier_import_rows
    where import_run_id =
      current_setting('scoutmat_test.import_run_1')::uuid
      and source_row = 4
      and validation_errors ? 'invalid_package_amount'
      and supplier_product_id is null
  ),
  'invalid staging rows remain inspectable without becoming products'
);

-- 23
select ok(
  exists (
    select 1
    from public.supplier_offers as offer
    join public.supplier_products as product
      on product.organization_id = offer.organization_id
      and product.id = offer.supplier_product_id
    where product.supplier_account_id =
        current_setting('scoutmat_test.supplier_account_id')::uuid
      and product.supplier_article_number = 'AUTO-A'
      and offer.price = 129.50
      and offer.currency = 'SEK'
  ),
  'valid imported commercial data is separated into a supplier offer'
);

select set_config(
  'scoutmat_test.product_a_id',
  (
    select id::text
    from public.supplier_products
    where supplier_account_id =
      current_setting('scoutmat_test.supplier_account_id')::uuid
      and supplier_article_number = 'AUTO-A'
  ),
  true
);
select set_config(
  'scoutmat_test.product_b_id',
  (
    select id::text
    from public.supplier_products
    where supplier_account_id =
      current_setting('scoutmat_test.supplier_account_id')::uuid
      and supplier_article_number = 'AUTO-B'
  ),
  true
);
select set_config(
  'scoutmat_test.product_a_fingerprint',
  (
    select product_fingerprint
    from public.supplier_products
    where id = current_setting('scoutmat_test.product_a_id')::uuid
  ),
  true
);

select throws_ok(
  format(
    $candidate$
      select public.replace_supplier_match_candidates(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        %L,
        'deterministic-v1',
        jsonb_build_array(jsonb_build_object(
          'canonical_key',
            public.canonical_ingredient_key('Krossade tomater', 'kg'),
          'supplier_product_id', %L,
          'status', 'safe',
          'score', 99,
          'signals', jsonb_build_object('claimed_score', 99),
          'product_fingerprint', %L,
          'required_unit', 'kg',
          'amount_per_purchase_unit', 15,
          'import_run_id', %L
        ))
      )
    $candidate$,
    current_setting('scoutmat_test.supplier_account_id')::uuid,
    current_setting('scoutmat_test.product_a_id'),
    current_setting('scoutmat_test.product_a_fingerprint'),
    current_setting('scoutmat_test.import_run_1')
  ),
  '22023',
  'Candidates failed supplier ownership, fingerprint or unit validation',
  'the server rejects a client-forged safe score'
);

-- 24
select is(
  (
    public.replace_supplier_match_candidates(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      current_setting('scoutmat_test.supplier_account_id')::uuid,
      'deterministic-v1',
      jsonb_build_array(jsonb_build_object(
        'canonical_key',
          public.canonical_ingredient_key('Krossade tomater', 'kg'),
        'supplier_product_id',
          current_setting('scoutmat_test.product_a_id'),
        'status', 'safe',
        'score', 100,
        'signals', jsonb_build_object('name_score', 80),
        'product_fingerprint',
          current_setting('scoutmat_test.product_a_fingerprint'),
        'required_unit', 'kg',
        'amount_per_purchase_unit', 15,
        'import_run_id', current_setting('scoutmat_test.import_run_1')
      ))
    ) ->> 'inserted_candidates'
  )::integer,
  1,
  'the client matcher can atomically persist its versioned safe candidate'
);

select set_config(
  'scoutmat_test.safe_candidate_a',
  (
    select id::text
    from public.supplier_match_candidates
    where supplier_account_id =
      current_setting('scoutmat_test.supplier_account_id')::uuid
      and supplier_product_id =
        current_setting('scoutmat_test.product_a_id')::uuid
      and status = 'safe'
  ),
  true
);

-- 25
select is(
  (
    public.approve_safe_supplier_match_candidates(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      current_setting('scoutmat_test.supplier_account_id')::uuid,
      'deterministic-v1',
      array[
        current_setting('scoutmat_test.safe_candidate_a')::uuid
      ]
    ) ->> 'approved_candidates'
  )::integer,
  1,
  'batch approval accepts a revalidated safe candidate'
);

-- 26
select ok(
  exists (
    select 1
    from public.ingredient_supplier_matches as ingredient_match
    join public.supplier_products as product
      on product.organization_id = ingredient_match.organization_id
      and product.id = ingredient_match.supplier_product_id
    where ingredient_match.supplier_product_id =
      current_setting('scoutmat_test.product_a_id')::uuid
      and ingredient_match.supplier_account_id =
        current_setting('scoutmat_test.supplier_account_id')::uuid
      and ingredient_match.approved_product_fingerprint =
        product.product_fingerprint
  ),
  'approval snapshots the exact product fingerprint and supplier account'
);

-- 27
select ok(
  (
    select count(*) = 1
      and bool_and(
        preferred.supplier_product_id =
          current_setting('scoutmat_test.product_a_id')::uuid
      )
    from public.preferred_supplier_matches as preferred
    where preferred.organization_id =
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and preferred.canonical_key =
        public.canonical_ingredient_key('Krossade tomater', 'kg')
      and preferred.supplier_account_id =
        current_setting('scoutmat_test.supplier_account_id')::uuid
  ),
  'one current preferred match exists per ingredient and supplier account'
);

select set_config(
  'scoutmat_test.import_run_2',
  public.start_supplier_import(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    current_setting('scoutmat_test.supplier_account_id')::uuid,
    current_setting('scoutmat_test.column_profile_id')::uuid,
    'grossist-2.xlsx',
    'xlsx',
    repeat('b', 64)
  )::text,
  true
);
select public.stage_supplier_import_rows(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.supplier_account_id')::uuid,
  current_setting('scoutmat_test.import_run_2')::uuid,
  jsonb_build_array(jsonb_build_object(
    'source_row', 2,
    'raw_data', jsonb_build_object('Artikelnr', 'AUTO-A'),
    'normalized_data', jsonb_build_object(
      'supplier_article_number', 'AUTO-A',
      'display_name', 'Krossade tomater 6 x 2,5 kg',
      'purchase_unit', 'kartong',
      'package_amount', 15,
      'package_unit', 'kg',
      'gtin', '07350001234567',
      'minimum_order_units', 1,
      'brand', 'Nytt varumärke',
      'category', 'Ny kategori',
      'catch_weight', false,
      'metadata', jsonb_build_object('source_row_id', 'dabas-999')
    )
  ))
);
select public.finalize_supplier_import(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.supplier_account_id')::uuid,
  current_setting('scoutmat_test.import_run_2')::uuid
);

-- 28
select is(
  (
    select product_fingerprint
    from public.supplier_products
    where id = current_setting('scoutmat_test.product_a_id')::uuid
  ),
  current_setting('scoutmat_test.product_a_fingerprint'),
  'brand, category and raw source metadata do not change product identity'
);

-- 29
select ok(
  exists (
    select 1
    from public.supplier_products
    where id = current_setting('scoutmat_test.product_b_id')::uuid
      and active
  ),
  'a generic import does not deactivate a product absent from the file'
);

-- 30
select is(
  (
    select count(*)::integer
    from public.preferred_supplier_matches
    where supplier_product_id =
      current_setting('scoutmat_test.product_a_id')::uuid
  ),
  1,
  'an identity-equivalent reimport leaves the approved preference current'
);

select public.replace_supplier_match_candidates(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.supplier_account_id')::uuid,
  'deterministic-v1',
  jsonb_build_array(jsonb_build_object(
    'canonical_key',
      public.canonical_ingredient_key('Krossade tomater', 'kg'),
    'supplier_product_id',
      current_setting('scoutmat_test.product_a_id'),
    'status', 'safe',
    'score', 100,
    'signals', jsonb_build_object('name_score', 80),
    'product_fingerprint',
      current_setting('scoutmat_test.product_a_fingerprint'),
    'required_unit', 'kg',
    'amount_per_purchase_unit', 15,
    'import_run_id', current_setting('scoutmat_test.import_run_2')
  ))
);
select set_config(
  'scoutmat_test.stale_candidate_a',
  (
    select id::text
    from public.supplier_match_candidates
    where supplier_product_id =
      current_setting('scoutmat_test.product_a_id')::uuid
      and status = 'safe'
  ),
  true
);

select set_config(
  'scoutmat_test.import_run_3',
  public.start_supplier_import(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    current_setting('scoutmat_test.supplier_account_id')::uuid,
    current_setting('scoutmat_test.column_profile_id')::uuid,
    'grossist-3.xlsx',
    'xlsx',
    repeat('c', 64)
  )::text,
  true
);
select public.stage_supplier_import_rows(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.supplier_account_id')::uuid,
  current_setting('scoutmat_test.import_run_3')::uuid,
  jsonb_build_array(jsonb_build_object(
    'source_row', 2,
    'raw_data', jsonb_build_object('Artikelnr', 'AUTO-A'),
    'normalized_data', jsonb_build_object(
      'supplier_article_number', 'AUTO-A',
      'display_name', 'Krossade tomater 6 x 2 kg',
      'purchase_unit', 'kartong',
      'package_amount', 12,
      'package_unit', 'kg',
      'gtin', '07350001234567',
      'minimum_order_units', 1,
      'catch_weight', false
    )
  ))
);
select public.finalize_supplier_import(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.supplier_account_id')::uuid,
  current_setting('scoutmat_test.import_run_3')::uuid
);

-- 31
select throws_ok(
  format(
    $approve$
      select public.approve_safe_supplier_match_candidates(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        %L,
        'deterministic-v1',
        array[%L::uuid]
      )
    $approve$,
    current_setting('scoutmat_test.supplier_account_id')::uuid,
    current_setting('scoutmat_test.stale_candidate_a')::uuid
  ),
  '22023',
  'Safe approval batch failed fingerprint or unit revalidation',
  'batch approval rejects a candidate after its product fingerprint changes'
);

-- 32
select ok(
  not exists (
    select 1
    from public.preferred_supplier_matches
    where supplier_product_id =
      current_setting('scoutmat_test.product_a_id')::uuid
  )
  and exists (
    select 1
    from public.ingredient_supplier_matches as ingredient_match
    join public.supplier_products as product
      on product.organization_id = ingredient_match.organization_id
      and product.id = ingredient_match.supplier_product_id
    where ingredient_match.supplier_product_id =
      current_setting('scoutmat_test.product_a_id')::uuid
      and ingredient_match.approved_product_fingerprint
        <> product.product_fingerprint
  ),
  'a changed fingerprint hides the stale preference while preserving its audit trail'
);

select set_config(
  'scoutmat_test.product_a_fingerprint_v2',
  (
    select product_fingerprint
    from public.supplier_products
    where id = current_setting('scoutmat_test.product_a_id')::uuid
  ),
  true
);
select public.replace_supplier_match_candidates(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.supplier_account_id')::uuid,
  'deterministic-v1',
  jsonb_build_array(jsonb_build_object(
    'canonical_key',
      public.canonical_ingredient_key('Krossade tomater', 'kg'),
    'supplier_product_id',
      current_setting('scoutmat_test.product_a_id'),
    'status', 'safe',
    'score', 100,
    'signals', jsonb_build_object('name_score', 80),
    'product_fingerprint',
      current_setting('scoutmat_test.product_a_fingerprint_v2'),
    'required_unit', 'kg',
    'amount_per_purchase_unit', 12,
    'import_run_id', current_setting('scoutmat_test.import_run_3')
  ))
);
select set_config(
  'scoutmat_test.safe_candidate_a_v2',
  (
    select id::text
    from public.supplier_match_candidates
    where supplier_product_id =
      current_setting('scoutmat_test.product_a_id')::uuid
      and status = 'safe'
  ),
  true
);
select public.approve_safe_supplier_match_candidates(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.supplier_account_id')::uuid,
  'deterministic-v1',
  array[current_setting('scoutmat_test.safe_candidate_a_v2')::uuid]
);

-- 33
select ok(
  exists (
    select 1
    from public.ingredient_supplier_matches as ingredient_match
    join public.supplier_products as product
      on product.organization_id = ingredient_match.organization_id
      and product.id = ingredient_match.supplier_product_id
    where ingredient_match.supplier_product_id =
      current_setting('scoutmat_test.product_a_id')::uuid
      and ingredient_match.approved_product_fingerprint =
        product.product_fingerprint
      and ingredient_match.amount_per_purchase_unit = 12
  ),
  'reapproval refreshes the approved fingerprint and package conversion'
);

-- 34
select throws_ok(
  format(
    $candidate$
      select public.replace_supplier_match_candidates(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        %L,
        'deterministic-v1',
        jsonb_build_array(jsonb_build_object(
          'canonical_key',
            public.canonical_ingredient_key('Krossade tomater', 'kg'),
          'supplier_product_id', %L,
          'status', 'safe',
          'score', 99,
          'signals', '{}'::jsonb,
          'product_fingerprint', %L,
          'required_unit', 'kg',
          'amount_per_purchase_unit', 5
        ))
      )
    $candidate$,
    current_setting('scoutmat_test.supplier_account_id')::uuid,
    current_setting('scoutmat_test.product_b_id'),
    (
      select product_fingerprint
      from public.supplier_products
      where id = current_setting('scoutmat_test.product_b_id')::uuid
    )
  ),
  '22023',
  'Candidates failed supplier ownership, fingerprint or unit validation',
  'catch-weight products cannot be persisted as automatically safe'
);

select public.replace_supplier_match_candidates(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.supplier_account_id')::uuid,
  'deterministic-v1',
  jsonb_build_array(jsonb_build_object(
    'canonical_key',
      public.canonical_ingredient_key('Krossade tomater', 'kg'),
    'supplier_product_id',
      current_setting('scoutmat_test.product_b_id'),
    'status', 'review',
    'score', 90,
    'signals', jsonb_build_object('catch_weight', true),
    'product_fingerprint',
      (
        select product_fingerprint
        from public.supplier_products
        where id = current_setting('scoutmat_test.product_b_id')::uuid
      ),
    'required_unit', 'kg',
    'amount_per_purchase_unit', 5,
    'import_run_id', current_setting('scoutmat_test.import_run_1')
  ))
);
select set_config(
  'scoutmat_test.review_candidate_b',
  (
    select id::text
    from public.supplier_match_candidates
    where supplier_product_id =
      current_setting('scoutmat_test.product_b_id')::uuid
      and status = 'review'
  ),
  true
);

-- 35
select is(
  public.decide_supplier_match_candidate(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    current_setting('scoutmat_test.review_candidate_b')::uuid,
    'accepted'
  ) ->> 'status',
  'accepted',
  'a human can explicitly approve a catch-weight review candidate'
);

-- 36
select ok(
  (
    select count(*) = 1
      and bool_and(
        supplier_product_id =
          current_setting('scoutmat_test.product_b_id')::uuid
      )
    from public.preferred_supplier_matches
    where organization_id =
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and canonical_key =
        public.canonical_ingredient_key('Krossade tomater', 'kg')
      and supplier_account_id =
        current_setting('scoutmat_test.supplier_account_id')::uuid
  ),
  'a later human approval atomically replaces, rather than duplicates, the preference'
);

-- 37
select throws_ok(
  $$insert into public.supplier_import_runs (
      organization_id,
      supplier_account_id,
      source_name,
      source_kind,
      source_fingerprint,
      started_by
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca000000-0000-4000-8000-000000000001',
      'blocked.csv',
      'csv',
      repeat('f', 64),
      '11111111-1111-1111-1111-111111111111'
    )$$,
  '42501',
  'permission denied for table supplier_import_runs',
  'authenticated users cannot bypass the mutation RPCs'
);

select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-3333-3333-333333333333',
  true
);

-- 38
select throws_ok(
  $$select public.start_supplier_import(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca000000-0000-4000-8000-000000000001',
      null,
      'forbidden.csv',
      'csv',
      repeat('e', 64)
    )$$,
  '42501',
  'Active organization membership required',
  'a signed-in non-member cannot start an import'
);

select throws_ok(
  $$select public.ensure_ica_sickla_supplier_account(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    )$$,
  '42501',
  'Active organization membership required',
  'a signed-in non-member cannot provision the selected ICA store'
);

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

-- 39
select ok(
  (
    select count(*) >= 12
    from public.audit_events
    where organization_id =
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and event_type in (
        'supplier_account_identity_saved',
        'supplier_import_column_profile_saved',
        'supplier_import_started',
        'supplier_import_rows_staged',
        'supplier_import_finalized',
        'supplier_match_candidates_replaced',
        'supplier_match_candidate_accepted',
        'supplier_match_candidates_batch_approved'
      )
  ),
  'account, import, candidate and approval mutations leave an audit trail'
);

select set_config(
  'scoutmat_test.ica_account_id',
  public.ensure_ica_sickla_supplier_account(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  )::text,
  true
);

select is(
  public.ensure_ica_sickla_supplier_account(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  ),
  current_setting('scoutmat_test.ica_account_id')::uuid,
  'automatic ICA Sickla provisioning is idempotent'
);

select ok(
  exists (
    select 1
    from public.supplier_accounts
    where id = current_setting('scoutmat_test.ica_account_id')::uuid
      and organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and provider_key = 'ica'
      and provider_location_id = '1004021'
      and display_name = 'ICA Kvantum Sickla'
      and active
  )
  and exists (
    select 1
    from public.audit_events
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and event_type = 'supplier_account_ica_sickla_enabled'
      and entity_id =
        current_setting('scoutmat_test.ica_account_id')::text
  ),
  'automatic provisioning creates the selected store and audits the mutation'
);
select set_config(
  'scoutmat_test.ica_import_run',
  public.start_supplier_import(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    current_setting('scoutmat_test.ica_account_id')::uuid,
    null,
    'ica-kvantum-sickla-1004021',
    'api',
    repeat('d', 64)
  )::text,
  true
);
select public.stage_supplier_import_rows(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.ica_account_id')::uuid,
  current_setting('scoutmat_test.ica_import_run')::uuid,
  jsonb_build_array(jsonb_build_object(
    'source_row', 1,
    'raw_data', jsonb_build_object(
      'retailer_product_id', '2141387',
      'store_id', '1004021'
    ),
    'normalized_data', jsonb_build_object(
      'supplier_article_number', '2141387',
      'display_name', 'Krossade tomater 3-p 1170g ICA',
      'purchase_unit', 'förpackning',
      'package_amount', 1.17,
      'package_unit', 'kg',
      'minimum_order_units', 1,
      'brand', 'ICA',
      'catch_weight', false,
      'metadata', jsonb_build_object(
        'source', 'ica_public_webshop',
        'store_id', '1004021'
      ),
      'packaging_metadata', jsonb_build_object(
        'inner_unit_count', 3,
        'inner_unit_label', 'stycken'
      )
    )
  ))
);
select public.finalize_supplier_import(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.ica_account_id')::uuid,
  current_setting('scoutmat_test.ica_import_run')::uuid
);

-- 40
select ok(
  exists (
    select 1
    from public.supplier_products
    where supplier_account_id =
        current_setting('scoutmat_test.ica_account_id')::uuid
      and supplier_article_number = '2141387'
      and active
      and product_data_source = 'import:api'
      and source_metadata @> jsonb_build_object(
        'source', 'ica_public_webshop',
        'store_id', '1004021'
      )
  ),
  'a store-scoped ICA API import publishes a genuine ICA product'
);

reset role;

delete from public.supplier_import_runs
where id = current_setting('scoutmat_test.import_run_3')::uuid;

-- 41
select ok(
  exists (
    select 1
    from public.supplier_products
    where id = current_setting('scoutmat_test.product_a_id')::uuid
      and organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and supplier_account_id =
        current_setting('scoutmat_test.supplier_account_id')::uuid
      and latest_import_run_id is null
  )
  and not exists (
    select 1
    from public.supplier_import_rows
    where import_run_id =
      current_setting('scoutmat_test.import_run_3')::uuid
  )
  and not exists (
    select 1
    from public.supplier_match_candidates
    where import_run_id =
      current_setting('scoutmat_test.import_run_3')::uuid
  ),
  'deleting an import clears only nullable references and preserves product ownership'
);

-- 42
select is(
  public.normalized_supplier_match_name(
    'Krossade tomater 3-p 1170g ICA',
    'ICA'
  ),
  'krossade tomater',
  'server-side safe matching removes verified ICA pack and brand tokens'
);

-- 43
select isnt(
  public.supplier_product_fingerprint(
    '2141387',
    'Krossade tomater 3-p 1170g ICA',
    null,
    'förpackning',
    1.17,
    'kg',
    1,
    false,
    '{"inner_unit_count":3,"inner_unit_label":"stycken"}'::jsonb
  ),
  public.supplier_product_fingerprint(
    '2141387',
    'Krossade tomater 3-p 1170g ICA',
    null,
    'förpackning',
    1.17,
    'kg',
    1,
    false,
    '{"inner_unit_count":6,"inner_unit_label":"stycken"}'::jsonb
  ),
  'a changed verified inner package invalidates the product fingerprint'
);

-- 44
select throws_ok(
  format(
    $product$
      insert into public.supplier_products (
        organization_id,
        supplier_account_id,
        supplier_article_number,
        display_name,
        purchase_unit,
        package_amount,
        package_unit,
        minimum_order_units,
        active,
        product_data_source,
        source_updated_at,
        source_metadata,
        created_by
      ) values (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        %L,
        'FAKE-ICA',
        'Generisk tomatkross',
        'förpackning',
        1,
        'kg',
        1,
        true,
        'manual',
        now(),
        '{}'::jsonb,
        '11111111-1111-1111-1111-111111111111'
      )
    $product$,
    current_setting('scoutmat_test.ica_account_id')::uuid
  ),
  '22023',
  'ICA supplier products must come from the configured store catalogue',
  'manual and generic products are rejected under an ICA account'
);

insert into public.supplier_match_candidates (
  id,
  organization_id,
  supplier_account_id,
  canonical_key,
  supplier_product_id,
  matcher_version,
  status,
  score,
  signals,
  product_fingerprint,
  required_unit,
  amount_per_purchase_unit,
  generated_by
) values (
  'cc000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.supplier_account_id')::uuid,
  public.canonical_ingredient_key('Krossade tomater', 'kg'),
  current_setting('scoutmat_test.product_a_id')::uuid,
  'trigger-old',
  'review',
  100,
  '{}'::jsonb,
  current_setting('scoutmat_test.product_a_fingerprint'),
  'kg',
  15,
  '11111111-1111-1111-1111-111111111111'
);

insert into public.supplier_match_candidates (
  id,
  organization_id,
  supplier_account_id,
  canonical_key,
  supplier_product_id,
  matcher_version,
  status,
  score,
  signals,
  product_fingerprint,
  required_unit,
  amount_per_purchase_unit,
  generated_by
) values (
  'cc000000-0000-4000-8000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.supplier_account_id')::uuid,
  public.canonical_ingredient_key('Krossade tomater', 'kg'),
  current_setting('scoutmat_test.product_a_id')::uuid,
  'trigger-new',
  'review',
  100,
  '{}'::jsonb,
  current_setting('scoutmat_test.product_a_fingerprint'),
  'kg',
  15,
  '11111111-1111-1111-1111-111111111111'
);

select ok(
  exists (
    select 1
    from public.supplier_match_candidates
    where id = 'cc000000-0000-4000-8000-000000000001'
      and status = 'superseded'
  )
  and exists (
    select 1
    from public.supplier_match_candidates
    where id = 'cc000000-0000-4000-8000-000000000002'
      and status = 'review'
  ),
  'publishing a new matcher version removes older open candidates from the queue'
);

select * from finish();
rollback;
