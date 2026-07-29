begin;

create extension if not exists pgtap with schema extensions;
select plan(35);

-- 1
select is(
  (
    select procedure.provolatile
    from pg_proc as procedure
    where procedure.oid =
      'public.canonical_ingredient_key(text,text)'::regprocedure
  ),
  'i'::"char",
  'canonical ingredient keys are produced by an immutable function'
);

-- 2
select is(
  public.canonical_ingredient_key('  Krossade   Tomater ', ' KG '),
  public.canonical_ingredient_key('krossade tomater', 'kg'),
  'canonical keys ignore surrounding whitespace, repeated whitespace and case'
);

-- 3
select isnt(
  public.canonical_ingredient_key('Krossade tomater', 'kg'),
  public.canonical_ingredient_key('Krossade tomater', 'st'),
  'the unit remains part of the canonical ingredient identity'
);

-- 4
select ok(
  public.canonical_ingredient_key('Gul lök', 'kg')
    ~ '^[0-9a-f]{64}$',
  'canonical keys are stable SHA-256 identifiers'
);

-- 5
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'recipe_ingredients',
        'calculation_lines',
        'supply_list_items'
      )
      and column_name = 'canonical_key'
      and is_generated = 'ALWAYS'
  ),
  3,
  'all three ingredient-bearing tables store generated canonical keys'
);

-- 6
select ok(
  not exists (
    select 1
    from public.recipe_ingredients as ingredient
    left join public.canonical_ingredients as canonical
      on canonical.organization_id = ingredient.organization_id
      and canonical.canonical_key = ingredient.canonical_key
    where ingredient.canonical_key is null
      or canonical.canonical_key is null
  ),
  'seeded recipe ingredients have propagated to the canonical catalogue'
);

-- 7
select ok(
  not exists (
    select 1
    from public.supply_list_items as item
    left join public.canonical_ingredients as canonical
      on canonical.organization_id = item.organization_id
      and canonical.canonical_key = item.canonical_key
    where item.canonical_key is null
      or canonical.canonical_key is null
  ),
  'seeded supply-list items have propagated to the canonical catalogue'
);

insert into public.calculation_lines (
  id,
  organization_id,
  camp_id,
  calculation_revision_id,
  meal_id,
  line_key,
  ingredient_key,
  ingredient_name,
  exact_amount,
  unit,
  trace
) values (
  'd9000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'a2000000-0000-0000-0000-000000000005',
  'a2000000-0000-0000-0000-000000000004',
  'test:testmorot',
  'test:testmorot',
  'Testmorot',
  4.5,
  'kg',
  '{}'::jsonb
);

-- 8
select is(
  (
    select canonical_key
    from public.calculation_lines
    where id = 'd9000000-0000-0000-0000-000000000001'
  ),
  public.canonical_ingredient_key('Testmorot', 'kg'),
  'new calculation lines receive their generated canonical key'
);

-- 9
select ok(
  exists (
    select 1
    from public.canonical_ingredients
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and canonical_key =
        public.canonical_ingredient_key('Testmorot', 'kg')
  ),
  'the calculation-line trigger synchronises new canonical ingredients'
);

insert into public.canonical_ingredients (
  organization_id,
  canonical_key,
  display_name,
  unit
) values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
  public.canonical_ingredient_key('Krossade tomater', 'kg'),
  'Krossade tomater',
  'kg'
);

-- 10
select is(
  (
    select count(*)::integer
    from public.canonical_ingredients
    where canonical_key =
      public.canonical_ingredient_key('Krossade tomater', 'kg')
  ),
  2,
  'the same canonical ingredient key can be represented per organisation'
);

-- 11
select ok(
  (
    select bool_and(relation.relrowsecurity)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'canonical_ingredients',
        'supplier_accounts',
        'supplier_products',
        'supplier_offers',
        'ingredient_supplier_matches'
      )
  ),
  'row-level security is enabled on every supplier foundation table'
);

-- 12
select ok(
  (
    select bool_and(
      has_table_privilege(
        'authenticated',
        format('public.%I', table_name),
        'SELECT'
      )
    )
    from unnest(array[
      'canonical_ingredients',
      'supplier_accounts',
      'supplier_products',
      'supplier_offers',
      'ingredient_supplier_matches'
    ]) as supplier_table(table_name)
  ),
  'authenticated users receive RLS-protected SELECT access'
);

-- 13
select ok(
  (
    select bool_and(
      not has_table_privilege(
        'authenticated',
        format('public.%I', table_name),
        'INSERT,UPDATE,DELETE'
      )
    )
    from unnest(array[
      'canonical_ingredients',
      'supplier_accounts',
      'supplier_products',
      'supplier_offers',
      'ingredient_supplier_matches'
    ]) as supplier_table(table_name)
  ),
  'authenticated users have no direct supplier-table write privileges'
);

-- 14
select ok(
  has_function_privilege(
    'authenticated',
    'public.save_supplier_account(uuid,text,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.save_supplier_product_match(uuid,text,uuid,text,text,text,numeric,text,numeric,text,text,integer,numeric,text,text,date,date)',
    'EXECUTE'
  ),
  'authenticated users can execute the bounded supplier write RPCs'
);

-- 15
select ok(
  not has_function_privilege(
    'anon',
    'public.save_supplier_account(uuid,text,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.save_supplier_product_match(uuid,text,uuid,text,text,text,numeric,text,numeric,text,text,integer,numeric,text,text,date,date)',
    'EXECUTE'
  ),
  'anonymous users cannot execute supplier write RPCs'
);

-- 16
select ok(
  not has_function_privilege(
    'service_role',
    'public.save_supplier_account(uuid,text,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.save_supplier_product_match(uuid,text,uuid,text,text,text,numeric,text,numeric,text,text,integer,numeric,text,text,date,date)',
    'EXECUTE'
  ),
  'the service role cannot bypass the authenticated supplier write surface'
);

-- 17
select ok(
  (
    select bool_and(
      procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
    )
    from pg_proc as procedure
    where procedure.oid in (
      'public.save_supplier_account(uuid,text,text,text)'::regprocedure,
      'public.save_supplier_product_match(uuid,text,uuid,text,text,text,numeric,text,numeric,text,text,integer,numeric,text,text,date,date)'::regprocedure
    )
  ),
  'supplier write RPCs are security-definer functions with empty search paths'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

select set_config(
  'scoutmat_test.account_a_id',
  public.save_supplier_account(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ICA',
    'ICA Nära Björkstad',
    '  KUND-42  '
  )::text,
  true
);

-- 18
select ok(
  current_setting('scoutmat_test.account_a_id')::uuid is not null,
  'an organisation member can save a supplier account through the RPC'
);

-- 19
select ok(
  exists (
    select 1
    from public.supplier_accounts
    where id = current_setting('scoutmat_test.account_a_id')::uuid
      and provider_key = 'ica'
      and customer_number = 'KUND-42'
      and active
      and created_by = '11111111-1111-1111-1111-111111111111'
  ),
  'the account RPC normalises input and records its authenticated creator'
);

-- 20
select throws_ok(
  $$insert into public.supplier_accounts (
      organization_id,
      provider_key,
      display_name,
      active,
      created_by
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'blocked',
      'Otillåten',
      true,
      '11111111-1111-1111-1111-111111111111'
    )$$,
  '42501',
  'permission denied for table supplier_accounts',
  'authenticated users cannot insert supplier accounts directly'
);

select set_config(
  'scoutmat_test.product_a_id',
  public.save_supplier_product_match(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    public.canonical_ingredient_key('Krossade tomater', 'kg'),
    current_setting('scoutmat_test.account_a_id')::uuid,
    'ICA-123',
    'Krossade tomater 6 x 2,5 kg',
    'kartong',
    15,
    'kg',
    15,
    'kg',
    '07350001234567',
    1,
    129.50,
    'sek',
    'available',
    current_date,
    current_date + 7
  )::text,
  true
);

-- 21
select ok(
  current_setting('scoutmat_test.product_a_id')::uuid is not null,
  'an organisation member can atomically save product, match and offer'
);

-- 22
select ok(
  exists (
    select 1
    from public.supplier_products
    where id = current_setting('scoutmat_test.product_a_id')::uuid
      and active
      and product_data_source = 'manual'
      and source_updated_at is not null
      and created_by = '11111111-1111-1111-1111-111111111111'
  ),
  'the product upsert records manual provenance and authenticated ownership'
);

-- 23
select ok(
  exists (
    select 1
    from public.ingredient_supplier_matches
    where supplier_product_id =
      current_setting('scoutmat_test.product_a_id')::uuid
      and required_unit = 'kg'
      and amount_per_purchase_unit = 15
      and approved_by = '11111111-1111-1111-1111-111111111111'
      and approved_at is not null
  ),
  'the ingredient match is explicitly approved by the authenticated member'
);

-- 24
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'supplier_products'
      and column_name = 'price'
  )
  and exists (
    select 1
    from public.supplier_offers
    where supplier_product_id =
      current_setting('scoutmat_test.product_a_id')::uuid
      and price = 129.50
      and currency = 'SEK'
  ),
  'customer-specific price is stored in an offer, not on the product'
);

select set_config(
  'scoutmat_test.product_a_second_id',
  public.save_supplier_product_match(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    public.canonical_ingredient_key('Krossade tomater', 'kg'),
    current_setting('scoutmat_test.account_a_id')::uuid,
    'ICA-123',
    'Krossade tomater 6 x 2,5 kg',
    'kartong',
    15,
    'kg',
    15,
    'kg',
    '07350001234567',
    1,
    119.00,
    'SEK',
    'available',
    current_date,
    current_date + 7
  )::text,
  true
);

-- 25
select is(
  current_setting('scoutmat_test.product_a_second_id')::uuid,
  current_setting('scoutmat_test.product_a_id')::uuid,
  're-saving a supplier article idempotently returns the same product'
);

-- 26
select ok(
  (
    select count(*) = 1 and min(price) = 119.00
    from public.supplier_offers
    where supplier_product_id =
      current_setting('scoutmat_test.product_a_id')::uuid
  ),
  're-saving the same offer period updates one separated price row'
);

-- 27
select throws_ok(
  format(
    $unit$
      select public.save_supplier_product_match(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        %L,
        %L,
        'ICA-UNIT-MISMATCH',
        'Krossade tomater styckvis',
        'låda',
        1,
        'st',
        1,
        'st'
      )
    $unit$,
    public.canonical_ingredient_key('Krossade tomater', 'kg'),
    current_setting('scoutmat_test.account_a_id')::uuid
  ),
  '22023',
  'Required unit does not match the canonical ingredient unit',
  'a product match cannot silently cross a required-unit boundary'
);

select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-4444-444444444444',
  true
);

select set_config(
  'scoutmat_test.planner_account_id',
  public.save_supplier_account(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'martin_servera',
    'Martin & Servera',
    null
  )::text,
  true
);

-- 28
select ok(
  exists (
    select 1
    from public.supplier_accounts
    where id = current_setting('scoutmat_test.planner_account_id')::uuid
      and created_by = '44444444-4444-4444-4444-444444444444'
  ),
  'an active planner membership is sufficient for the bounded account RPC'
);

-- 29
select set_config(
  'scoutmat_test.ica_store_a_id',
  public.save_supplier_account(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ica',
    'ICA Maxi Åsen',
    null
  )::text,
  true
);

select set_config(
  'scoutmat_test.ica_store_b_id',
  public.save_supplier_account(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ica',
    'ICA Nära Dalen',
    null
  )::text,
  true
);

select isnt(
  current_setting('scoutmat_test.ica_store_a_id')::uuid,
  current_setting('scoutmat_test.ica_store_b_id')::uuid,
  'an organisation can configure several stores for one provider without customer numbers'
);

select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222',
  true
);

select set_config(
  'scoutmat_test.account_b_id',
  public.save_supplier_account(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
    'menigo',
    'Menigo Sjövik',
    'B-9'
  )::text,
  true
);

-- 30
select is(
  (select count(*)::integer from public.supplier_accounts),
  1,
  'organisation B can read only its own supplier account'
);

-- 31
select is(
  (select count(*)::integer from public.canonical_ingredients),
  1,
  'organisation B can read only its own canonical ingredient catalogue'
);

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

-- 32
select is(
  (select count(*)::integer from public.supplier_accounts),
  4,
  'organisation A can read its four accounts without seeing organisation B'
);

-- 33
select throws_ok(
  format(
    $account$
      select public.save_supplier_product_match(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        %L,
        %L,
        'CROSS-TENANT',
        'Intrångsprodukt',
        'kartong',
        1,
        'kg',
        1,
        'kg'
      )
    $account$,
    public.canonical_ingredient_key('Krossade tomater', 'kg'),
    current_setting('scoutmat_test.account_b_id')::uuid
  ),
  '22023',
  'Supplier account does not belong to the organization',
  'a supplier product cannot be attached to another organisation account'
);

select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-3333-3333-333333333333',
  true
);

-- 34
select throws_ok(
  $$select public.save_supplier_account(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'unauthorised',
      'Ej medlem',
      null
    )$$,
  '42501',
  'Active organization membership required',
  'a signed-in user without membership cannot save a supplier account'
);

-- 35
select is(
  (select count(*)::integer from public.supplier_accounts),
  0,
  'a signed-in user without membership cannot read supplier accounts'
);

select * from finish();
rollback;
