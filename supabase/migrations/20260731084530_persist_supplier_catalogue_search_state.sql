create table public.supplier_catalogue_search_states (
  organization_id uuid not null,
  camp_id uuid not null,
  supplier_account_id uuid not null,
  canonical_key text not null,
  search_query text not null,
  search_date date not null,
  status text not null,
  last_attempted_at timestamptz,
  completed_at timestamptz,
  retry_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (
    organization_id,
    camp_id,
    supplier_account_id,
    canonical_key
  ),
  constraint supplier_catalogue_search_states_camp_fk
    foreign key (organization_id, camp_id)
    references public.camps (organization_id, id)
    on delete cascade,
  constraint supplier_catalogue_search_states_account_fk
    foreign key (organization_id, supplier_account_id)
    references public.supplier_accounts (organization_id, id)
    on delete cascade,
  constraint supplier_catalogue_search_states_canonical_key_check
    check (char_length(trim(canonical_key)) between 1 and 240),
  constraint supplier_catalogue_search_states_query_check
    check (char_length(trim(search_query)) between 2 and 80),
  constraint supplier_catalogue_search_states_status_check
    check (status in ('pending', 'syncing', 'retrying', 'complete', 'error')),
  constraint supplier_catalogue_search_states_error_check
    check (last_error is null or char_length(last_error) <= 500)
);

create index supplier_catalogue_search_states_readiness_idx
  on public.supplier_catalogue_search_states (
    organization_id,
    camp_id,
    supplier_account_id,
    status
  );

create index supplier_catalogue_search_states_account_fk_idx
  on public.supplier_catalogue_search_states (
    organization_id,
    supplier_account_id
  );

create trigger supplier_catalogue_search_states_set_updated_at
before update on public.supplier_catalogue_search_states
for each row execute function public.set_updated_at();

alter table public.supplier_catalogue_search_states enable row level security;

revoke all on table public.supplier_catalogue_search_states
  from public, anon, authenticated;
grant select on table public.supplier_catalogue_search_states
  to authenticated;

create policy supplier_catalogue_search_states_member_select
on public.supplier_catalogue_search_states
for select to authenticated
using ((select public.is_org_member(organization_id)));

create function public.record_supplier_catalogue_search_states(
  p_organization_id uuid,
  p_camp_id uuid,
  p_supplier_account_id uuid,
  p_states jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  state_count integer;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership is required';
  end if;

  if not exists (
    select 1
    from public.camps as camp
    where camp.organization_id = p_organization_id
      and camp.id = p_camp_id
  ) then
    raise exception 'Camp not found';
  end if;

  if not exists (
    select 1
    from public.supplier_accounts as account
    where account.organization_id = p_organization_id
      and account.id = p_supplier_account_id
      and account.active
  ) then
    raise exception 'Active supplier account not found';
  end if;

  if jsonb_typeof(p_states) <> 'array'
    or jsonb_array_length(p_states) > 100 then
    raise exception 'Search states must be an array with at most 100 entries';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_states) as incoming(
      canonical_key text,
      search_query text,
      search_date date,
      status text,
      retry_at timestamptz,
      last_error text
    )
    where incoming.canonical_key is null
      or char_length(trim(incoming.canonical_key)) not between 1 and 240
      or incoming.search_query is null
      or char_length(trim(incoming.search_query)) not between 2 and 80
      or incoming.search_date is null
      or incoming.status is null
      or incoming.status not in (
        'pending',
        'syncing',
        'retrying',
        'complete',
        'error'
      )
      or (
        incoming.last_error is not null
        and char_length(incoming.last_error) > 500
      )
  ) then
    raise exception 'Invalid supplier catalogue search state';
  end if;

  insert into public.supplier_catalogue_search_states (
    organization_id,
    camp_id,
    supplier_account_id,
    canonical_key,
    search_query,
    search_date,
    status,
    last_attempted_at,
    completed_at,
    retry_at,
    last_error
  )
  select
    p_organization_id,
    p_camp_id,
    p_supplier_account_id,
    trim(incoming.canonical_key),
    trim(incoming.search_query),
    incoming.search_date,
    incoming.status,
    case
      when incoming.status = 'pending' then null
      else now()
    end,
    case
      when incoming.status = 'complete' then now()
      else null
    end,
    incoming.retry_at,
    nullif(trim(incoming.last_error), '')
  from jsonb_to_recordset(p_states) as incoming(
    canonical_key text,
    search_query text,
    search_date date,
    status text,
    retry_at timestamptz,
    last_error text
  )
  on conflict (
    organization_id,
    camp_id,
    supplier_account_id,
    canonical_key
  )
  do update set
    search_query = excluded.search_query,
    search_date = excluded.search_date,
    status = case
      when supplier_catalogue_search_states.search_query
          = excluded.search_query
        and supplier_catalogue_search_states.search_date
          = excluded.search_date
        and supplier_catalogue_search_states.status = 'complete'
        and excluded.status in ('pending', 'syncing')
        then supplier_catalogue_search_states.status
      else excluded.status
    end,
    last_attempted_at = case
      when supplier_catalogue_search_states.search_query
          = excluded.search_query
        and supplier_catalogue_search_states.search_date
          = excluded.search_date
        and supplier_catalogue_search_states.status = 'complete'
        and excluded.status in ('pending', 'syncing')
        then supplier_catalogue_search_states.last_attempted_at
      else excluded.last_attempted_at
    end,
    completed_at = case
      when supplier_catalogue_search_states.search_query
          = excluded.search_query
        and supplier_catalogue_search_states.search_date
          = excluded.search_date
        and supplier_catalogue_search_states.status = 'complete'
        and excluded.status in ('pending', 'syncing')
        then supplier_catalogue_search_states.completed_at
      else excluded.completed_at
    end,
    retry_at = case
      when supplier_catalogue_search_states.search_query
          = excluded.search_query
        and supplier_catalogue_search_states.search_date
          = excluded.search_date
        and supplier_catalogue_search_states.status = 'complete'
        and excluded.status in ('pending', 'syncing')
        then supplier_catalogue_search_states.retry_at
      else excluded.retry_at
    end,
    last_error = case
      when supplier_catalogue_search_states.search_query
          = excluded.search_query
        and supplier_catalogue_search_states.search_date
          = excluded.search_date
        and supplier_catalogue_search_states.status = 'complete'
        and excluded.status in ('pending', 'syncing')
        then supplier_catalogue_search_states.last_error
      else excluded.last_error
    end;

  get diagnostics state_count = row_count;

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
    'supplier_catalogue_search_state_recorded',
    'supplier_account',
    p_supplier_account_id::text,
    jsonb_build_object(
      'camp_id', p_camp_id,
      'state_count', state_count
    )
  );

  return jsonb_build_object('recorded_states', state_count);
end;
$$;

revoke all on function public.record_supplier_catalogue_search_states(
  uuid,
  uuid,
  uuid,
  jsonb
) from public, anon;
grant execute on function public.record_supplier_catalogue_search_states(
  uuid,
  uuid,
  uuid,
  jsonb
) to authenticated;

drop function public.get_supplier_procurement_readiness(uuid, uuid);

create function public.get_supplier_procurement_readiness(
  p_organization_id uuid,
  p_camp_id uuid
)
returns table (
  supplier_items_total bigint,
  supplier_ready_items bigint,
  supplier_safe_suggestions bigint,
  supplier_review_suggestions bigint,
  supplier_pending_items bigint,
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
      coalesce(search.status = 'complete', false) as search_complete,
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
    left join public.supplier_catalogue_search_states as search
      on search.organization_id = item.organization_id
     and search.camp_id = item.camp_id
     and search.supplier_account_id = account.id
     and search.canonical_key = item.canonical_key
     and lower(trim(search.search_query)) = lower(trim(item.item_name))
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
          and not state.search_complete
      ) as supplier_pending_items,
      count(*) filter (
        where not state.has_preferred
          and not state.has_safe
          and not state.has_review
          and state.search_complete
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
    readiness.supplier_pending_items,
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
  supplier_pending_items bigint,
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
       join public.participants as participant
         on participant.organization_id = need.organization_id
        and participant.camp_id = need.camp_id
        and participant.id = need.participant_id
        and participant.lifecycle_status = 'active'
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
    supplier.supplier_pending_items,
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

comment on table public.supplier_catalogue_search_states is
  'Persistent per-camp ICA search progress, including completed zero-result searches.';

comment on function public.record_supplier_catalogue_search_states(
  uuid,
  uuid,
  uuid,
  jsonb
) is
  'Records authenticated, organization-scoped ICA catalogue search progress.';

comment on function public.get_supplier_procurement_readiness(uuid, uuid) is
  'Returns ICA Sickla matching readiness and separates pending searches from completed no-match results.';

comment on function public.get_camp_readiness(uuid, uuid) is
  'Returns the shared camp gate, including truthful pending ICA search readiness.';
