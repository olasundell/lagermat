begin;

create extension if not exists pgtap with schema extensions;
select plan(36);

insert into public.camps (
  id,
  organization_id,
  name,
  starts_on,
  ends_on,
  timezone,
  status,
  created_by,
  meal_plan_confirmed_at,
  meal_plan_confirmed_by
) values (
  'ca910000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Supplier readiness test camp',
  '2026-09-01',
  '2026-09-01',
  'Europe/Stockholm',
  'active',
  '11111111-1111-1111-1111-111111111111',
  now(),
  '11111111-1111-1111-1111-111111111111'
);

insert into public.camp_recipe_copies (
  id,
  organization_id,
  camp_id,
  source_recipe_version_id,
  name,
  version_key,
  frozen_snapshot,
  copied_by
)
select
  'ca910000-0000-4000-8000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'ca910000-0000-4000-8000-000000000001',
  version.id,
  'Supplier readiness test recipe',
  'supplier-readiness-test-v1',
  '{}'::jsonb,
  '11111111-1111-1111-1111-111111111111'
from public.recipe_versions as version
where version.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  and version.status = 'published'
order by version.id
limit 1;

insert into public.camp_meal_slots (
  id,
  organization_id,
  camp_id,
  slot_key,
  service_date,
  starts_at,
  meal_type,
  label,
  service_status,
  source,
  sort_order
) values (
  'ca910000-0000-4000-8000-000000000003',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'ca910000-0000-4000-8000-000000000001',
  'supplier-readiness:lunch',
  '2026-09-01',
  '2026-09-01 12:00:00+02',
  'lunch',
  'Lunch',
  'required',
  'extra',
  10
);

insert into public.meals (
  id,
  organization_id,
  camp_id,
  camp_recipe_copy_id,
  meal_slot_id,
  starts_at,
  meal_type,
  title,
  status
) values (
  'ca910000-0000-4000-8000-000000000004',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'ca910000-0000-4000-8000-000000000001',
  'ca910000-0000-4000-8000-000000000002',
  'ca910000-0000-4000-8000-000000000003',
  '2026-09-01 12:00:00+02',
  'lunch',
  'Supplier readiness lunch',
  'ready'
);

-- Keep this fixture focused on supplier readiness. The shared readiness gate
-- now correctly rejects planned meals without either an active attendee or a
-- positive reserve, so give the test meal one in-scope participant.
insert into public.participants (
  id,
  organization_id,
  camp_id,
  display_name,
  lifecycle_status
) values (
  'ca910000-0000-4000-8000-000000000020',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'ca910000-0000-4000-8000-000000000001',
  'Supplier readiness participant',
  'active'
);

insert into public.participant_attendance (
  organization_id,
  camp_id,
  participant_id,
  starts_at,
  ends_at,
  active,
  source
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'ca910000-0000-4000-8000-000000000001',
  'ca910000-0000-4000-8000-000000000020',
  '2026-09-01 08:00:00+02',
  '2026-09-01 18:00:00+02',
  true,
  'local'
);

insert into public.calculation_revisions (
  id,
  organization_id,
  camp_id,
  revision_number,
  status,
  input_digest,
  problem_summary,
  calculated_by
) values (
  'ca910000-0000-4000-8000-000000000005',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'ca910000-0000-4000-8000-000000000001',
  1,
  'current',
  public.camp_input_digest(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001'
  ),
  '{}'::jsonb,
  '11111111-1111-1111-1111-111111111111'
);

insert into public.supply_lists (
  id,
  organization_id,
  camp_id,
  calculation_revision_id,
  kind,
  status,
  title,
  list_key,
  source_present
) values (
  'ca910000-0000-4000-8000-000000000006',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'ca910000-0000-4000-8000-000000000001',
  'ca910000-0000-4000-8000-000000000005',
  'purchase',
  'active',
  'Supplier readiness purchase list',
  'purchase:supplier-readiness-test',
  true
);

insert into public.supply_list_items (
  id,
  organization_id,
  camp_id,
  supply_list_id,
  item_key,
  category,
  item_name,
  required_amount,
  required_unit,
  source_present
) values (
  'ca910000-0000-4000-8000-000000000007',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'ca910000-0000-4000-8000-000000000001',
  'ca910000-0000-4000-8000-000000000006',
  'purchase:supplier-readiness-test:item',
  'Test',
  'Supplier readiness test ingredient',
  2,
  'kg',
  true
);

insert into public.supply_lists (
  id,
  organization_id,
  camp_id,
  calculation_revision_id,
  kind,
  status,
  title,
  range_start,
  range_end,
  list_key,
  source_present
) values
  (
    'ca910000-0000-4000-8000-000000000010',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001',
    'ca910000-0000-4000-8000-000000000005',
    'delivery',
    'active',
    'Supplier readiness delivery 1',
    '2026-09-01 08:00:00+02',
    '2026-09-02 08:00:00+02',
    'delivery:supplier-readiness-test:1',
    true
  ),
  (
    'ca910000-0000-4000-8000-000000000011',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001',
    'ca910000-0000-4000-8000-000000000005',
    'delivery',
    'active',
    'Supplier readiness delivery 2',
    '2026-09-02 08:00:00+02',
    '2026-09-03 08:00:00+02',
    'delivery:supplier-readiness-test:2',
    true
  );

insert into public.supply_list_items (
  id,
  organization_id,
  camp_id,
  supply_list_id,
  item_key,
  category,
  item_name,
  required_amount,
  required_unit,
  source_present
) values
  (
    'ca910000-0000-4000-8000-000000000012',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001',
    'ca910000-0000-4000-8000-000000000010',
    'delivery:supplier-readiness-test:1:item',
    'Test',
    'Supplier readiness test ingredient',
    1.25,
    'kg',
    true
  ),
  (
    'ca910000-0000-4000-8000-000000000013',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001',
    'ca910000-0000-4000-8000-000000000011',
    'delivery:supplier-readiness-test:2:item',
    'Test',
    'Supplier readiness test ingredient',
    0.75,
    'kg',
    true
  );

-- 1
select is(
  (
    select supplier_items_total::integer
    from public.get_supplier_procurement_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca910000-0000-4000-8000-000000000001'
    )
  ),
  null,
  'supplier readiness is not exposed without active membership'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

select set_config(
  'scoutmat_test.readiness_account_id',
  public.ensure_ica_sickla_supplier_account(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  )::text,
  true
);

-- 2
select is(
  (
    select supplier_items_total::integer
    from public.get_supplier_procurement_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca910000-0000-4000-8000-000000000001'
    )
  ),
  1,
  'one current positive purchase row participates in procurement readiness'
);

-- 3
select is(
  (
    select supplier_pending_items::integer
    from public.get_supplier_procurement_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca910000-0000-4000-8000-000000000001'
    )
  ),
  1,
  'an ingredient is pending until its ICA search has completed'
);

-- 4
select is(
  (
    select supplier_no_match::integer
    from public.get_supplier_procurement_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca910000-0000-4000-8000-000000000001'
    )
  ),
  0,
  'an unsearched ingredient is not reported as no match'
);

-- 5
select lives_ok(
  format(
    $query$
      select public.record_supplier_catalogue_search_states(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        'ca910000-0000-4000-8000-000000000001',
        %L::uuid,
        jsonb_build_array(jsonb_build_object(
          'canonical_key', (
            select canonical_key
            from public.supply_list_items
            where id = 'ca910000-0000-4000-8000-000000000007'
          ),
          'search_query', 'Supplier readiness test ingredient',
          'search_date', current_date,
          'status', 'complete',
          'retry_at', null,
          'last_error', null
        ))
      )
    $query$,
    current_setting('scoutmat_test.readiness_account_id')
  ),
  'an authenticated member can persist a completed ICA search'
);

-- 6
select is(
  (
    select supplier_pending_items::integer
    from public.get_supplier_procurement_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca910000-0000-4000-8000-000000000001'
    )
  ),
  0,
  'a completed ICA search leaves the pending count'
);

-- 7
select is(
  (
    select supplier_no_match::integer
    from public.get_supplier_procurement_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca910000-0000-4000-8000-000000000001'
    )
  ),
  1,
  'a completed search without a candidate is reported as no match'
);

-- 8
select is(
  (
    select supplier_unresolved_items::integer
    from public.get_supplier_procurement_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca910000-0000-4000-8000-000000000001'
    )
  ),
  1,
  'an unmatched ingredient keeps procurement unresolved'
);

-- 9
select is(
  (
    select procurement_ready
    from public.get_supplier_procurement_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca910000-0000-4000-8000-000000000001'
    )
  ),
  false,
  'procurement is not ready while an ingredient has no ICA decision'
);

-- 10
select is(
  (
    select can_finalize
    from public.get_camp_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca910000-0000-4000-8000-000000000001'
    )
  ),
  false,
  'the shared camp gate is not green while procurement is unresolved'
);

reset role;

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
  source_metadata,
  packaging_metadata,
  created_by
) values (
  'ca910000-0000-4000-8000-000000000008',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.readiness_account_id')::uuid,
  'ICA-READINESS-TEST',
  'Supplier readiness test ingredient 500g ICA',
  'förpackning',
  0.5,
  'kg',
  1,
  true,
  'import:api',
  now(),
  jsonb_build_object(
    'source', 'ica_public_webshop',
    'store_id', '1004021'
  ),
  jsonb_build_object(
    'normalization_version', 'ica-public-catalogue-v2',
    'package_dimension', 'mass'
  ),
  '11111111-1111-1111-1111-111111111111'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

select public.replace_supplier_match_candidates(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.readiness_account_id')::uuid,
  'deterministic-procurement-readiness-test',
  jsonb_build_array(jsonb_build_object(
    'canonical_key',
      public.canonical_ingredient_key(
        'Supplier readiness test ingredient',
        'kg'
      ),
    'supplier_product_id',
      'ca910000-0000-4000-8000-000000000008',
    'status', 'review',
    'score', 80,
    'signals', '{}'::jsonb,
    'product_fingerprint',
      (
        select product_fingerprint
        from public.supplier_products
        where id = 'ca910000-0000-4000-8000-000000000008'
      ),
    'required_unit', 'kg',
    'amount_per_purchase_unit', 0.5
  ))
);

select set_config(
  'scoutmat_test.readiness_candidate_id',
  (
    select id::text
    from public.supplier_match_candidates
    where supplier_product_id =
      'ca910000-0000-4000-8000-000000000008'
      and matcher_version =
        'deterministic-procurement-readiness-test'
      and status = 'review'
  ),
  true
);

-- 11
select is(
  (
    select supplier_review_suggestions::integer
    from public.get_supplier_procurement_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca910000-0000-4000-8000-000000000001'
    )
  ),
  1,
  'a review candidate is reported separately from no match'
);

-- 12
select is(
  (
    select supplier_no_match::integer
    from public.get_supplier_procurement_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca910000-0000-4000-8000-000000000001'
    )
  ),
  0,
  'a review candidate is not also counted as no match'
);

select public.decide_supplier_match_candidate(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  current_setting('scoutmat_test.readiness_candidate_id')::uuid,
  'accepted'
);

-- 13
select is(
  (
    select supplier_order_incomplete::integer
    from public.get_supplier_procurement_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca910000-0000-4000-8000-000000000001'
    )
  ),
  1,
  'an approved ICA product still requires a whole purchase-unit order'
);

-- 14
select is(
  (
    select supplier_review_suggestions::integer
    from public.get_supplier_procurement_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca910000-0000-4000-8000-000000000001'
    )
  ),
  0,
  'an accepted candidate leaves the review queue'
);

-- 15
select throws_ok(
  $$
    select public.set_supply_list_status(
      'ca910000-0000-4000-8000-000000000006',
      1,
      'complete'
    )
  $$,
  '22023',
  'Camp readiness must be complete before final status',
  'the server rejects final status while the approved order lacks a quantity'
);

reset role;

update public.supply_list_items
set
  ordered_amount = 4,
  ordered_unit = 'förpackning',
  package_note = '4 förpackningar à 500 g',
  completed = true
where id = 'ca910000-0000-4000-8000-000000000007';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

-- 16
select is(
  (
    select
      supplier_ready_items::text
        || '|'
        || supplier_unresolved_items::text
        || '|'
        || procurement_ready::text
    from public.get_supplier_procurement_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca910000-0000-4000-8000-000000000001'
    )
  ),
  '1|0|true',
  'a whole purchase-unit order resolves procurement'
);

-- 17
select is(
  (
    select
      string_agg(
        trim_scale(item.ordered_amount)::text,
        '|'
        order by list.range_start
      )
      || '|'
      || trim_scale(sum(item.ordered_amount))::text
    from public.supply_list_items as item
    join public.supply_lists as list
      on list.id = item.supply_list_id
    where item.id in (
      'ca910000-0000-4000-8000-000000000012',
      'ca910000-0000-4000-8000-000000000013'
    )
  ),
  '3|1|4',
  'the global whole-package order is proportionally allocated without per-delivery over-rounding'
);

-- 18
select is(
  (
    select
      count(*) filter (
        where order_source_kind = 'supplier_purchase'
          and supplier_order_source_item_id =
            'ca910000-0000-4000-8000-000000000007'
          and supplier_order_account_id =
            current_setting(
              'scoutmat_test.readiness_account_id'
            )::uuid
          and supplier_order_product_id =
            'ca910000-0000-4000-8000-000000000008'
          and supplier_order_total_units = 4
      )::text
      || '|'
      || count(*)::text
    from public.supply_list_items
    where id in (
      'ca910000-0000-4000-8000-000000000012',
      'ca910000-0000-4000-8000-000000000013'
    )
  ),
  '2|2',
  'each delivery allocation retains its verified ICA product and purchase-row provenance'
);

-- 19
select ok(
  (
    select bool_and(
      package_note like '%av totalt 4 förpackningar%'
      and package_note not like '%.000000%'
      and package_note like '%0,5 kg/förpackning%'
      and package_note like '%ICA-READINESS-TEST%'
    )
    from public.supply_list_items
    where id in (
      'ca910000-0000-4000-8000-000000000012',
      'ca910000-0000-4000-8000-000000000013'
    )
  ),
  'delivery rows explain their package share, size and ICA article'
);

-- 20
select ok(
  exists (
    select 1
    from public.audit_events
    where organization_id =
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and event_type =
        'supplier_order_allocated_to_deliveries'
      and entity_id =
        'ca910000-0000-4000-8000-000000000001'
  ),
  'automatic delivery allocation creates an audit event'
);

-- 21
select is(
  (
    select can_finalize
    from public.get_camp_readiness(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ca910000-0000-4000-8000-000000000001'
    )
  ),
  true,
  'the shared camp gate becomes green only after procurement is ready'
);

-- 22
select is(
  public.set_supply_list_status(
    'ca910000-0000-4000-8000-000000000006',
    1,
    'complete'
  ),
  2::bigint,
  'the server permits final status after the ICA order is complete'
);

reset role;

insert into public.supply_lists (
  id, organization_id, camp_id, calculation_revision_id, kind, status,
  title, range_start, range_end, list_key, source_present
) values
  (
    'ca910000-0000-4000-8000-000000000020',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001',
    'ca910000-0000-4000-8000-000000000005',
    'delivery', 'active', 'Manual allocation delivery 1',
    '2026-09-03 08:00:00+02', '2026-09-04 08:00:00+02',
    'delivery:manual-allocation-test:1', true
  ),
  (
    'ca910000-0000-4000-8000-000000000021',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001',
    'ca910000-0000-4000-8000-000000000005',
    'delivery', 'active', 'Manual allocation delivery 2',
    '2026-09-04 08:00:00+02', '2026-09-05 08:00:00+02',
    'delivery:manual-allocation-test:2', true
  );

insert into public.supply_list_items (
  id, organization_id, camp_id, supply_list_id, item_key, category, item_name,
  required_amount, required_unit, source_present
) values
  (
    'ca910000-0000-4000-8000-000000000022',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001',
    'ca910000-0000-4000-8000-000000000006',
    'purchase:manual-milk', 'Test', 'Manual allocation milk', 45, 'l', true
  ),
  (
    'ca910000-0000-4000-8000-000000000023',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001',
    'ca910000-0000-4000-8000-000000000020',
    'delivery:manual-milk:1', 'Test', 'Manual allocation milk', 17.3, 'l', true
  ),
  (
    'ca910000-0000-4000-8000-000000000024',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001',
    'ca910000-0000-4000-8000-000000000021',
    'delivery:manual-milk:2', 'Test', 'Manual allocation milk', 27.7, 'l', true
  );

set local role authenticated;

-- 23
select is(
  public.apply_supply_item_mutation(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001',
    'ca910000-0000-4000-8000-000000000022',
    'ca910000-0000-4000-8000-000000000031',
    1,
    '{"ordered_amount":null,"ordered_unit":null,"package_note":null,"comment":null,"completed":false}'::jsonb,
    '{"ordered_amount":45,"ordered_unit":"l"}'::jsonb
  ) ->> 'server_version',
  '2',
  'an offline-capable whole-camp litre order becomes a manual source'
);

-- 24
select is(
  (
    select string_agg(trim_scale(ordered_amount)::text, '|' order by id)
      || '|' || trim_scale(sum(ordered_amount))::text
    from public.supply_list_items
    where id in (
      'ca910000-0000-4000-8000-000000000023',
      'ca910000-0000-4000-8000-000000000024'
    )
  ),
  '17|28|45',
  '45 l is allocated once across deliveries with stable largest remainder'
);

-- 25
select is(
  (
    select count(*) filter (
      where order_source_kind = 'manual_purchase'
        and manual_order_source_item_id = 'ca910000-0000-4000-8000-000000000022'
        and manual_order_total_amount = 45
        and manual_order_unit = 'l'
    )::text || '|' || count(*)::text
    from public.supply_list_items
    where id in (
      'ca910000-0000-4000-8000-000000000023',
      'ca910000-0000-4000-8000-000000000024'
    )
  ),
  '2|2',
  'manual delivery allocations retain the exact global-order provenance'
);

-- A new delivery row is what regeneration produces after the source order exists.
reset role;

insert into public.supply_lists (
  id, organization_id, camp_id, calculation_revision_id, kind, status,
  title, range_start, range_end, list_key, source_present
) values (
  'ca910000-0000-4000-8000-000000000025',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'ca910000-0000-4000-8000-000000000001',
  'ca910000-0000-4000-8000-000000000005',
  'delivery', 'active', 'Manual allocation regenerated delivery',
  '2026-09-05 08:00:00+02', '2026-09-06 08:00:00+02',
  'delivery:manual-allocation-test:regenerated', true
);

insert into public.supply_list_items (
  id, organization_id, camp_id, supply_list_id, item_key, category, item_name,
  required_amount, required_unit, source_present
) values (
  'ca910000-0000-4000-8000-000000000026',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'ca910000-0000-4000-8000-000000000001',
  'ca910000-0000-4000-8000-000000000025',
  'delivery:manual-milk:regenerated', 'Test', 'Manual allocation milk', 5, 'l', true
);

set local role authenticated;

-- 26
select is(
  (
    select string_agg(trim_scale(ordered_amount)::text, '|' order by id)
      || '|' || trim_scale(sum(ordered_amount))::text
    from public.supply_list_items
    where id in (
      'ca910000-0000-4000-8000-000000000023',
      'ca910000-0000-4000-8000-000000000024',
      'ca910000-0000-4000-8000-000000000026'
    )
  ),
  '16|25|4|45',
  'a regenerated delivery row reuses the global order without changing its total'
);

select set_config(
  'scoutmat_test.manual_allocation_idempotence',
  (select string_agg(id::text || ':' || row_version::text, '|' order by id)
    from public.supply_list_items
    where id in (
      'ca910000-0000-4000-8000-000000000023',
      'ca910000-0000-4000-8000-000000000024',
      'ca910000-0000-4000-8000-000000000026'
    ))
    || '|audit:' || (select count(*)::text
      from public.audit_events
      where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
        and event_type = 'manual_purchase_allocated_to_deliveries'),
  true
);

reset role;

-- 27
select lives_ok(
  $$select public.sync_manual_purchase_delivery_allocations(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001',
    null
  )$$,
  'a second manual allocation sync is permitted'
);

-- 28
select is(
  (select string_agg(id::text || ':' || row_version::text, '|' order by id)
    from public.supply_list_items
    where id in (
      'ca910000-0000-4000-8000-000000000023',
      'ca910000-0000-4000-8000-000000000024',
      'ca910000-0000-4000-8000-000000000026'
    ))
    || '|audit:' || (select count(*)::text
      from public.audit_events
      where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
        and event_type = 'manual_purchase_allocated_to_deliveries'),
  current_setting('scoutmat_test.manual_allocation_idempotence'),
  'a repeated sync does not change allocated delivery row versions or create another audit event'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

-- 29
select is(
  public.update_supply_item(
    'ca910000-0000-4000-8000-000000000023', 3, 10, 'l', '', '', false
  ),
  4::bigint,
  'a delivery can override its assigned share manually'
);

-- 30
select is(
  (
    select string_agg(trim_scale(ordered_amount)::text, '|' order by id)
      || '|' || trim_scale(sum(ordered_amount))::text
    from public.supply_list_items
    where id in (
      'ca910000-0000-4000-8000-000000000023',
      'ca910000-0000-4000-8000-000000000024',
      'ca910000-0000-4000-8000-000000000026'
    )
  ),
  '10|30|5|45',
  'a manual delivery override is deducted before the remaining global order is allocated'
);

-- 31
select is(
  public.update_supply_item(
    'ca910000-0000-4000-8000-000000000022', 2, 45, 'paket', '', '', false
  ),
  3::bigint,
  'a source order can be changed to an incompatible package unit'
);

-- 32
select is(
  (
    select count(*) filter (where ordered_amount is null)::text
    from public.supply_list_items
    where id in (
      'ca910000-0000-4000-8000-000000000024',
      'ca910000-0000-4000-8000-000000000026'
    )
  ),
  '2',
  'incompatible package-to-volume conversion clears automatic shares instead of inventing quantities'
);

-- 33
select ok(
  exists (
    select 1
    from public.audit_events
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and event_type = 'manual_purchase_allocated_to_deliveries'
      and entity_id = 'ca910000-0000-4000-8000-000000000001'
  ),
  'manual allocation changes are audited'
);

reset role;

insert into public.supply_list_items (
  id, organization_id, camp_id, supply_list_id, item_key, category, item_name,
  required_amount, required_unit, source_present
) values
  (
    'ca910000-0000-4000-8000-000000000027',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001',
    'ca910000-0000-4000-8000-000000000006',
    'purchase:manual-package-mismatch', 'Test', 'Manual package mismatch', 6, 'kg', true
  ),
  (
    'ca910000-0000-4000-8000-000000000028',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001',
    'ca910000-0000-4000-8000-000000000020',
    'delivery:manual-package-mismatch', 'Test', 'Manual package mismatch', 6, 'kg', true
  ),
  (
    'ca910000-0000-4000-8000-000000000029',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001',
    'ca910000-0000-4000-8000-000000000006',
    'purchase:manual-count-mismatch', 'Test', 'Manual count mismatch', 6, 'burk', true
  ),
  (
    'ca910000-0000-4000-8000-000000000030',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'ca910000-0000-4000-8000-000000000001',
    'ca910000-0000-4000-8000-000000000021',
    'delivery:manual-count-mismatch', 'Test', 'Manual count mismatch', 6, 'burk', true
  );

set local role authenticated;

-- 34
select is(
  public.update_supply_item(
    'ca910000-0000-4000-8000-000000000027', 1, 6, 'paket', '', '', false
  ),
  2::bigint,
  'a package order for a weight requirement remains a manual global source'
);

-- 35
select is(
  public.update_supply_item(
    'ca910000-0000-4000-8000-000000000029', 1, 6, 'flaska', '', '', false
  ),
  2::bigint,
  'a bottle order for a tin requirement remains a manual global source'
);

-- 36
select is(
  (
    select
      count(*) filter (
        where order_source_kind = 'manual'
          and ordered_amount = 6
          and ordered_unit in ('paket', 'flaska')
      )::text
      || '|'
      || count(*) filter (where ordered_amount is null)::text
    from public.supply_list_items
    where id in (
      'ca910000-0000-4000-8000-000000000027',
      'ca910000-0000-4000-8000-000000000028',
      'ca910000-0000-4000-8000-000000000029',
      'ca910000-0000-4000-8000-000000000030'
    )
  ),
  '2|2',
  'package-to-weight and bottle-to-tin mismatches do not create automatic delivery quantities'
);

select * from finish();
rollback;
