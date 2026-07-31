-- Organisation-scoped server cache and trusted context for advisory semantic
-- supplier matching.
--
-- No Data API role can read or write the cache. The current Netlify function
-- uses a small process-local cache; this relation is reserved for a future
-- server identity that can persist already revalidated decisions without
-- making cache mutation available to browser sessions.

create table public.supplier_semantic_match_cache (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  supplier_account_id uuid not null,
  canonical_key text not null,
  context_fingerprint text not null
    check (context_fingerprint ~ '^[0-9a-f]{64}$'),
  candidate_set_fingerprint text not null
    check (candidate_set_fingerprint ~ '^[0-9a-f]{64}$'),
  prompt_version text not null
    check (length(trim(prompt_version)) between 1 and 80),
  model text not null
    check (length(trim(model)) between 1 and 120),
  adapter text not null
    check (adapter in ('netlify-ai-gateway', 'fixture')),
  result jsonb not null
    check (
      jsonb_typeof(result) = 'object'
      and pg_column_size(result) <= 4000
    ),
  created_by uuid not null
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  constraint supplier_semantic_match_cache_account_fk
    foreign key (organization_id, supplier_account_id)
    references public.supplier_accounts (organization_id, id)
    on delete cascade,
  constraint supplier_semantic_match_cache_ingredient_fk
    foreign key (organization_id, canonical_key)
    references public.canonical_ingredients (organization_id, canonical_key)
    on delete cascade,
  constraint supplier_semantic_match_cache_expiry_check
    check (expires_at > created_at),
  constraint supplier_semantic_match_cache_identity_unique
    unique (
      organization_id,
      supplier_account_id,
      canonical_key,
      context_fingerprint,
      candidate_set_fingerprint,
      prompt_version
    )
);

create index supplier_semantic_match_cache_lookup_idx
  on public.supplier_semantic_match_cache (
    organization_id,
    supplier_account_id,
    canonical_key,
    updated_at desc
  );

create index supplier_semantic_match_cache_expires_idx
  on public.supplier_semantic_match_cache (expires_at);

create index supplier_semantic_match_cache_ingredient_idx
  on public.supplier_semantic_match_cache (organization_id, canonical_key);

create index supplier_semantic_match_cache_created_by_idx
  on public.supplier_semantic_match_cache (created_by);

create trigger supplier_semantic_match_cache_set_updated_at
before update on public.supplier_semantic_match_cache
for each row execute function public.set_updated_at();

alter table public.supplier_semantic_match_cache enable row level security;

create policy supplier_semantic_match_cache_member_select
on public.supplier_semantic_match_cache
for select to authenticated
using ((select public.is_org_member(organization_id)));

create function public.get_supplier_semantic_match_cache(
  p_organization_id uuid,
  p_supplier_account_id uuid,
  p_canonical_key text,
  p_context_fingerprint text,
  p_candidate_set_fingerprint text,
  p_prompt_version text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  cached_result jsonb;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  if p_supplier_account_id is null
    or coalesce(p_canonical_key, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_context_fingerprint, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_candidate_set_fingerprint, '') !~ '^[0-9a-f]{64}$'
    or length(trim(coalesce(p_prompt_version, ''))) not between 1 and 80
    or not exists (
      select 1
      from public.supplier_accounts as account
      where account.organization_id = p_organization_id
        and account.id = p_supplier_account_id
        and account.active
    )
    or not exists (
      select 1
      from public.canonical_ingredients as ingredient
      where ingredient.organization_id = p_organization_id
        and ingredient.canonical_key = p_canonical_key
    ) then
    raise exception 'Semantic match cache parameters failed validation'
      using errcode = '22023';
  end if;

  select cache.result
  into cached_result
  from public.supplier_semantic_match_cache as cache
  where cache.organization_id = p_organization_id
    and cache.supplier_account_id = p_supplier_account_id
    and cache.canonical_key = p_canonical_key
    and cache.context_fingerprint = p_context_fingerprint
    and cache.candidate_set_fingerprint = p_candidate_set_fingerprint
    and cache.prompt_version = trim(p_prompt_version)
    and cache.expires_at > now()
  order by cache.updated_at desc
  limit 1;

  return cached_result;
end;
$$;

create function public.save_supplier_semantic_match_cache(
  p_organization_id uuid,
  p_supplier_account_id uuid,
  p_canonical_key text,
  p_context_fingerprint text,
  p_candidate_set_fingerprint text,
  p_prompt_version text,
  p_model text,
  p_adapter text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  normalized_prompt_version text := trim(coalesce(p_prompt_version, ''));
  normalized_model text := trim(coalesce(p_model, ''));
  normalized_adapter text := trim(coalesce(p_adapter, ''));
  decision text := p_result ->> 'decision';
  selected_product_id_text text := p_result ->> 'selectedProductId';
  confidence numeric :=
    public.supplier_jsonb_numeric(p_result -> 'confidence');
  explanation text := p_result ->> 'explanation';
  selected_product_id uuid;
  saved_cache_id uuid;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  if p_supplier_account_id is null
    or coalesce(p_canonical_key, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_context_fingerprint, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_candidate_set_fingerprint, '') !~ '^[0-9a-f]{64}$'
    or length(normalized_prompt_version) not between 1 and 80
    or length(normalized_model) not between 1 and 120
    or normalized_adapter not in ('netlify-ai-gateway', 'fixture')
    or p_result is null
    or jsonb_typeof(p_result) is distinct from 'object'
    or pg_column_size(p_result) > 4000
    or not p_result ?& array[
      'decision',
      'selectedProductId',
      'confidence',
      'explanation'
    ]
    or exists (
      select 1
      from jsonb_object_keys(p_result) as result_key(key)
      where result_key.key not in (
        'decision',
        'selectedProductId',
        'confidence',
        'explanation'
      )
    )
    or decision not in ('match', 'ambiguous', 'no_match')
    or confidence is null
    or confidence < 0
    or confidence > 1
    or jsonb_typeof(p_result -> 'explanation') <> 'string'
    or length(trim(coalesce(explanation, ''))) not between 1 and 500
    or (
      decision = 'match'
      and (
        jsonb_typeof(p_result -> 'selectedProductId') <> 'string'
        or coalesce(selected_product_id_text, '')
          !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      )
    )
    or (
      decision <> 'match'
      and jsonb_typeof(p_result -> 'selectedProductId') <> 'null'
    )
    or not exists (
      select 1
      from public.supplier_accounts as account
      where account.organization_id = p_organization_id
        and account.id = p_supplier_account_id
        and account.active
    )
    or not exists (
      select 1
      from public.canonical_ingredients as ingredient
      where ingredient.organization_id = p_organization_id
        and ingredient.canonical_key = p_canonical_key
    )
  then
    raise exception 'Semantic match cache parameters failed validation'
      using errcode = '22023';
  end if;

  if decision = 'match' then
    selected_product_id := selected_product_id_text::uuid;

    if not exists (
      select 1
      from public.supplier_products as product
      where product.organization_id = p_organization_id
        and product.supplier_account_id = p_supplier_account_id
        and product.id = selected_product_id
        and product.active
    ) then
      raise exception 'Semantic match cache parameters failed validation'
        using errcode = '22023';
    end if;
  end if;

  insert into public.supplier_semantic_match_cache as cache (
    organization_id,
    supplier_account_id,
    canonical_key,
    context_fingerprint,
    candidate_set_fingerprint,
    prompt_version,
    model,
    adapter,
    result,
    created_by,
    expires_at
  ) values (
    p_organization_id,
    p_supplier_account_id,
    p_canonical_key,
    p_context_fingerprint,
    p_candidate_set_fingerprint,
    normalized_prompt_version,
    normalized_model,
    normalized_adapter,
    p_result,
    actor_user_id,
    now() + interval '30 days'
  )
  on conflict on constraint supplier_semantic_match_cache_identity_unique
  do update set
    model = excluded.model,
    adapter = excluded.adapter,
    result = excluded.result,
    created_by = actor_user_id,
    expires_at = now() + interval '30 days',
    updated_at = now()
  returning cache.id into saved_cache_id;

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
    'supplier_semantic_match_cached',
    'supplier_semantic_match_cache',
    saved_cache_id::text,
    jsonb_build_object(
      'supplier_account_id', p_supplier_account_id,
      'canonical_key', p_canonical_key,
      'prompt_version', normalized_prompt_version,
      'model', normalized_model,
      'adapter', normalized_adapter,
      'decision', decision
    )
  );

  return jsonb_build_object(
    'id', saved_cache_id,
    'saved', true
  );
end;
$$;

create function public.get_supplier_semantic_match_context(
  p_organization_id uuid,
  p_camp_id uuid,
  p_canonical_keys text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  current_revision_id uuid;
  trusted_context jsonb;
  requested_key_count integer;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  select count(distinct requested_key)
  into requested_key_count
  from unnest(p_canonical_keys) as requested(requested_key);

  if p_camp_id is null
    or p_canonical_keys is null
    or cardinality(p_canonical_keys) not between 1 and 8
    or requested_key_count <> cardinality(p_canonical_keys)
    or exists (
      select 1
      from unnest(p_canonical_keys) as requested(requested_key)
      where requested.requested_key is null
        or requested.requested_key !~ '^[0-9a-f]{64}$'
    )
    or not exists (
      select 1
      from public.camps as camp
      where camp.organization_id = p_organization_id
        and camp.id = p_camp_id
    ) then
    raise exception 'Semantic match context parameters failed validation'
      using errcode = '22023';
  end if;

  select revision.id
  into current_revision_id
  from public.calculation_revisions as revision
  where revision.organization_id = p_organization_id
    and revision.camp_id = p_camp_id
    and revision.status = 'current'
  order by revision.created_at desc, revision.id
  limit 1;

  if current_revision_id is null then
    raise exception 'A current calculation is required'
      using errcode = '22023';
  end if;

  with requested as (
    select requested_key as canonical_key
    from unnest(p_canonical_keys) as keys(requested_key)
  ),
  source_item as (
    select distinct on (item.canonical_key)
      item.canonical_key,
      item.category,
      item.comment
    from public.supply_list_items as item
    join requested
      on requested.canonical_key = item.canonical_key
    where item.organization_id = p_organization_id
      and item.camp_id = p_camp_id
      and item.source_present
    order by item.canonical_key, item.updated_at desc, item.id
  ),
  calculation_context as (
    select
      line.canonical_key,
      coalesce(
        to_jsonb(array_agg(
          distinct line.trace ->> 'recipe_name'
          order by line.trace ->> 'recipe_name'
        ) filter (
          where nullif(trim(line.trace ->> 'recipe_name'), '') is not null
        )),
        '[]'::jsonb
      ) as recipe_names,
      coalesce(
        to_jsonb(array_agg(
          distinct line.trace ->> 'dietary_tag_label'
          order by line.trace ->> 'dietary_tag_label'
        ) filter (
          where line.trace ->> 'dietary_rule' in ('only', 'replace_for_tag')
            and nullif(
              trim(line.trace ->> 'dietary_tag_label'),
              ''
            ) is not null
        )),
        '[]'::jsonb
      ) as dietary_labels
    from public.calculation_lines as line
    join requested
      on requested.canonical_key = line.canonical_key
    where line.organization_id = p_organization_id
      and line.camp_id = p_camp_id
      and line.calculation_revision_id = current_revision_id
    group by line.canonical_key
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'canonicalKey', canonical.canonical_key,
        'displayName', canonical.display_name,
        'requiredUnit', canonical.unit,
        'category', source_item.category,
        'comment', source_item.comment,
        'recipeNames',
          coalesce(calculation_context.recipe_names, '[]'::jsonb),
        'dietaryLabels',
          coalesce(calculation_context.dietary_labels, '[]'::jsonb)
      )
      order by canonical.canonical_key
    ),
    '[]'::jsonb
  )
  into trusted_context
  from requested
  join public.canonical_ingredients as canonical
    on canonical.organization_id = p_organization_id
    and canonical.canonical_key = requested.canonical_key
  join source_item
    on source_item.canonical_key = requested.canonical_key
  left join calculation_context
    on calculation_context.canonical_key = requested.canonical_key;

  if jsonb_array_length(trusted_context) <> requested_key_count then
    raise exception 'Semantic match context is stale'
      using errcode = '22023';
  end if;

  return trusted_context;
end;
$$;

revoke all on table public.supplier_semantic_match_cache
from public, anon, authenticated, service_role;

revoke all on function public.get_supplier_semantic_match_cache(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.save_supplier_semantic_match_cache(
  uuid, uuid, text, text, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.get_supplier_semantic_match_context(
  uuid, uuid, text[]
) from public, anon, authenticated, service_role;
grant execute on function public.get_supplier_semantic_match_context(
  uuid, uuid, text[]
) to authenticated;
