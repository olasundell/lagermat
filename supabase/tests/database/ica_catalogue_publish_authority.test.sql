begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

select ok(
  has_function_privilege(
    'service_role',
    'public.publish_ica_catalogue_rows_service(uuid,uuid,text,date,jsonb,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.publish_ica_catalogue_rows_service(uuid,uuid,text,date,jsonb,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.publish_ica_catalogue_rows_service(uuid,uuid,text,date,jsonb,jsonb)',
    'EXECUTE'
  ),
  'only service_role can execute the ICA catalogue publish RPC'
);

select ok(
  (
    select count(distinct trigger_name) = 2
    from information_schema.triggers
    where event_object_schema = 'public'
      and trigger_name in (
        'supplier_import_runs_enforce_ica_authority',
        'supplier_products_enforce_ica_provenance'
      )
  ),
  'ICA import runs and published products both have authority guards'
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
  'scoutmat_test.ica_authority_account_id',
  public.ensure_ica_sickla_supplier_account(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  )::text,
  true
);

select throws_ok(
  $$
    select public.start_supplier_import(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      current_setting('scoutmat_test.ica_authority_account_id')::uuid,
      null,
      'forged-ica-browser-import',
      'api',
      repeat('a', 64)
    )
  $$,
  '42501',
  'ICA catalogue imports require the server catalogue adapter',
  'an authenticated browser cannot start a generic import under an ICA account'
);

select is(
  (
    select count(*)::integer
    from public.supplier_import_runs
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and supplier_account_id =
        current_setting('scoutmat_test.ica_authority_account_id')::uuid
      and source_name = 'forged-ica-browser-import'
  ),
  0,
  'the rejected browser import leaves no staging run behind'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select set_config(
  'scoutmat_test.ica_authority_result',
  public.publish_ica_catalogue_rows_service(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '11111111-1111-1111-1111-111111111111',
    'ica_public_webshop',
    '2026-07-31',
    jsonb_build_array('Krossade tomater'),
    jsonb_build_array(jsonb_build_object(
      'source_row', 1,
      'raw_data', jsonb_build_object(
        'retailer_product_id', 'authority-2141387',
        'store_id', '1004021'
      ),
      'normalized_data', jsonb_build_object(
        'supplier_article_number', 'authority-2141387',
        'display_name', 'Krossade tomater 3-p 1170g ICA',
        'purchase_unit', 'förpackning',
        'package_amount', 1.17,
        'package_unit', 'kg',
        'minimum_order_units', 1,
        'brand', 'ICA',
        'catch_weight', false,
        'metadata', jsonb_build_object(
          'source', 'ica_public_webshop',
          'store_id', '1004021',
          'ica_search_matches', jsonb_build_array(jsonb_build_object(
            'query', 'Krossade tomater',
            'rank', 0
          )),
          'ica_completed_searches', jsonb_build_array('Krossade tomater')
        ),
        'packaging_metadata', jsonb_build_object(
          'normalization_version', 'ica-public-catalogue-v2',
          'inner_unit_count', 3,
          'inner_unit_label', 'stycken'
        )
      )
    ))
  )::text,
  true
);

reset role;

select is(
  current_setting('scoutmat_test.ica_authority_result')::jsonb ->> 'status',
  'finalized',
  'the server-owned RPC atomically finalizes a valid ICA catalogue payload'
);

select ok(
  exists (
    select 1
    from public.supplier_products
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and supplier_account_id =
        current_setting('scoutmat_test.ica_authority_account_id')::uuid
      and supplier_article_number = 'authority-2141387'
      and product_data_source = 'import:api'
      and active
      and source_metadata @> jsonb_build_object(
        'source', 'ica_public_webshop',
        'store_id', '1004021'
      )
  ),
  'a valid server-owned publish creates the store-scoped ICA product'
);

select ok(
  exists (
    select 1
    from public.audit_events
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and actor_user_id = '11111111-1111-1111-1111-111111111111'
      and event_type = 'supplier_import_finalized'
      and entity_id =
        (current_setting('scoutmat_test.ica_authority_result')::jsonb
          ->> 'import_run_id')
  ),
  'the server-owned publish audits the verified human actor'
);

select lives_ok(
  format(
    $$select public.publish_ica_catalogue_rows_service(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      '11111111-1111-1111-1111-111111111111',
      'ica_public_webshop',
      '2026-07-31',
      jsonb_build_array('Krossade tomater'),
      %L::jsonb
    )$$,
    (
      select jsonb_agg(jsonb_build_object(
        'source_row', import_row.source_row,
        'raw_data', import_row.raw_data,
        'normalized_data', import_row.normalized_data
      ) order by import_row.source_row)::text
      from public.supplier_import_rows as import_row
      where import_row.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
        and import_row.import_run_id =
          (current_setting('scoutmat_test.ica_authority_result')::jsonb
            ->> 'import_run_id')::uuid
    )
  ),
  'publishing the identical server payload is idempotent'
);

select is(
  (
    select count(*)::integer
    from public.supplier_import_runs
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and supplier_account_id =
        current_setting('scoutmat_test.ica_authority_account_id')::uuid
      and source_name = 'ica-kvantum-sickla-1004021'
  ),
  1,
  'an idempotent server retry reuses the same ICA import run'
);

select set_config(
  'scoutmat_test.ica_overlap_result',
  public.publish_ica_catalogue_rows_service(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '11111111-1111-1111-1111-111111111111',
    'ica_public_webshop',
    '2026-07-31',
    jsonb_build_array('Tomater'),
    (
      select jsonb_agg(jsonb_set(
        jsonb_set(
          jsonb_build_object(
            'source_row', import_row.source_row,
            'raw_data', import_row.raw_data,
            'normalized_data', import_row.normalized_data
          ),
          '{normalized_data,metadata,ica_search_matches}',
          jsonb_build_array(jsonb_build_object(
            'query', 'Tomater',
            'rank', 1
          )),
          false
        ),
        '{normalized_data,metadata,ica_completed_searches}',
        jsonb_build_array('Tomater'),
        false
      ) order by import_row.source_row)
      from public.supplier_import_rows as import_row
      where import_row.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
        and import_row.import_run_id =
          (current_setting('scoutmat_test.ica_authority_result')::jsonb
            ->> 'import_run_id')::uuid
    )
  )::text,
  true
);

select ok(
  exists (
    select 1
    from public.supplier_products
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and supplier_account_id =
        current_setting('scoutmat_test.ica_authority_account_id')::uuid
      and supplier_article_number = 'authority-2141387'
      and source_metadata -> 'ica_search_matches' @> jsonb_build_array(
        jsonb_build_object('query', 'Krossade tomater', 'rank', 0),
        jsonb_build_object('query', 'Tomater', 'rank', 1)
      )
      and source_metadata -> 'ica_completed_searches'
        @> jsonb_build_array('Krossade tomater', 'Tomater')
      and source_metadata ->> 'ica_refresh_date' = '2026-07-31'
  ),
  'overlapping same-day server batches merge their ICA search associations'
);

select public.publish_ica_catalogue_rows_service(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '11111111-1111-1111-1111-111111111111',
  'ica_public_webshop',
  '2026-07-31',
  jsonb_build_array('Krossade tomater'),
  '[]'::jsonb
);

select ok(
  exists (
    select 1
    from public.supplier_products
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and supplier_account_id =
        current_setting('scoutmat_test.ica_authority_account_id')::uuid
      and supplier_article_number = 'authority-2141387'
      and not (source_metadata -> 'ica_search_matches' @> jsonb_build_array(
        jsonb_build_object('query', 'Krossade tomater', 'rank', 0)
      ))
      and source_metadata -> 'ica_search_matches' @> jsonb_build_array(
        jsonb_build_object('query', 'Tomater', 'rank', 1)
      )
  ),
  'an empty successful search retires only its query association'
);

select public.publish_ica_catalogue_rows_service(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '11111111-1111-1111-1111-111111111111',
  'ica_public_webshop',
  '2026-07-31',
  jsonb_build_array('Krossade tomater'),
  (
    select jsonb_agg(jsonb_set(
      jsonb_set(
        jsonb_build_object(
          'source_row', import_row.source_row,
          'raw_data', import_row.raw_data,
          'normalized_data', import_row.normalized_data
        ),
        '{raw_data,retailer_product_id}',
        to_jsonb('authority-new-2141387'::text),
        false
      ),
      '{normalized_data,supplier_article_number}',
      to_jsonb('authority-new-2141387'::text),
      false
    ) order by import_row.source_row)
    from public.supplier_import_rows as import_row
    where import_row.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and import_row.import_run_id =
        (current_setting('scoutmat_test.ica_authority_result')::jsonb
          ->> 'import_run_id')::uuid
  )
);

select ok(
  exists (
    select 1
    from public.supplier_products
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and supplier_account_id =
        current_setting('scoutmat_test.ica_authority_account_id')::uuid
      and supplier_article_number = 'authority-2141387'
      and source_metadata -> 'ica_search_matches' @> jsonb_build_array(
        jsonb_build_object('query', 'Tomater', 'rank', 1)
      )
      and not (source_metadata -> 'ica_search_matches' @> jsonb_build_array(
        jsonb_build_object('query', 'Krossade tomater', 'rank', 0)
      ))
  )
  and exists (
    select 1
    from public.supplier_products
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and supplier_account_id =
        current_setting('scoutmat_test.ica_authority_account_id')::uuid
      and supplier_article_number = 'authority-new-2141387'
      and source_metadata -> 'ica_search_matches' @> jsonb_build_array(
        jsonb_build_object('query', 'Krossade tomater', 'rank', 0)
      )
  ),
  'a changed same-day result moves the query association to the returned article'
);

select set_config(
  'scoutmat_test.ica_next_day_result',
  public.publish_ica_catalogue_rows_service(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '11111111-1111-1111-1111-111111111111',
    'ica_public_webshop',
    '2026-08-01',
    jsonb_build_array('Krossade tomater'),
    (
      select jsonb_agg(jsonb_build_object(
        'source_row', import_row.source_row,
        'raw_data', import_row.raw_data,
        'normalized_data', import_row.normalized_data
      ) order by import_row.source_row)
      from public.supplier_import_rows as import_row
      where import_row.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
        and import_row.import_run_id =
          (current_setting('scoutmat_test.ica_authority_result')::jsonb
            ->> 'import_run_id')::uuid
    )
  )::text,
  true
);

select ok(
  (
    select count(*) = 4
    from public.supplier_import_runs
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and supplier_account_id =
        current_setting('scoutmat_test.ica_authority_account_id')::uuid
      and source_name = 'ica-kvantum-sickla-1004021'
  )
  and exists (
    select 1
    from public.supplier_products
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and supplier_account_id =
        current_setting('scoutmat_test.ica_authority_account_id')::uuid
      and supplier_article_number = 'authority-2141387'
      and latest_import_run_id =
        (current_setting('scoutmat_test.ica_next_day_result')::jsonb
          ->> 'import_run_id')::uuid
      and source_metadata ->> 'ica_refresh_date' = '2026-08-01'
  ),
  'an identical next-day response creates a fresh import and refreshes the product'
);

select set_config(
  'scoutmat_test.ica_empty_switch_result',
  public.publish_ica_catalogue_rows_service(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '11111111-1111-1111-1111-111111111111',
    'ica_local_fixture',
    '2026-08-01',
    jsonb_build_array('Testvara utan träff'),
    '[]'::jsonb
  )::text,
  true
);

select ok(
  current_setting('scoutmat_test.ica_empty_switch_result')::jsonb
    ->> 'status' = 'finalized'
  and not exists (
    select 1
    from public.supplier_products
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and supplier_account_id =
        current_setting('scoutmat_test.ica_authority_account_id')::uuid
      and active
      and source_metadata ->> 'source' = 'ica_public_webshop'
  ),
  'an empty completed source switch succeeds and retires opposite-channel products'
);

select throws_ok(
  $$
    select public.publish_ica_catalogue_rows_service(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      '99999999-9999-4999-8999-999999999999',
      'ica_public_webshop',
      '2026-07-31',
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'source_row', 1,
        'raw_data', '{}'::jsonb,
        'normalized_data', '{}'::jsonb
      ))
    )
  $$,
  '42501',
  'Active organization membership required',
  'the service RPC rejects an actor without active organization membership'
);

select throws_ok(
  $$
    select public.publish_ica_catalogue_rows_service(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      '11111111-1111-1111-1111-111111111111',
      'ica_public_webshop',
      '2026-07-31',
      jsonb_build_array('Krossade tomater'),
      jsonb_build_array(jsonb_build_object(
        'source_row', 1,
        'raw_data', '{}'::jsonb,
        'normalized_data', jsonb_build_object(
          'metadata', jsonb_build_object(
            'source', 'ica_local_fixture',
            'store_id', '1004021',
            'synthetic_local_fixture', true
          ),
          'packaging_metadata', jsonb_build_object(
            'normalization_version', 'ica-public-catalogue-v2'
          )
        )
      ))
    )
  $$,
  '22023',
  'ICA catalogue rows have invalid server provenance',
  'the service RPC rejects rows whose provenance disagrees with its channel'
);

select is(
  current_setting('request.jwt.claim.sub', true),
  '11111111-1111-1111-1111-111111111111',
  'the service RPC restores the request subject after acting for the member'
);

select * from finish();
rollback;
