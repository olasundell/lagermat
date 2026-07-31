create function public.get_supplier_procurement_readiness(
  p_organization_id uuid,
  p_camp_id uuid
)
returns table (
  supplier_items_total bigint,
  supplier_ready_items bigint,
  supplier_safe_suggestions bigint,
  supplier_review_suggestions bigint,
  supplier_no_match bigint,
  supplier_order_incomplete bigint,
  supplier_unresolved_items bigint,
  procurement_ready boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with ica_account as (
    select account.id
    from public.supplier_accounts as account
    where account.organization_id = p_organization_id
      and account.provider_key = 'ica'
      and account.provider_location_id = '1004021'
      and account.active
    limit 1
  ),
  purchase_items as (
    select item.*
    from public.supply_lists as list
    join public.calculation_revisions as revision
      on revision.organization_id = list.organization_id
     and revision.camp_id = list.camp_id
     and revision.id = list.calculation_revision_id
     and revision.status = 'current'
    join public.supply_list_items as item
      on item.organization_id = list.organization_id
     and item.camp_id = list.camp_id
     and item.supply_list_id = list.id
    where list.organization_id = p_organization_id
      and list.camp_id = p_camp_id
      and list.kind = 'purchase'
      and list.source_present
      and item.source_present
      and item.required_amount > 0
  ),
  item_state as (
    select
      item.id,
      product.id is not null as has_preferred,
      coalesce(candidate.has_safe, false) as has_safe,
      coalesce(candidate.has_review, false) as has_review,
      product.id is not null
        and item.ordered_amount is not null
        and item.ordered_amount > 0
        and nullif(trim(item.ordered_unit), '') is not null
        and lower(trim(item.ordered_unit))
          = lower(trim(product.purchase_unit)) as ready
    from purchase_items as item
    left join ica_account as account on true
    left join public.preferred_supplier_matches as preferred
      on preferred.organization_id = item.organization_id
     and preferred.canonical_key = item.canonical_key
     and preferred.supplier_account_id = account.id
    left join public.ingredient_supplier_matches as match
      on match.organization_id = preferred.organization_id
     and match.id = preferred.ingredient_supplier_match_id
     and match.canonical_key = preferred.canonical_key
     and match.supplier_account_id = preferred.supplier_account_id
     and match.supplier_product_id = preferred.supplier_product_id
     and match.approved_by is not null
     and match.approved_at is not null
    left join public.supplier_products as product
      on product.organization_id = preferred.organization_id
     and product.supplier_account_id = preferred.supplier_account_id
     and product.id = preferred.supplier_product_id
     and product.id = match.supplier_product_id
     and product.active
     and product.product_fingerprint
       = match.approved_product_fingerprint
     and product.product_data_source = 'import:api'
     and product.source_metadata @> jsonb_build_object(
       'source', 'ica_public_webshop',
       'store_id', '1004021'
     )
     and product.packaging_metadata @> jsonb_build_object(
       'normalization_version', 'ica-public-catalogue-v2'
     )
    left join lateral (
      select
        coalesce(bool_or(open.status = 'safe'), false) as has_safe,
        coalesce(bool_or(open.status = 'review'), false) as has_review
      from public.supplier_match_candidates as open
      join public.supplier_products as candidate_product
        on candidate_product.organization_id = open.organization_id
       and candidate_product.supplier_account_id
         = open.supplier_account_id
       and candidate_product.id = open.supplier_product_id
       and candidate_product.active
       and candidate_product.product_fingerprint
         = open.product_fingerprint
      where open.organization_id = item.organization_id
        and open.supplier_account_id = account.id
        and open.canonical_key = item.canonical_key
        and open.status in ('safe', 'review')
    ) as candidate on true
  ),
  readiness as (
    select
      count(*) as supplier_items_total,
      count(*) filter (where state.ready) as supplier_ready_items,
      count(*) filter (
        where not state.has_preferred and state.has_safe
      ) as supplier_safe_suggestions,
      count(*) filter (
        where not state.has_preferred
          and not state.has_safe
          and state.has_review
      ) as supplier_review_suggestions,
      count(*) filter (
        where not state.has_preferred
          and not state.has_safe
          and not state.has_review
      ) as supplier_no_match,
      count(*) filter (
        where state.has_preferred and not state.ready
      ) as supplier_order_incomplete,
      count(*) filter (where not state.ready) as supplier_unresolved_items
    from item_state as state
  )
  select
    readiness.supplier_items_total,
    readiness.supplier_ready_items,
    readiness.supplier_safe_suggestions,
    readiness.supplier_review_suggestions,
    readiness.supplier_no_match,
    readiness.supplier_order_incomplete,
    readiness.supplier_unresolved_items,
    readiness.supplier_items_total = 0
      or readiness.supplier_unresolved_items = 0
  from readiness
  where public.is_org_member(p_organization_id);
$$;

revoke all on function public.get_supplier_procurement_readiness(uuid, uuid)
  from public, anon;
grant execute on function public.get_supplier_procurement_readiness(uuid, uuid)
  to authenticated;

drop function public.get_camp_readiness(uuid, uuid);

create function public.get_camp_readiness(
  p_organization_id uuid,
  p_camp_id uuid
)
returns table (
  meal_plan_confirmed boolean,
  required_slots bigint,
  planned_slots bigint,
  unplanned_slots bigint,
  no_service_slots bigint,
  unresolved_dietary_needs bigint,
  meals_without_recipe bigint,
  calculation_stale boolean,
  supplier_items_total bigint,
  supplier_ready_items bigint,
  supplier_safe_suggestions bigint,
  supplier_review_suggestions bigint,
  supplier_no_match bigint,
  supplier_order_incomplete bigint,
  supplier_unresolved_items bigint,
  procurement_ready boolean,
  can_finalize boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with counts as (
    select
      camp.meal_plan_confirmed_at is not null as meal_plan_confirmed,
      (select count(*)
       from public.camp_meal_slots as slot
       where slot.organization_id = p_organization_id
         and slot.camp_id = p_camp_id
         and slot.service_status = 'required') as required_slots,
      (select count(*)
       from public.camp_meal_slots as slot
       where slot.organization_id = p_organization_id
         and slot.camp_id = p_camp_id
         and slot.service_status = 'required'
         and exists (
           select 1 from public.meals as meal
           where meal.organization_id = slot.organization_id
             and meal.camp_id = slot.camp_id
             and meal.meal_slot_id = slot.id
         )) as planned_slots,
      (select count(*)
       from public.camp_meal_slots as slot
       where slot.organization_id = p_organization_id
         and slot.camp_id = p_camp_id
         and slot.service_status = 'required'
         and not exists (
           select 1 from public.meals as meal
           where meal.organization_id = slot.organization_id
             and meal.camp_id = slot.camp_id
             and meal.meal_slot_id = slot.id
         )) as unplanned_slots,
      (select count(*)
       from public.camp_meal_slots as slot
       where slot.organization_id = p_organization_id
         and slot.camp_id = p_camp_id
         and slot.service_status = 'no_service') as no_service_slots,
      (select count(*)
       from public.participant_dietary_needs as need
       where need.organization_id = p_organization_id
         and need.camp_id = p_camp_id
         and need.review_status <> 'resolved') as unresolved_dietary_needs,
      (select count(*)
       from public.meals as meal
       join public.camp_meal_slots as slot
         on slot.organization_id = meal.organization_id
        and slot.camp_id = meal.camp_id
        and slot.id = meal.meal_slot_id
       where meal.organization_id = p_organization_id
         and meal.camp_id = p_camp_id
         and slot.service_status = 'required'
         and meal.camp_recipe_copy_id is null) as meals_without_recipe,
      not exists (
        select 1
        from public.calculation_revisions as revision
        where revision.organization_id = p_organization_id
          and revision.camp_id = p_camp_id
          and revision.status = 'current'
          and revision.input_digest = public.camp_input_digest(
            p_organization_id,
            p_camp_id
          )
      ) as calculation_stale
    from public.camps as camp
    where camp.organization_id = p_organization_id
      and camp.id = p_camp_id
  )
  select
    counts.meal_plan_confirmed,
    counts.required_slots,
    counts.planned_slots,
    counts.unplanned_slots,
    counts.no_service_slots,
    counts.unresolved_dietary_needs,
    counts.meals_without_recipe,
    counts.calculation_stale,
    supplier.supplier_items_total,
    supplier.supplier_ready_items,
    supplier.supplier_safe_suggestions,
    supplier.supplier_review_suggestions,
    supplier.supplier_no_match,
    supplier.supplier_order_incomplete,
    supplier.supplier_unresolved_items,
    supplier.procurement_ready,
    counts.meal_plan_confirmed
      and counts.required_slots > 0
      and counts.unplanned_slots = 0
      and counts.unresolved_dietary_needs = 0
      and counts.meals_without_recipe = 0
      and not counts.calculation_stale
      and supplier.procurement_ready
  from counts
  cross join public.get_supplier_procurement_readiness(
    p_organization_id,
    p_camp_id
  ) as supplier
  where public.is_org_member(p_organization_id);
$$;

revoke all on function public.get_camp_readiness(uuid, uuid)
  from public, anon;
grant execute on function public.get_camp_readiness(uuid, uuid)
  to authenticated;

comment on function public.get_supplier_procurement_readiness(uuid, uuid) is
  'Returns ICA Sickla matching and whole-order readiness for current purchase rows.';

comment on function public.get_camp_readiness(uuid, uuid) is
  'Returns the shared camp gate, including current ICA procurement readiness.';
