begin;

create extension if not exists pgtap with schema extensions;
select plan(32);

-- This fixture is isolated from the canonical demo and establishes a checked
-- row in an active delivery plus a separate completed delivery.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '71111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'completed-item@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into public.organizations (id, name, slug, created_by)
values ('72222222-2222-2222-2222-222222222222', 'Completed item test', 'completed-item-test', '71111111-1111-1111-1111-111111111111');
insert into public.camps (id, organization_id, name, starts_on, ends_on, created_by)
values ('73333333-3333-3333-3333-333333333333', '72222222-2222-2222-2222-222222222222', 'Completed item camp', '2026-08-02', '2026-08-03', '71111111-1111-1111-1111-111111111111');
insert into public.calculation_revisions (id, organization_id, camp_id, revision_number, status, input_digest, calculated_by)
values ('74444444-4444-4444-4444-444444444444', '72222222-2222-2222-2222-222222222222', '73333333-3333-3333-3333-333333333333', 1, 'current', repeat('a', 64), '71111111-1111-1111-1111-111111111111');
insert into public.supply_lists (id, organization_id, camp_id, calculation_revision_id, list_key, kind, status, title)
values
  ('75555555-5555-5555-5555-555555555551', '72222222-2222-2222-2222-222222222222', '73333333-3333-3333-3333-333333333333', '74444444-4444-4444-4444-444444444444', 'delivery:source', 'delivery', 'active', 'Source'),
  ('75555555-5555-5555-5555-555555555552', '72222222-2222-2222-2222-222222222222', '73333333-3333-3333-3333-333333333333', '74444444-4444-4444-4444-444444444444', 'delivery:target', 'delivery', 'active', 'Target'),
  ('75555555-5555-5555-5555-555555555553', '72222222-2222-2222-2222-222222222222', '73333333-3333-3333-3333-333333333333', '74444444-4444-4444-4444-444444444444', 'delivery:closed', 'delivery', 'active', 'Closed');
insert into public.supply_list_items (id, organization_id, camp_id, supply_list_id, item_key, category, item_name, required_amount, required_unit, ordered_amount, ordered_unit, package_note, comment, completed, source_line_keys)
values
  ('76666666-6666-6666-6666-666666666661', '72222222-2222-2222-2222-222222222222', '73333333-3333-3333-3333-333333333333', '75555555-5555-5555-5555-555555555551', 'delivery:checked', 'Test', 'Checked', 1, 'kg', 1, 'kg', '1 packet', 'received', true, '[]'),
  ('76666666-6666-6666-6666-666666666662', '72222222-2222-2222-2222-222222222222', '73333333-3333-3333-3333-333333333333', '75555555-5555-5555-5555-555555555553', 'delivery:closed', 'Test', 'Closed', 1, 'kg', 1, 'kg', null, null, false, '[]'),
  ('76666666-6666-6666-6666-666666666664', '72222222-2222-2222-2222-222222222222', '73333333-3333-3333-3333-333333333333', '75555555-5555-5555-5555-555555555551', 'delivery:offline-checked', 'Test', 'Offline checked', 2, 'l', 2, 'l', null, null, true, '[]');
update public.supply_lists set status = 'complete'
where id = '75555555-5555-5555-5555-555555555553';

set local role authenticated;
select set_config('request.jwt.claim.sub', '71111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claim.aal', 'aal2', true);

select throws_ok($$select public.move_delivery_item('76666666-6666-6666-6666-666666666661', '75555555-5555-5555-5555-555555555552', 1, 1, 'kg', 'changed', 'moved', true)$$,
  '22023', 'Completed delivery item must be reopened before moving', 'a checked delivery item cannot move');
select ok((select supply_list_id = '75555555-5555-5555-5555-555555555551'::uuid and row_version = 1 and completed and package_note = '1 packet' and comment = 'received' from public.supply_list_items where id = '76666666-6666-6666-6666-666666666661'), 'rejected move leaves the checked row unchanged');
select is((select count(*)::integer from public.audit_events where entity_id = '76666666-6666-6666-6666-666666666661'), 0, 'rejected move writes no audit event');
select throws_ok($$select public.move_delivery_item('76666666-6666-6666-6666-666666666661', '75555555-5555-5555-5555-555555555552', 1)$$,
  '22023', 'Completed delivery item must be reopened before moving', 'the compatibility move overload also rejects a checked item');

select throws_ok($$select public.update_supply_item('76666666-6666-6666-6666-666666666661', 1, 2, 'kg', 'changed', 'changed', true)$$,
  '22023', 'Completed delivery item must be reopened before it can be changed', 'a checked item cannot change order or comment while checked');
select ok((select ordered_amount = 1 and package_note = '1 packet' and comment = 'received' and completed and row_version = 1 from public.supply_list_items where id = '76666666-6666-6666-6666-666666666661'), 'rejected update leaves the checked row unchanged');
select is((select count(*)::integer from public.audit_events where entity_id = '76666666-6666-6666-6666-666666666661'), 0, 'rejected update writes no audit event');

select lives_ok($$select public.update_supply_item('76666666-6666-6666-6666-666666666661', 1, 1, 'kg', '1 packet', 'received', false)$$, 'the exact reopen-only update succeeds');
select ok((select not completed and row_version = 2 from public.supply_list_items where id = '76666666-6666-6666-6666-666666666661'), 'reopening changes only completion state and version');
select ok((select event.payload ->> 'previous_completed' = 'true' and event.payload ->> 'completed' = 'false' from public.audit_events event where event.entity_id = '76666666-6666-6666-6666-666666666661' order by event.id desc limit 1), 'reopen audit records the completion transition');

select throws_ok($$select public.move_delivery_item('76666666-6666-6666-6666-666666666662', '75555555-5555-5555-5555-555555555552', 1, 1, 'kg', '', '', false)$$,
  '22023', 'Completed source delivery cannot be changed', 'a completed source delivery rejects move');
select throws_ok($$select public.update_supply_item('76666666-6666-6666-6666-666666666662', 1, 1, 'kg', '', '', false)$$,
  '22023', 'Completed delivery cannot be changed', 'a completed source delivery rejects item update');
select is((public.apply_supply_item_mutation('72222222-2222-2222-2222-222222222222', '73333333-3333-3333-3333-333333333333', '76666666-6666-6666-6666-666666666662', '77777777-7777-7777-7777-777777777777', 1, '{"ordered_amount":1,"ordered_unit":"kg","package_note":null,"comment":null,"completed":false}', '{"completed":true}') ->> 'policy_reason'),
  'finalised_delivery', 'a completed source delivery turns an offline mutation into a resolvable policy conflict');
select is((select count(*)::integer from public.supply_item_mutations where item_id = '76666666-6666-6666-6666-666666666662' and status = 'conflict'), 1, 'the finalised-list policy conflict writes a replayable receipt');

select is((public.apply_supply_item_mutation('72222222-2222-2222-2222-222222222222', '73333333-3333-3333-3333-333333333333', '76666666-6666-6666-6666-666666666664', '77777777-7777-7777-7777-777777777778', 1, '{"ordered_amount":2,"ordered_unit":"l","package_note":null,"comment":null,"completed":true}', '{"completed":false}') ->> 'status'),
  'applied', 'an exact offline reopen is applied');
select ok((select not completed and row_version = 2 from public.supply_list_items where id = '76666666-6666-6666-6666-666666666664'), 'the offline reopen changes only completion state and version');
select ok((select event.payload ->> 'previous_completed' = 'true' and event.payload ->> 'completed' = 'false' and event.payload ->> 'reopened' = 'true' from public.audit_events event where event.entity_id = '76666666-6666-6666-6666-666666666664' order by event.id desc limit 1), 'offline reopen audit records the completed transition explicitly');

reset role;
update public.supply_list_items set completed = true, row_version = row_version + 1
where id = '76666666-6666-6666-6666-666666666664';
set local role authenticated;
select set_config('request.jwt.claim.sub', '71111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claim.aal', 'aal2', true);
select is((public.apply_supply_item_mutation('72222222-2222-2222-2222-222222222222', '73333333-3333-3333-3333-333333333333', '76666666-6666-6666-6666-666666666664', '77777777-7777-7777-7777-777777777779', 3, '{"ordered_amount":2,"ordered_unit":"l","package_note":null,"comment":null,"completed":true}', '{"completed":false,"comment":"move later"}') ->> 'policy_reason'),
  'reopen_required', 'a compound offline edit of a checked row becomes a resolvable reopen-required conflict');
select ok((select completed and comment is null and row_version = 3 from public.supply_list_items where id = '76666666-6666-6666-6666-666666666664'), 'the rejected compound offline edit leaves the checked row unchanged');
select is((select count(*)::integer from public.supply_item_mutations where item_id = '76666666-6666-6666-6666-666666666664' and status = 'conflict'), 1, 'the reopen-required conflict writes one replayable receipt');

select throws_ok($$select public.set_supply_list_status('75555555-5555-5555-5555-555555555553', 1, 'active')$$,
  '22023', 'Completed delivery cannot be reopened', 'the generic status RPC cannot silently reopen a finalised delivery');
select is((select count(*)::integer from public.audit_events where entity_id = '75555555-5555-5555-5555-555555555553'), 0, 'a rejected delivery reopen writes no false status audit event');

-- Background writers use set-based updates/upserts. They skip only finalised
-- delivery rows, while continuing to update active delivery rows.
reset role;
insert into public.supply_list_items (id, organization_id, camp_id, supply_list_id, item_key, category, item_name, required_amount, required_unit, source_line_keys)
values ('76666666-6666-6666-6666-666666666663', '72222222-2222-2222-2222-222222222222', '73333333-3333-3333-3333-333333333333', '75555555-5555-5555-5555-555555555552', 'delivery:active', 'Test', 'Active', 1, 'kg', '[]');
update public.supply_lists set source_present = false, version = version + 1
where id in ('75555555-5555-5555-5555-555555555552', '75555555-5555-5555-5555-555555555553');
select ok((select source_present and version = 1 from public.supply_lists where id = '75555555-5555-5555-5555-555555555553'), 'background regeneration leaves a completed delivery list byte-for-byte operationally unchanged');
select ok((select not source_present and version = 2 from public.supply_lists where id = '75555555-5555-5555-5555-555555555552'), 'background regeneration still updates a future active delivery list');
update public.supply_list_items set ordered_amount = 9, package_note = 'rewritten', source_present = false, row_version = row_version + 1
where id in ('76666666-6666-6666-6666-666666666662', '76666666-6666-6666-6666-666666666663', '76666666-6666-6666-6666-666666666664');
select ok((select ordered_amount = 1 and package_note is null and source_present and row_version = 1 from public.supply_list_items where id = '76666666-6666-6666-6666-666666666662'), 'allocation writers leave a completed delivery item byte-for-byte operationally unchanged');
select ok((select ordered_amount = 9 and package_note = 'rewritten' and not source_present and row_version = 2 from public.supply_list_items where id = '76666666-6666-6666-6666-666666666663'), 'allocation writers still update an active delivery item');
select ok((select ordered_amount = 2 and package_note is null and source_present and completed and row_version = 3 from public.supply_list_items where id = '76666666-6666-6666-6666-666666666664'), 'allocation writers leave a checked row in an active delivery unchanged');
update public.supply_list_items set supply_list_id = '75555555-5555-5555-5555-555555555553'
where id = '76666666-6666-6666-6666-666666666663';
select is((select supply_list_id from public.supply_list_items where id = '76666666-6666-6666-6666-666666666663'), '75555555-5555-5555-5555-555555555552'::uuid, 'a set-based writer cannot move an active row into a completed delivery');
delete from public.supply_list_items
where id in ('76666666-6666-6666-6666-666666666662', '76666666-6666-6666-6666-666666666664');
select is((select count(*)::integer from public.supply_list_items where id = '76666666-6666-6666-6666-666666666662'), 1, 'a background delete cannot remove an item from a completed delivery');
select is((select count(*)::integer from public.supply_list_items where id = '76666666-6666-6666-6666-666666666664'), 1, 'a background delete cannot remove a checked item from an active delivery');

delete from public.supply_lists
where id = '75555555-5555-5555-5555-555555555553';
select is((select count(*)::integer from public.supply_lists where id = '75555555-5555-5555-5555-555555555553'), 0, 'a canonical parent delete can remove a finalised delivery');
select is((select count(*)::integer from public.supply_list_items where id = '76666666-6666-6666-6666-666666666662'), 0, 'the finalised delivery child is removed by cascade cleanup');

select * from finish();
rollback;
