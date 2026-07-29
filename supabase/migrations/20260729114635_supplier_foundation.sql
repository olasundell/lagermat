-- Supplier-neutral catalogue and offer foundation.
--
-- Ingredient identities are deliberately derived from the existing name/unit
-- pairs. Supplier article numbers and customer-specific prices stay outside
-- that identity so several wholesalers can be matched to the same requirement.

create function public.canonical_ingredient_key(
  p_name text,
  p_unit text
)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        lower(regexp_replace(trim(p_name), '[[:space:]]+', ' ', 'g'))
          || chr(31)
          || lower(regexp_replace(trim(p_unit), '[[:space:]]+', ' ', 'g')),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

alter table public.recipe_ingredients
  add column canonical_key text
  generated always as (
    public.canonical_ingredient_key(name, unit)
  ) stored;

alter table public.calculation_lines
  add column canonical_key text
  generated always as (
    public.canonical_ingredient_key(ingredient_name, unit)
  ) stored;

alter table public.supply_list_items
  add column canonical_key text
  generated always as (
    public.canonical_ingredient_key(item_name, required_unit)
  ) stored;

create index recipe_ingredients_org_canonical_key_idx
  on public.recipe_ingredients (organization_id, canonical_key);
create index calculation_lines_org_canonical_key_idx
  on public.calculation_lines (organization_id, canonical_key);
create index supply_list_items_org_canonical_key_idx
  on public.supply_list_items (organization_id, canonical_key);

create table public.canonical_ingredients (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  canonical_key text not null,
  display_name text not null
    check (length(trim(display_name)) between 1 and 160),
  unit text not null
    check (length(trim(unit)) between 1 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, canonical_key),
  check (canonical_key ~ '^[0-9a-f]{64}$'),
  check (
    canonical_key = public.canonical_ingredient_key(display_name, unit)
  )
);

insert into public.canonical_ingredients (
  organization_id,
  canonical_key,
  display_name,
  unit
)
select distinct on (candidate.organization_id, candidate.canonical_key)
  candidate.organization_id,
  candidate.canonical_key,
  candidate.display_name,
  candidate.unit
from (
  select
    ingredient.organization_id,
    ingredient.canonical_key,
    ingredient.name as display_name,
    ingredient.unit,
    ingredient.created_at,
    1 as source_priority
  from public.recipe_ingredients as ingredient

  union all

  select
    line.organization_id,
    line.canonical_key,
    line.ingredient_name,
    line.unit,
    line.created_at,
    2
  from public.calculation_lines as line

  union all

  select
    item.organization_id,
    item.canonical_key,
    item.item_name,
    item.required_unit,
    item.created_at,
    3
  from public.supply_list_items as item
) as candidate
order by
  candidate.organization_id,
  candidate.canonical_key,
  candidate.source_priority,
  candidate.created_at;

create function public.sync_canonical_ingredient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb := to_jsonb(new);
  ingredient_name text := row_data ->> tg_argv[0];
  ingredient_unit text := row_data ->> tg_argv[1];
  ingredient_key text := row_data ->> 'canonical_key';
begin
  insert into public.canonical_ingredients as canonical (
    organization_id,
    canonical_key,
    display_name,
    unit
  ) values (
    new.organization_id,
    ingredient_key,
    ingredient_name,
    ingredient_unit
  )
  on conflict (organization_id, canonical_key) do update
  set
    display_name = excluded.display_name,
    unit = excluded.unit,
    updated_at = now()
  where
    canonical.display_name is distinct from excluded.display_name
    or canonical.unit is distinct from excluded.unit;

  return new;
end;
$$;

create trigger recipe_ingredients_sync_canonical
after insert or update of name, unit on public.recipe_ingredients
for each row execute function public.sync_canonical_ingredient('name', 'unit');

create trigger calculation_lines_sync_canonical
after insert or update of ingredient_name, unit on public.calculation_lines
for each row execute function public.sync_canonical_ingredient(
  'ingredient_name',
  'unit'
);

create trigger supply_list_items_sync_canonical
after insert or update of item_name, required_unit on public.supply_list_items
for each row execute function public.sync_canonical_ingredient(
  'item_name',
  'required_unit'
);

create table public.supplier_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  provider_key text not null
    check (
      provider_key = lower(provider_key)
      and provider_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    ),
  display_name text not null
    check (length(trim(display_name)) between 1 and 160),
  customer_number text
    check (
      customer_number is null
      or length(trim(customer_number)) between 1 and 120
    ),
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint supplier_accounts_provider_customer_unique
    unique nulls not distinct (
      organization_id,
      provider_key,
      customer_number,
      display_name
    )
);

create table public.supplier_products (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  supplier_account_id uuid not null,
  supplier_article_number text not null
    check (length(trim(supplier_article_number)) between 1 and 120),
  display_name text not null
    check (length(trim(display_name)) between 1 and 240),
  gtin text
    check (
      gtin is null
      or (
        length(gtin) in (8, 12, 13, 14)
        and gtin ~ '^[0-9]+$'
      )
    ),
  purchase_unit text not null
    check (length(trim(purchase_unit)) between 1 and 40),
  package_amount numeric(20,6) not null check (package_amount > 0),
  package_unit text not null
    check (length(trim(package_unit)) between 1 and 40),
  minimum_order_units integer not null default 1
    check (minimum_order_units > 0),
  active boolean not null default true,
  product_data_source text not null
    check (length(trim(product_data_source)) between 1 and 40),
  source_updated_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint supplier_products_article_unique
    unique (
      organization_id,
      supplier_account_id,
      supplier_article_number
    ),
  constraint supplier_products_account_fk
    foreign key (organization_id, supplier_account_id)
    references public.supplier_accounts (organization_id, id)
    on delete cascade
);

create table public.supplier_offers (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  supplier_product_id uuid not null,
  price numeric(20,4) check (price is null or price >= 0),
  currency text not null default 'SEK'
    check (currency ~ '^[A-Z]{3}$'),
  availability_status text not null default 'unknown'
    check (
      availability_status
        ~ '^[a-z][a-z0-9_-]{0,39}$'
    ),
  valid_from date,
  valid_to date,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint supplier_offers_product_period_unique
    unique nulls not distinct (
      organization_id,
      supplier_product_id,
      valid_from,
      valid_to
    ),
  constraint supplier_offers_valid_period
    check (valid_to is null or valid_from is null or valid_to >= valid_from),
  constraint supplier_offers_product_fk
    foreign key (organization_id, supplier_product_id)
    references public.supplier_products (organization_id, id)
    on delete cascade
);

create table public.ingredient_supplier_matches (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  canonical_key text not null,
  supplier_product_id uuid not null,
  required_unit text not null
    check (length(trim(required_unit)) between 1 and 30),
  amount_per_purchase_unit numeric(20,6) not null
    check (amount_per_purchase_unit > 0),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint ingredient_supplier_matches_product_unique
    unique (organization_id, canonical_key, supplier_product_id),
  constraint ingredient_supplier_matches_approval_pair
    check (
      (approved_by is null and approved_at is null)
      or (approved_by is not null and approved_at is not null)
    ),
  constraint ingredient_supplier_matches_canonical_fk
    foreign key (organization_id, canonical_key)
    references public.canonical_ingredients (organization_id, canonical_key)
    on delete restrict,
  constraint ingredient_supplier_matches_product_fk
    foreign key (organization_id, supplier_product_id)
    references public.supplier_products (organization_id, id)
    on delete cascade
);

create index supplier_accounts_created_by_idx
  on public.supplier_accounts (created_by);
create index supplier_products_created_by_idx
  on public.supplier_products (created_by);
create index ingredient_supplier_matches_org_product_idx
  on public.ingredient_supplier_matches (
    organization_id,
    supplier_product_id
  );
create index ingredient_supplier_matches_approved_by_idx
  on public.ingredient_supplier_matches (approved_by);

create trigger canonical_ingredients_set_updated_at
before update on public.canonical_ingredients
for each row execute function public.set_updated_at();

create trigger supplier_accounts_set_updated_at
before update on public.supplier_accounts
for each row execute function public.set_updated_at();

create trigger supplier_products_set_updated_at
before update on public.supplier_products
for each row execute function public.set_updated_at();

create trigger supplier_offers_set_updated_at
before update on public.supplier_offers
for each row execute function public.set_updated_at();

create trigger ingredient_supplier_matches_set_updated_at
before update on public.ingredient_supplier_matches
for each row execute function public.set_updated_at();

alter table public.canonical_ingredients enable row level security;
alter table public.supplier_accounts enable row level security;
alter table public.supplier_products enable row level security;
alter table public.supplier_offers enable row level security;
alter table public.ingredient_supplier_matches enable row level security;

create policy canonical_ingredients_member_select
on public.canonical_ingredients
for select to authenticated
using ((select public.is_org_member(organization_id)));

create policy supplier_accounts_member_select
on public.supplier_accounts
for select to authenticated
using ((select public.is_org_member(organization_id)));

create policy supplier_products_member_select
on public.supplier_products
for select to authenticated
using ((select public.is_org_member(organization_id)));

create policy supplier_offers_member_select
on public.supplier_offers
for select to authenticated
using ((select public.is_org_member(organization_id)));

create policy ingredient_supplier_matches_member_select
on public.ingredient_supplier_matches
for select to authenticated
using ((select public.is_org_member(organization_id)));

create function public.save_supplier_account(
  p_organization_id uuid,
  p_provider_key text,
  p_display_name text,
  p_customer_number text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  normalized_provider_key text := lower(trim(coalesce(p_provider_key, '')));
  normalized_customer_number text := nullif(trim(p_customer_number), '');
  saved_account_id uuid;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  if normalized_provider_key
      !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(trim(coalesce(p_display_name, ''))) not between 1 and 160
    or (
      normalized_customer_number is not null
      and length(normalized_customer_number) > 120
    ) then
    raise exception 'Supplier account parameters failed validation'
      using errcode = '22023';
  end if;

  insert into public.supplier_accounts (
    organization_id,
    provider_key,
    display_name,
    customer_number,
    active,
    created_by
  ) values (
    p_organization_id,
    normalized_provider_key,
    trim(p_display_name),
    normalized_customer_number,
    true,
    actor_user_id
  )
  on conflict on constraint supplier_accounts_provider_customer_unique
  do update set
    display_name = excluded.display_name,
    active = true,
    updated_at = now()
  returning id into saved_account_id;

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
    'supplier_account_saved',
    'supplier_account',
    saved_account_id::text,
    jsonb_build_object('provider_key', normalized_provider_key)
  );

  return saved_account_id;
end;
$$;

create function public.save_supplier_product_match(
  p_organization_id uuid,
  p_canonical_key text,
  p_supplier_account_id uuid,
  p_supplier_article_number text,
  p_display_name text,
  p_purchase_unit text,
  p_package_amount numeric,
  p_package_unit text,
  p_amount_per_purchase_unit numeric,
  p_required_unit text,
  p_gtin text default null,
  p_minimum_order_units integer default 1,
  p_price numeric default null,
  p_currency text default 'SEK',
  p_availability_status text default 'unknown',
  p_price_valid_from date default null,
  p_price_valid_to date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  normalized_canonical_key text :=
    lower(trim(coalesce(p_canonical_key, '')));
  normalized_gtin text := nullif(trim(p_gtin), '');
  normalized_currency text := upper(trim(coalesce(p_currency, '')));
  normalized_availability text :=
    lower(trim(coalesce(p_availability_status, '')));
  canonical_display_name text;
  saved_product_id uuid;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  if normalized_canonical_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Canonical ingredient key failed validation'
      using errcode = '22023';
  end if;

  select canonical.display_name
  into canonical_display_name
  from public.canonical_ingredients as canonical
  where canonical.organization_id = p_organization_id
    and canonical.canonical_key = normalized_canonical_key;

  if not found then
    raise exception 'Canonical ingredient does not belong to the organization'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.supplier_accounts as account
    where account.organization_id = p_organization_id
      and account.id = p_supplier_account_id
      and account.active
  ) then
    raise exception 'Supplier account does not belong to the organization'
      using errcode = '22023';
  end if;

  if public.canonical_ingredient_key(
      canonical_display_name,
      p_required_unit
    ) <> normalized_canonical_key then
    raise exception
      'Required unit does not match the canonical ingredient unit'
      using errcode = '22023';
  end if;

  if length(trim(coalesce(p_supplier_article_number, '')))
      not between 1 and 120
    or length(trim(coalesce(p_display_name, ''))) not between 1 and 240
    or length(trim(coalesce(p_purchase_unit, ''))) not between 1 and 40
    or p_package_amount is null
    or p_package_amount <= 0
    or length(trim(coalesce(p_package_unit, ''))) not between 1 and 40
    or p_amount_per_purchase_unit is null
    or p_amount_per_purchase_unit <= 0
    or length(trim(coalesce(p_required_unit, ''))) not between 1 and 30
    or p_minimum_order_units is null
    or p_minimum_order_units <= 0
    or (
      normalized_gtin is not null
      and (
        length(normalized_gtin) not in (8, 12, 13, 14)
        or normalized_gtin !~ '^[0-9]+$'
      )
    )
    or (p_price is not null and p_price < 0)
    or normalized_currency !~ '^[A-Z]{3}$'
    or normalized_availability
      !~ '^[a-z][a-z0-9_-]{0,39}$'
    or (
      p_price_valid_to is not null
      and p_price_valid_from is not null
      and p_price_valid_to < p_price_valid_from
    ) then
    raise exception 'Supplier product parameters failed validation'
      using errcode = '22023';
  end if;

  insert into public.supplier_products (
    organization_id,
    supplier_account_id,
    supplier_article_number,
    display_name,
    gtin,
    purchase_unit,
    package_amount,
    package_unit,
    minimum_order_units,
    active,
    product_data_source,
    source_updated_at,
    created_by
  ) values (
    p_organization_id,
    p_supplier_account_id,
    trim(p_supplier_article_number),
    trim(p_display_name),
    normalized_gtin,
    trim(p_purchase_unit),
    p_package_amount,
    trim(p_package_unit),
    p_minimum_order_units,
    true,
    'manual',
    now(),
    actor_user_id
  )
  on conflict on constraint supplier_products_article_unique
  do update set
    display_name = excluded.display_name,
    gtin = excluded.gtin,
    purchase_unit = excluded.purchase_unit,
    package_amount = excluded.package_amount,
    package_unit = excluded.package_unit,
    minimum_order_units = excluded.minimum_order_units,
    active = true,
    product_data_source = 'manual',
    source_updated_at = now(),
    updated_at = now()
  returning id into saved_product_id;

  insert into public.ingredient_supplier_matches (
    organization_id,
    canonical_key,
    supplier_product_id,
    required_unit,
    amount_per_purchase_unit,
    approved_by,
    approved_at
  ) values (
    p_organization_id,
    normalized_canonical_key,
    saved_product_id,
    trim(p_required_unit),
    p_amount_per_purchase_unit,
    actor_user_id,
    now()
  )
  on conflict on constraint ingredient_supplier_matches_product_unique
  do update set
    required_unit = excluded.required_unit,
    amount_per_purchase_unit = excluded.amount_per_purchase_unit,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at,
    updated_at = now();

  if p_price is not null
    or normalized_availability <> 'unknown'
    or p_price_valid_from is not null
    or p_price_valid_to is not null then
    insert into public.supplier_offers (
      organization_id,
      supplier_product_id,
      price,
      currency,
      availability_status,
      valid_from,
      valid_to,
      fetched_at
    ) values (
      p_organization_id,
      saved_product_id,
      p_price,
      normalized_currency,
      normalized_availability,
      p_price_valid_from,
      p_price_valid_to,
      now()
    )
    on conflict on constraint supplier_offers_product_period_unique
    do update set
      price = excluded.price,
      currency = excluded.currency,
      availability_status = excluded.availability_status,
      fetched_at = now(),
      updated_at = now();
  end if;

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
    'supplier_product_match_saved',
    'supplier_product',
    saved_product_id::text,
    jsonb_build_object(
      'canonical_key', normalized_canonical_key,
      'supplier_account_id', p_supplier_account_id,
      'supplier_article_number', trim(p_supplier_article_number)
    )
  );

  return saved_product_id;
end;
$$;

revoke all on table
  public.canonical_ingredients,
  public.supplier_accounts,
  public.supplier_products,
  public.supplier_offers,
  public.ingredient_supplier_matches
from public, anon, authenticated, service_role;

grant select on table
  public.canonical_ingredients,
  public.supplier_accounts,
  public.supplier_products,
  public.supplier_offers,
  public.ingredient_supplier_matches
to authenticated;

revoke all on function public.canonical_ingredient_key(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.canonical_ingredient_key(text, text)
to authenticated, service_role;

revoke all on function public.sync_canonical_ingredient()
from public, anon, authenticated, service_role;

revoke all on function public.save_supplier_account(
  uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_supplier_account(
  uuid, text, text, text
) to authenticated;

revoke all on function public.save_supplier_product_match(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  numeric,
  text,
  numeric,
  text,
  text,
  integer,
  numeric,
  text,
  text,
  date,
  date
) from public, anon, authenticated, service_role;
grant execute on function public.save_supplier_product_match(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  numeric,
  text,
  numeric,
  text,
  text,
  integer,
  numeric,
  text,
  text,
  date,
  date
) to authenticated;
