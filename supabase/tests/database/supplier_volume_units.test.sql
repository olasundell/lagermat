begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

-- 1
select is(
  public.supplier_expected_amount(0.3, 'l', 'msk'),
  20::numeric,
  'the server converts litres to exact tablespoons'
);

-- 2
select is(
  public.supplier_expected_amount(0.3, 'l', 'tsk'),
  60::numeric,
  'the server converts litres to exact teaspoons'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

select set_config(
  'scoutmat_test.volume_account_id',
  public.save_supplier_account_identity(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca900000-0000-4000-8000-000000000001',
    'volume_unit_test',
    'Volume unit test supplier',
    null,
    null
  )::text,
  true
);

reset role;

insert into public.canonical_ingredients (
  organization_id,
  canonical_key,
  display_name,
  unit
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  public.canonical_ingredient_key(
    'Kycklingfond SQL volume test',
    'msk'
  ),
  'Kycklingfond SQL volume test',
  'msk'
) on conflict do nothing;

insert into public.supplier_products (
  id,
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
  created_by
) values (
  'ca900000-0000-4000-8000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.volume_account_id')::uuid,
  'VOLUME-180-ML',
  'Kycklingfond SQL volume test 180ml',
  'flaska',
  0.18,
  'l',
  1,
  true,
  'supplier_import',
  now(),
  '11111111-1111-1111-1111-111111111111'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

-- 3
select is(
  (
    public.replace_supplier_match_candidates(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      current_setting('scoutmat_test.volume_account_id')::uuid,
      'deterministic-volume-unit-test',
      jsonb_build_array(jsonb_build_object(
        'canonical_key',
          public.canonical_ingredient_key(
            'Kycklingfond SQL volume test',
            'msk'
          ),
        'supplier_product_id',
          'ca900000-0000-4000-8000-000000000002',
        'status', 'safe',
        'score', 97,
        'signals', '{}'::jsonb,
        'product_fingerprint',
          (
            select product_fingerprint
            from public.supplier_products
            where id = 'ca900000-0000-4000-8000-000000000002'
          ),
        'required_unit', 'msk',
        'amount_per_purchase_unit', 12
      ))
    ) ->> 'inserted_candidates'
  )::integer,
  1,
  'safe candidate replacement revalidates an exact tablespoon conversion'
);

select set_config(
  'scoutmat_test.volume_candidate_id',
  (
    select id::text
    from public.supplier_match_candidates
    where supplier_product_id =
      'ca900000-0000-4000-8000-000000000002'
      and matcher_version = 'deterministic-volume-unit-test'
      and status = 'safe'
  ),
  true
);

-- 4
select is(
  (
    public.approve_safe_supplier_match_candidates(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      current_setting('scoutmat_test.volume_account_id')::uuid,
      'deterministic-volume-unit-test',
      array[
        current_setting(
          'scoutmat_test.volume_candidate_id'
        )::uuid
      ]
    ) ->> 'approved_candidates'
  )::integer,
  1,
  'safe batch approval preserves the exact tablespoon purchase quantity'
);

reset role;

select * from finish();
rollback;
