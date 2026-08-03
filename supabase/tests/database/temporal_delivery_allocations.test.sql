begin;

create extension if not exists pgtap with schema extensions;
select plan(36);

-- A global order can cover every dated requirement, but largest remainder can
-- still put its last litre after the day that needs it.  Keep the fixture
-- independent of supplier matching: this is the manual whole-camp path.
insert into public.camps (
  id, organization_id, name, starts_on, ends_on, timezone, status, created_by
) values (
  'ca920000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Temporal allocation test camp',
  '2026-10-01', '2026-10-04', 'Europe/Stockholm', 'active',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.calculation_revisions (
  id, organization_id, camp_id, revision_number, status, input_digest,
  problem_summary, calculated_by
) values (
  'ca920000-0000-4000-8000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'ca920000-0000-4000-8000-000000000001', 1, 'current',
  public.camp_input_digest(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca920000-0000-4000-8000-000000000001'
  ), '{}'::jsonb, '11111111-1111-1111-1111-111111111111'
);

insert into public.supply_lists (
  id, organization_id, camp_id, calculation_revision_id, kind, status, title,
  range_start, range_end, list_key, source_present
) values
  ('ca920000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000002',
   'purchase', 'active', 'Hela lägret', null, null, 'purchase:temporal-milk', true),
  ('ca920000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000002',
   'delivery', 'active', 'Leverans 1', '2026-10-01 08:00:00+02', '2026-10-02 08:00:00+02', 'delivery:temporal-milk:1', true),
  ('ca920000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000002',
   'delivery', 'active', 'Leverans 2', '2026-10-02 08:00:00+02', '2026-10-03 08:00:00+02', 'delivery:temporal-milk:2', true),
  ('ca920000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000002',
   'delivery', 'active', 'Leverans 3', '2026-10-03 08:00:00+02', '2026-10-04 08:00:00+02', 'delivery:temporal-milk:3', true),
  ('ca920000-0000-4000-8000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000002',
   'delivery', 'active', 'Leverans 4', '2026-10-04 08:00:00+02', '2026-10-05 08:00:00+02', 'delivery:temporal-milk:4', true);

insert into public.supply_list_items (
  id, organization_id, camp_id, supply_list_id, item_key,
  category, item_name, required_amount, required_unit, ordered_amount,
  ordered_unit, package_note, order_source_kind, source_present
) values
  ('ca920000-0000-4000-8000-000000000011', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000003',
   'purchase:temporal-milk', 'Test', 'Mjölk', 45, 'l', 45, 'l',
   '45 × 1 l', 'manual', true),
  ('ca920000-0000-4000-8000-000000000012', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000004',
   'delivery:temporal-milk:1', 'Test', 'Mjölk', 10.9, 'l', null, null, null, null, true),
  ('ca920000-0000-4000-8000-000000000013', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000005',
   'delivery:temporal-milk:2', 'Test', 'Mjölk', 10.9, 'l', null, null, null, null, true),
  ('ca920000-0000-4000-8000-000000000014', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000006',
   'delivery:temporal-milk:3', 'Test', 'Mjölk', 12.5, 'l', null, null, null, null, true),
  ('ca920000-0000-4000-8000-000000000015', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000007',
   'delivery:temporal-milk:4', 'Test', 'Mjölk', 10.7, 'l', null, null, null, null, true);

select lives_ok(
  $$select public.sync_manual_purchase_delivery_allocations(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca920000-0000-4000-8000-000000000001',
    public.canonical_ingredient_key('Mjölk', 'l')
  )$$,
  'a manual whole-camp order can be allocated to dated deliveries'
);

select is(
  (
    select string_agg(trim_scale(item.ordered_amount)::text, '|' order by list.range_start)
      || '|' || trim_scale(sum(item.ordered_amount))::text
    from public.supply_list_items as item
    join public.supply_lists as list on list.id = item.supply_list_id
    where item.id between 'ca920000-0000-4000-8000-000000000012'
      and 'ca920000-0000-4000-8000-000000000015'
  ),
  '11|11|13|10|45',
  'a 45 l order covers dated needs chronologically without changing its total'
);

select ok(
  not exists (
    select 1
    from (
      select
        sum(item.ordered_amount) over (order by list.range_start) as allocated_through_date,
        sum(item.required_amount) over (order by list.range_start) as required_through_date
      from public.supply_list_items as item
      join public.supply_lists as list on list.id = item.supply_list_id
      where item.id between 'ca920000-0000-4000-8000-000000000012'
        and 'ca920000-0000-4000-8000-000000000015'
    ) as cumulative
    where cumulative.allocated_through_date < cumulative.required_through_date
  ),
  'no delivery date is under-covered by a later allocation'
);

select is(
  (
    select string_agg(coalesce(order_package_note, ''), '|' order by id)
    from public.supply_list_items
    where id between 'ca920000-0000-4000-8000-000000000012'
      and 'ca920000-0000-4000-8000-000000000015'
  ),
  '45 × 1 l|45 × 1 l|45 × 1 l|45 × 1 l',
  'the human whole-camp package description is retained separately from allocation'
);

select is(
  (
    select count(*)::integer
    from public.supply_list_items
    where id between 'ca920000-0000-4000-8000-000000000012'
      and 'ca920000-0000-4000-8000-000000000015'
      and package_note is null
  ),
  4,
  'automatic allocation does not overwrite a delivery package field with machine prose'
);

select set_config(
  'scoutmat_test.temporal_allocation_versions',
  (
    select string_agg(id::text || ':' || row_version::text, '|' order by id)
    from public.supply_list_items
    where id between 'ca920000-0000-4000-8000-000000000012'
      and 'ca920000-0000-4000-8000-000000000015'
  ),
  true
);

select lives_ok(
  $$select public.sync_manual_purchase_delivery_allocations(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca920000-0000-4000-8000-000000000001',
    public.canonical_ingredient_key('Mjölk', 'l')
  )$$,
  'a repeated temporal allocation sync is permitted'
);

select is(
  (
    select string_agg(id::text || ':' || row_version::text, '|' order by id)
    from public.supply_list_items
    where id between 'ca920000-0000-4000-8000-000000000012'
      and 'ca920000-0000-4000-8000-000000000015'
  ),
  current_setting('scoutmat_test.temporal_allocation_versions'),
  'a repeated temporal allocation sync is idempotent'
);

-- The verified ICA path uses whole purchase units, but must obey the same
-- dated availability rule.  One package below equals one litre.
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config(
  'scoutmat_test.temporal_supplier_account_id',
  public.ensure_ica_sickla_supplier_account('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')::text,
  true
);
select public.record_supplier_catalogue_search_states(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'ca920000-0000-4000-8000-000000000001',
  current_setting('scoutmat_test.temporal_supplier_account_id')::uuid,
  jsonb_build_array(jsonb_build_object(
    'canonical_key', public.canonical_ingredient_key('ICA tidsmjölk', 'l'),
    'search_query', 'ICA tidsmjölk',
    'search_date', (now() at time zone 'Europe/Stockholm')::date,
    'status', 'complete'
  ))
);
reset role;

insert into public.supplier_products (
  id, organization_id, supplier_account_id, supplier_article_number, display_name,
  purchase_unit, package_amount, package_unit, minimum_order_units, active,
  product_data_source, source_updated_at, source_metadata, packaging_metadata,
  created_by
) values (
  'ca920000-0000-4000-8000-000000000021',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.temporal_supplier_account_id')::uuid,
  'ICA-TEMPORAL-MILK', 'ICA mjölk 1 l', 'förpackning', 1, 'l', 1, true,
  'import:api', now(),
  jsonb_build_object(
    'source', 'ica_local_fixture',
    'store_id', '1004021',
    'synthetic_local_fixture', true,
    'ica_search_matches', jsonb_build_array(jsonb_build_object(
      'query', 'ICA tidsmjölk',
      'rank', 0
    ))
  ),
  jsonb_build_object('normalization_version', 'ica-public-catalogue-v2', 'package_dimension', 'volume'),
  '11111111-1111-1111-1111-111111111111'
);

select throws_ok(
  $$update public.supplier_products
    set source_metadata = jsonb_build_object(
      'source', 'ica_local_fixture',
      'store_id', '1004021',
      'synthetic_local_fixture', false
    )
    where id = 'ca920000-0000-4000-8000-000000000021'$$,
  '22023',
  'ICA supplier products must come from the configured store catalogue',
  'an unmarked local or generic fixture cannot become a trusted ICA product'
);

insert into public.supply_lists (
  id, organization_id, camp_id, calculation_revision_id, kind, status, title,
  range_start, range_end, list_key, source_present
) values
  ('ca920000-0000-4000-8000-000000000022', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000002',
   'purchase', 'active', 'ICA hela lägret', null, null, 'purchase:temporal-supplier-milk', true),
  ('ca920000-0000-4000-8000-000000000023', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000002',
   'delivery', 'active', 'ICA Leverans 1', '2026-10-01 08:00:00+02', '2026-10-02 08:00:00+02', 'delivery:temporal-supplier-milk:1', true),
  ('ca920000-0000-4000-8000-000000000024', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000002',
   'delivery', 'active', 'ICA Leverans 2', '2026-10-02 08:00:00+02', '2026-10-03 08:00:00+02', 'delivery:temporal-supplier-milk:2', true),
  ('ca920000-0000-4000-8000-000000000025', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000002',
   'delivery', 'active', 'ICA Leverans 3', '2026-10-03 08:00:00+02', '2026-10-04 08:00:00+02', 'delivery:temporal-supplier-milk:3', true),
  ('ca920000-0000-4000-8000-000000000026', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000002',
   'delivery', 'active', 'ICA Leverans 4', '2026-10-04 08:00:00+02', '2026-10-05 08:00:00+02', 'delivery:temporal-supplier-milk:4', true);

insert into public.supply_list_items (
  id, organization_id, camp_id, supply_list_id, item_key, category, item_name,
  required_amount, required_unit, ordered_amount, ordered_unit, package_note,
  source_present
) values
  ('ca920000-0000-4000-8000-000000000027', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000022',
   'purchase:temporal-supplier-milk', 'Test', 'ICA tidsmjölk', 45, 'l', 45, 'förpackning', '45 × 1 l', true),
  ('ca920000-0000-4000-8000-000000000028', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000023',
   'delivery:temporal-supplier-milk:1', 'Test', 'ICA tidsmjölk', 10.9, 'l', null, null, null, true),
  ('ca920000-0000-4000-8000-000000000029', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000024',
   'delivery:temporal-supplier-milk:2', 'Test', 'ICA tidsmjölk', 10.9, 'l', null, null, null, true),
  ('ca920000-0000-4000-8000-000000000030', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000025',
   'delivery:temporal-supplier-milk:3', 'Test', 'ICA tidsmjölk', 12.5, 'l', null, null, null, true),
  ('ca920000-0000-4000-8000-000000000031', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000026',
   'delivery:temporal-supplier-milk:4', 'Test', 'ICA tidsmjölk', 10.7, 'l', null, null, null, true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select public.replace_supplier_match_candidates(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.temporal_supplier_account_id')::uuid,
  'temporal-supplier-allocation-test',
  jsonb_build_array(jsonb_build_object(
    'canonical_key', public.canonical_ingredient_key('ICA tidsmjölk', 'l'),
    'supplier_product_id', 'ca920000-0000-4000-8000-000000000021',
    'status', 'review', 'score', 100, 'signals', '{}'::jsonb,
    'product_fingerprint', (select product_fingerprint from public.supplier_products where id = 'ca920000-0000-4000-8000-000000000021'),
    'required_unit', 'l', 'amount_per_purchase_unit', 1
  ))
);
select public.decide_supplier_match_candidate(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  (select id from public.supplier_match_candidates where matcher_version = 'temporal-supplier-allocation-test'),
  'accepted'
);
reset role;

-- The statement trigger invokes the supplier allocator after this order exists.
update public.supply_list_items
set ordered_amount = 45, ordered_unit = 'förpackning', package_note = '45 × 1 l'
where id = 'ca920000-0000-4000-8000-000000000027';

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select ok(
  (
    select supplier_ready_items >= 1
    from public.get_supplier_procurement_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca920000-0000-4000-8000-000000000001'
    )
  ),
  'a marked local ICA fixture participates in procurement readiness'
);
reset role;

select is(
  (
    select string_agg(trim_scale(item.ordered_amount)::text, '|' order by list.range_start)
      || '|' || trim_scale(sum(item.ordered_amount))::text
    from public.supply_list_items as item join public.supply_lists as list on list.id = item.supply_list_id
    where item.id between 'ca920000-0000-4000-8000-000000000028' and 'ca920000-0000-4000-8000-000000000031'
  ), '11|11|13|10|45', 'ICA whole packages cover dated requirements chronologically'
);

select ok(not exists (
  select 1 from (
    select sum(item.ordered_amount) over (order by list.range_start) as allocated,
      sum(item.required_amount) over (order by list.range_start) as required
    from public.supply_list_items as item join public.supply_lists as list on list.id = item.supply_list_id
    where item.id between 'ca920000-0000-4000-8000-000000000028' and 'ca920000-0000-4000-8000-000000000031'
  ) as cumulative where allocated < required
), 'ICA packages are never allocated after their dated need');

select is((select string_agg(coalesce(order_package_note, ''), '|' order by id) from public.supply_list_items
  where id between 'ca920000-0000-4000-8000-000000000028' and 'ca920000-0000-4000-8000-000000000031'),
  '45 × 1 l|45 × 1 l|45 × 1 l|45 × 1 l', 'ICA allocations retain the whole-camp package snapshot');

select is(
  (
    select count(*)::integer
    from public.supply_list_items
    where id between 'ca920000-0000-4000-8000-000000000028'
      and 'ca920000-0000-4000-8000-000000000031'
      and supplier_order_synthetic_fixture
  ),
  4,
  'delivery allocations retain explicit synthetic-fixture provenance for export warnings'
);

select set_config('scoutmat_test.temporal_supplier_versions', (select string_agg(id::text || ':' || row_version::text, '|' order by id)
  from public.supply_list_items where id between 'ca920000-0000-4000-8000-000000000028' and 'ca920000-0000-4000-8000-000000000031'), true);
select public.sync_supplier_order_delivery_allocations('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'ca920000-0000-4000-8000-000000000001', public.canonical_ingredient_key('ICA tidsmjölk', 'l'));
select is((select string_agg(id::text || ':' || row_version::text, '|' order by id) from public.supply_list_items
  where id between 'ca920000-0000-4000-8000-000000000028' and 'ca920000-0000-4000-8000-000000000031'),
  current_setting('scoutmat_test.temporal_supplier_versions'), 'a repeated ICA allocation sync is idempotent');

-- Surplus is real stock, not a reason to alter earlier delivery quantities.
-- It belongs to the final dated delivery where it is explicit and deterministic.
update public.supply_list_items
set ordered_amount = 46
where id = 'ca920000-0000-4000-8000-000000000011';

select is(
  (
    select string_agg(trim_scale(item.ordered_amount)::text, '|' order by list.range_start)
      || '|' || trim_scale(sum(item.ordered_amount))::text
    from public.supply_list_items as item join public.supply_lists as list on list.id = item.supply_list_id
    where item.id between 'ca920000-0000-4000-8000-000000000012' and 'ca920000-0000-4000-8000-000000000015'
  ),
  '11|11|13|11|46',
  'a genuine surplus is assigned only to the final dated delivery'
);

-- A delivery override is fixed operational input.  Count it on its own date,
-- then allocate only the still-uncovered cumulative requirement to automatic
-- rows.  The override itself must never be rewritten by a sync.
update public.supply_list_items
set
  ordered_amount = case
    when id = 'ca920000-0000-4000-8000-000000000011' then 45
    when id = 'ca920000-0000-4000-8000-000000000012' then 12
    else ordered_amount
  end,
  ordered_unit = case
    when id = 'ca920000-0000-4000-8000-000000000012' then 'l'
    else ordered_unit
  end,
  package_note = case
    when id = 'ca920000-0000-4000-8000-000000000012' then null
    else package_note
  end,
  order_package_note = case
    when id = 'ca920000-0000-4000-8000-000000000012' then null
    else order_package_note
  end,
  order_source_kind = case
    when id = 'ca920000-0000-4000-8000-000000000012' then 'manual'
    else order_source_kind
  end,
  manual_order_source_item_id = case
    when id = 'ca920000-0000-4000-8000-000000000012' then null
    else manual_order_source_item_id
  end,
  manual_order_total_amount = case
    when id = 'ca920000-0000-4000-8000-000000000012' then null
    else manual_order_total_amount
  end,
  manual_order_unit = case
    when id = 'ca920000-0000-4000-8000-000000000012' then null
    else manual_order_unit
  end
where id in (
  'ca920000-0000-4000-8000-000000000011',
  'ca920000-0000-4000-8000-000000000012'
);

select is(
  (
    select string_agg(
      trim_scale(ordered_amount)::text || ':' || ordered_unit || ':' || order_source_kind,
      '|' order by id
    )
    from public.supply_list_items
    where id between 'ca920000-0000-4000-8000-000000000012'
      and 'ca920000-0000-4000-8000-000000000015'
  ),
  '12:l:manual|10:l:manual_purchase|13:l:manual_purchase|10:l:manual_purchase',
  'an early compatible override is retained and counted at its actual date'
);

select ok(
  not exists (
    select 1
    from (
      select
        sum(ordered_amount) over (order by list.range_start) as allocated,
        sum(required_amount) over (order by list.range_start) as required
      from public.supply_list_items as item
      join public.supply_lists as list on list.id = item.supply_list_id
      where item.id between 'ca920000-0000-4000-8000-000000000012'
        and 'ca920000-0000-4000-8000-000000000015'
    ) as cumulative
    where cumulative.allocated < cumulative.required
  ),
  'an early manual override cannot defer stock needed by an earlier date'
);

-- A late override reduces the automatic budget.  Any genuine remainder is
-- placed on the last automatic date, not silently added to the manual row.
update public.supply_list_items
set
  ordered_amount = case
    when id = 'ca920000-0000-4000-8000-000000000012' then null
    when id = 'ca920000-0000-4000-8000-000000000015' then 9
    else ordered_amount
  end,
  ordered_unit = case
    when id = 'ca920000-0000-4000-8000-000000000012' then null
    when id = 'ca920000-0000-4000-8000-000000000015' then 'l'
    else ordered_unit
  end,
  package_note = case
    when id in (
      'ca920000-0000-4000-8000-000000000012',
      'ca920000-0000-4000-8000-000000000015'
    ) then null
    else package_note
  end,
  order_package_note = case
    when id in (
      'ca920000-0000-4000-8000-000000000012',
      'ca920000-0000-4000-8000-000000000015'
    ) then null
    else order_package_note
  end,
  order_source_kind = case
    when id = 'ca920000-0000-4000-8000-000000000012' then null
    when id = 'ca920000-0000-4000-8000-000000000015' then 'manual'
    else order_source_kind
  end,
  manual_order_source_item_id = case
    when id in (
      'ca920000-0000-4000-8000-000000000012',
      'ca920000-0000-4000-8000-000000000015'
    ) then null
    else manual_order_source_item_id
  end,
  manual_order_total_amount = case
    when id in (
      'ca920000-0000-4000-8000-000000000012',
      'ca920000-0000-4000-8000-000000000015'
    ) then null
    else manual_order_total_amount
  end,
  manual_order_unit = case
    when id in (
      'ca920000-0000-4000-8000-000000000012',
      'ca920000-0000-4000-8000-000000000015'
    ) then null
    else manual_order_unit
  end
where id in (
  'ca920000-0000-4000-8000-000000000012',
  'ca920000-0000-4000-8000-000000000015'
);

select is(
  (
    select string_agg(
      trim_scale(ordered_amount)::text || ':' || ordered_unit || ':' || order_source_kind,
      '|' order by id
    )
    from public.supply_list_items
    where id between 'ca920000-0000-4000-8000-000000000012'
      and 'ca920000-0000-4000-8000-000000000015'
  ),
  '11:l:manual_purchase|11:l:manual_purchase|14:l:manual_purchase|9:l:manual',
  'a late compatible override is retained while surplus goes to the last automatic date'
);

select is(
  (
    select trim_scale(sum(ordered_amount))::text
    from public.supply_list_items
    where id between 'ca920000-0000-4000-8000-000000000012'
      and 'ca920000-0000-4000-8000-000000000015'
  ),
  '45',
  'manual and automatic delivery allocations still equal the whole-camp order'
);

-- Unknown or incompatible override dimensions are not guessable.  Preserve
-- the manual row and clear every automatic sibling so the order is visibly
-- unresolved instead of executable with stale quantities.
update public.supply_list_items
set ordered_amount = 1, ordered_unit = 'mysterieenhet', order_source_kind = 'manual'
where id = 'ca920000-0000-4000-8000-000000000015';

select is(
  (
    select count(*)::integer
    from public.supply_list_items
    where id between 'ca920000-0000-4000-8000-000000000012'
      and 'ca920000-0000-4000-8000-000000000014'
      and ordered_amount is null
      and ordered_unit is null
      and order_source_kind is null
      and order_package_note is null
      and not supplier_order_synthetic_fixture
  ),
  3,
  'an incompatible manual override clears stale automatic manual-order allocations'
);

select is(
  (
    select trim_scale(ordered_amount)::text || ':' || ordered_unit || ':' || order_source_kind
    from public.supply_list_items
    where id = 'ca920000-0000-4000-8000-000000000015'
  ),
  '1:mysterieenhet:manual',
  'an unknown-dimension manual override is never mutated'
);

select is(
  public.sync_manual_purchase_delivery_allocations(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca920000-0000-4000-8000-000000000001',
    public.canonical_ingredient_key('Mjölk', 'l')
  ) ->> 'unresolved_source_count',
  '1',
  'manual-order sync reports an incompatible override as unresolved'
);

-- A finalised delivery is historical stock, even after a new calculation has
-- superseded its revision.  Count its frozen actual quantity at its original
-- date and allocate only the remaining order to current future deliveries.
update public.supply_list_items
set
  ordered_amount = null,
  ordered_unit = null,
  package_note = null,
  order_package_note = null,
  order_source_kind = null,
  manual_order_source_item_id = null,
  manual_order_total_amount = null,
  manual_order_unit = null
where id = 'ca920000-0000-4000-8000-000000000015';

update public.supply_list_items
set
  ordered_amount = 12,
  ordered_unit = 'l',
  package_note = null,
  order_package_note = null,
  order_source_kind = 'manual',
  manual_order_source_item_id = null,
  manual_order_total_amount = null,
  manual_order_unit = null
where id = 'ca920000-0000-4000-8000-000000000012';

insert into public.calculation_revisions (
  id, organization_id, camp_id, revision_number, status, input_digest,
  problem_summary, calculated_by
) values (
  'ca920000-0000-4000-8000-000000000040',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'ca920000-0000-4000-8000-000000000001',
  2, 'superseded', repeat('b', 64), '{}'::jsonb,
  '11111111-1111-1111-1111-111111111111'
);

update public.supply_lists
set
  calculation_revision_id = 'ca920000-0000-4000-8000-000000000040',
  status = 'complete'
where id = 'ca920000-0000-4000-8000-000000000004';

select set_config(
  'scoutmat_test.frozen_manual_delivery',
  (
    select id::text || ':' || row_version::text || ':'
      || trim_scale(ordered_amount)::text || ':' || ordered_unit || ':'
      || order_source_kind
    from public.supply_list_items
    where id = 'ca920000-0000-4000-8000-000000000012'
  ),
  true
);

update public.supply_list_items
set ordered_amount = 46
where id = 'ca920000-0000-4000-8000-000000000011';

select is(
  (
    select id::text || ':' || row_version::text || ':'
      || trim_scale(ordered_amount)::text || ':' || ordered_unit || ':'
      || order_source_kind
    from public.supply_list_items
    where id = 'ca920000-0000-4000-8000-000000000012'
  ),
  current_setting('scoutmat_test.frozen_manual_delivery'),
  'a completed delivery row remains byte-for-byte operationally frozen'
);

select is(
  (
    select string_agg(trim_scale(ordered_amount)::text, '|' order by id)
    from public.supply_list_items
    where id between 'ca920000-0000-4000-8000-000000000013'
      and 'ca920000-0000-4000-8000-000000000015'
  ),
  '10|13|11',
  'a completed older-revision delivery counts chronologically before current future deliveries'
);

-- Temporal safety is not provable without a date.  Fail closed and remove the
-- active automatic rows instead of using item-key order as a fake chronology.
update public.supply_lists
set range_start = null
where id = 'ca920000-0000-4000-8000-000000000007';

select is(
  public.sync_manual_purchase_delivery_allocations(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca920000-0000-4000-8000-000000000001',
    public.canonical_ingredient_key('Mjölk', 'l')
  ) ->> 'unresolved_source_count',
  '1',
  'a delivery row without a date makes the whole automatic allocation unresolved'
);

select is(
  (
    select count(*)::integer
    from public.supply_list_items
    where id between 'ca920000-0000-4000-8000-000000000013'
      and 'ca920000-0000-4000-8000-000000000015'
      and ordered_amount is null
      and order_source_kind is null
  ),
  3,
  'a missing delivery date clears every mutable automatic sibling'
);

update public.supply_lists
set range_start = '2026-10-04 08:00:00+02'
where id = 'ca920000-0000-4000-8000-000000000007';

-- Count-family overrides and automatic allocations are indivisible.  A
-- fractional manual count is retained for correction but makes automation
-- unresolved rather than legitimising fractional pieces.
insert into public.supply_list_items (
  id, organization_id, camp_id, supply_list_id, item_key,
  category, item_name, required_amount, required_unit, ordered_amount,
  ordered_unit, order_source_kind, source_present
) values
  ('ca920000-0000-4000-8000-000000000041', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000003',
   'purchase:temporal-count', 'Test', 'Temporal count', 5, 'st', 5, 'st', 'manual', true),
  ('ca920000-0000-4000-8000-000000000042', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000005',
   'delivery:temporal-count:1', 'Test', 'Temporal count', 2.2, 'st', null, null, null, true),
  ('ca920000-0000-4000-8000-000000000043', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'ca920000-0000-4000-8000-000000000001', 'ca920000-0000-4000-8000-000000000006',
   'delivery:temporal-count:2', 'Test', 'Temporal count', 2.8, 'st', null, null, null, true);

update public.supply_list_items
set
  ordered_amount = 1.5,
  ordered_unit = 'st',
  package_note = null,
  order_package_note = null,
  order_source_kind = 'manual',
  manual_order_source_item_id = null,
  manual_order_total_amount = null,
  manual_order_unit = null
where id = 'ca920000-0000-4000-8000-000000000042';

select is(
  (
    select trim_scale(ordered_amount)::text || ':' || ordered_unit || ':' || order_source_kind
    from public.supply_list_items
    where id = 'ca920000-0000-4000-8000-000000000042'
  ),
  '1.5:st:manual',
  'a fractional manual count remains visible for correction and is never mutated'
);

select is(
  public.sync_manual_purchase_delivery_allocations(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca920000-0000-4000-8000-000000000001',
    public.canonical_ingredient_key('Temporal count', 'st')
  ) ->> 'unresolved_source_count'
    || ':' || (
      select case when ordered_amount is null and order_source_kind is null
        then 'cleared' else 'stale' end
      from public.supply_list_items
      where id = 'ca920000-0000-4000-8000-000000000043'
    ),
  '1:cleared',
  'a fractional count override makes automatic count siblings unresolved'
);

-- Repeat the same invariants for verified ICA whole-package orders.
update public.supply_list_items
set
  ordered_amount = 12,
  ordered_unit = 'l',
  package_note = null,
  order_package_note = null,
  order_source_kind = 'manual',
  supplier_order_source_item_id = null,
  supplier_order_account_id = null,
  supplier_order_product_id = null,
  supplier_order_total_units = null,
  supplier_order_product_fingerprint = null
where id = 'ca920000-0000-4000-8000-000000000028';

select is(
  (
    select string_agg(
      trim_scale(ordered_amount)::text || ':' || ordered_unit || ':' || order_source_kind,
      '|' order by id
    )
    from public.supply_list_items
    where id between 'ca920000-0000-4000-8000-000000000028'
      and 'ca920000-0000-4000-8000-000000000031'
  ),
  '12:l:manual|10:förpackning:supplier_purchase|13:förpackning:supplier_purchase|10:förpackning:supplier_purchase',
  'an early compatible override is retained in the verified ICA allocation'
);

update public.supply_list_items
set
  ordered_amount = case
    when id = 'ca920000-0000-4000-8000-000000000028' then null
    when id = 'ca920000-0000-4000-8000-000000000031' then 9
    else ordered_amount
  end,
  ordered_unit = case
    when id = 'ca920000-0000-4000-8000-000000000028' then null
    when id = 'ca920000-0000-4000-8000-000000000031' then 'l'
    else ordered_unit
  end,
  package_note = case
    when id in (
      'ca920000-0000-4000-8000-000000000028',
      'ca920000-0000-4000-8000-000000000031'
    ) then null
    else package_note
  end,
  order_package_note = case
    when id in (
      'ca920000-0000-4000-8000-000000000028',
      'ca920000-0000-4000-8000-000000000031'
    ) then null
    else order_package_note
  end,
  order_source_kind = case
    when id = 'ca920000-0000-4000-8000-000000000028' then null
    when id = 'ca920000-0000-4000-8000-000000000031' then 'manual'
    else order_source_kind
  end,
  supplier_order_source_item_id = case
    when id in (
      'ca920000-0000-4000-8000-000000000028',
      'ca920000-0000-4000-8000-000000000031'
    ) then null
    else supplier_order_source_item_id
  end,
  supplier_order_account_id = case
    when id in (
      'ca920000-0000-4000-8000-000000000028',
      'ca920000-0000-4000-8000-000000000031'
    ) then null
    else supplier_order_account_id
  end,
  supplier_order_product_id = case
    when id in (
      'ca920000-0000-4000-8000-000000000028',
      'ca920000-0000-4000-8000-000000000031'
    ) then null
    else supplier_order_product_id
  end,
  supplier_order_total_units = case
    when id in (
      'ca920000-0000-4000-8000-000000000028',
      'ca920000-0000-4000-8000-000000000031'
    ) then null
    else supplier_order_total_units
  end,
  supplier_order_product_fingerprint = case
    when id in (
      'ca920000-0000-4000-8000-000000000028',
      'ca920000-0000-4000-8000-000000000031'
    ) then null
    else supplier_order_product_fingerprint
  end
where id in (
  'ca920000-0000-4000-8000-000000000028',
  'ca920000-0000-4000-8000-000000000031'
);

select is(
  (
    select string_agg(
      trim_scale(ordered_amount)::text || ':' || ordered_unit || ':' || order_source_kind,
      '|' order by id
    )
    from public.supply_list_items
    where id between 'ca920000-0000-4000-8000-000000000028'
      and 'ca920000-0000-4000-8000-000000000031'
  ),
  '11:förpackning:supplier_purchase|11:förpackning:supplier_purchase|14:förpackning:supplier_purchase|9:l:manual',
  'a late compatible override is retained while ICA surplus goes to the last automatic date'
);

update public.supply_list_items
set ordered_amount = 1, ordered_unit = 'kg', order_source_kind = 'manual'
where id = 'ca920000-0000-4000-8000-000000000031';

select is(
  (
    select count(*)::integer
    from public.supply_list_items
    where id between 'ca920000-0000-4000-8000-000000000028'
      and 'ca920000-0000-4000-8000-000000000030'
      and ordered_amount is null
      and ordered_unit is null
      and order_source_kind is null
      and order_package_note is null
      and not supplier_order_synthetic_fixture
  ),
  3,
  'an incompatible override clears stale automatic ICA allocations'
);

select is(
  public.sync_supplier_order_delivery_allocations(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca920000-0000-4000-8000-000000000001',
    public.canonical_ingredient_key('ICA tidsmjölk', 'l')
  ) ->> 'unresolved_source_count',
  '1',
  'supplier sync reports an incompatible override as unresolved'
);

update public.supply_list_items
set
  ordered_amount = null,
  ordered_unit = null,
  package_note = null,
  order_package_note = null,
  order_source_kind = null,
  supplier_order_source_item_id = null,
  supplier_order_account_id = null,
  supplier_order_product_id = null,
  supplier_order_total_units = null,
  supplier_order_product_fingerprint = null
where id = 'ca920000-0000-4000-8000-000000000031';

update public.supply_list_items
set
  ordered_amount = 12,
  ordered_unit = 'l',
  package_note = null,
  order_package_note = null,
  order_source_kind = 'manual',
  supplier_order_source_item_id = null,
  supplier_order_account_id = null,
  supplier_order_product_id = null,
  supplier_order_total_units = null,
  supplier_order_product_fingerprint = null,
  completed = true
where id = 'ca920000-0000-4000-8000-000000000028';

update public.supply_lists
set calculation_revision_id = 'ca920000-0000-4000-8000-000000000040'
where id = 'ca920000-0000-4000-8000-000000000023';

select set_config(
  'scoutmat_test.frozen_supplier_delivery',
  (
    select id::text || ':' || row_version::text || ':'
      || trim_scale(ordered_amount)::text || ':' || ordered_unit || ':'
      || order_source_kind
    from public.supply_list_items
    where id = 'ca920000-0000-4000-8000-000000000028'
  ),
  true
);

update public.supply_list_items
set ordered_amount = 46
where id = 'ca920000-0000-4000-8000-000000000027';

select is(
  (
    select id::text || ':' || row_version::text || ':'
      || trim_scale(ordered_amount)::text || ':' || ordered_unit || ':'
      || order_source_kind
    from public.supply_list_items
    where id = 'ca920000-0000-4000-8000-000000000028'
  ),
  current_setting('scoutmat_test.frozen_supplier_delivery'),
  'a checked ICA delivery row in an active list remains frozen across supplier reallocation'
);

select is(
  (
    select string_agg(trim_scale(ordered_amount)::text, '|' order by id)
    from public.supply_list_items
    where id between 'ca920000-0000-4000-8000-000000000029'
      and 'ca920000-0000-4000-8000-000000000031'
  ),
  '10|13|11',
  'a checked older-revision ICA delivery counts before current future deliveries'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.sync_manual_purchase_delivery_allocations_proportional_legacy(uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated callers cannot execute the legacy manual allocator'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.sync_supplier_order_delivery_allocations_proportional_legacy(uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated callers cannot execute the legacy supplier allocator'
);

select * from finish();
rollback;
