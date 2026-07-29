-- Versioned supplier imports and deterministic ingredient matching.
--
-- Imports are deliberately scoped to an explicit supplier account. A generic
-- file import updates only rows present in that file; it never treats omitted
-- products as deleted or inactive.

create function public.normalized_supplier_unit(p_unit text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case regexp_replace(
    lower(trim(coalesce(p_unit, ''))),
    '[[:space:].]+',
    '',
    'g'
  )
    when 'milligram' then 'mg'
    when 'milligrams' then 'mg'
    when 'gram' then 'g'
    when 'grams' then 'g'
    when 'hektogram' then 'hg'
    when 'hectogram' then 'hg'
    when 'kilogram' then 'kg'
    when 'kilograms' then 'kg'
    when 'kilo' then 'kg'
    when 'milliliter' then 'ml'
    when 'millilitre' then 'ml'
    when 'milliliters' then 'ml'
    when 'millilitres' then 'ml'
    when 'centiliter' then 'cl'
    when 'centilitre' then 'cl'
    when 'centiliters' then 'cl'
    when 'centilitres' then 'cl'
    when 'deciliter' then 'dl'
    when 'decilitre' then 'dl'
    when 'deciliters' then 'dl'
    when 'decilitres' then 'dl'
    when 'liter' then 'l'
    when 'litre' then 'l'
    when 'liters' then 'l'
    when 'litres' then 'l'
    when 'styck' then 'st'
    when 'stycken' then 'st'
    when 'pcs' then 'st'
    else regexp_replace(
      lower(trim(coalesce(p_unit, ''))),
      '[[:space:].]+',
      '',
      'g'
    )
  end;
$$;

create function public.supplier_unit_dimension(p_unit text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case public.normalized_supplier_unit(p_unit)
    when 'mg' then 'mass'
    when 'g' then 'mass'
    when 'hg' then 'mass'
    when 'kg' then 'mass'
    when 'ml' then 'volume'
    when 'cl' then 'volume'
    when 'dl' then 'volume'
    when 'l' then 'volume'
    when 'st' then 'count'
    else null
  end;
$$;

create function public.supplier_unit_base_factor(p_unit text)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case public.normalized_supplier_unit(p_unit)
    when 'mg' then 0.001::numeric
    when 'g' then 1::numeric
    when 'hg' then 100::numeric
    when 'kg' then 1000::numeric
    when 'ml' then 1::numeric
    when 'cl' then 10::numeric
    when 'dl' then 100::numeric
    when 'l' then 1000::numeric
    when 'st' then 1::numeric
    else null
  end;
$$;

create function public.supplier_expected_amount(
  p_package_amount numeric,
  p_package_unit text,
  p_required_unit text
)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_package_amount is null or p_package_amount <= 0 then null
    when public.supplier_unit_dimension(p_package_unit) is null then null
    when public.supplier_unit_dimension(p_package_unit)
      <> public.supplier_unit_dimension(p_required_unit) then null
    else p_package_amount
      * public.supplier_unit_base_factor(p_package_unit)
      / public.supplier_unit_base_factor(p_required_unit)
  end;
$$;

create function public.supplier_jsonb_numeric(p_value jsonb)
returns numeric
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  value_text text;
  parsed_value numeric;
begin
  if p_value is null
    or jsonb_typeof(p_value) not in ('number', 'string') then
    return null;
  end if;

  value_text := p_value #>> '{}';
  if length(value_text) > 40
    or value_text !~ '^-?[0-9]+([.][0-9]+)?$' then
    return null;
  end if;

  begin
    parsed_value := value_text::numeric;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return null;
  end;

  return parsed_value;
end;
$$;

create function public.supplier_jsonb_integer(p_value jsonb)
returns integer
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  parsed_value numeric := public.supplier_jsonb_numeric(p_value);
begin
  if parsed_value is null
    or parsed_value <> trunc(parsed_value)
    or parsed_value < -2147483648
    or parsed_value > 2147483647 then
    return null;
  end if;

  return parsed_value::integer;
end;
$$;

create function public.supplier_product_fingerprint(
  p_supplier_article_number text,
  p_display_name text,
  p_gtin text,
  p_purchase_unit text,
  p_package_amount numeric,
  p_package_unit text,
  p_minimum_order_units integer,
  p_catch_weight boolean
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'supplier_article_number',
            lower(trim(coalesce(p_supplier_article_number, ''))),
          'display_name',
            lower(regexp_replace(
              trim(coalesce(p_display_name, '')),
              '[[:space:]]+',
              ' ',
              'g'
            )),
          'gtin', nullif(trim(coalesce(p_gtin, '')), ''),
          'purchase_unit',
            lower(trim(coalesce(p_purchase_unit, ''))),
          'package_amount', p_package_amount,
          'package_unit',
            public.normalized_supplier_unit(p_package_unit),
          'minimum_order_units', p_minimum_order_units,
          'catch_weight', coalesce(p_catch_weight, false)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create function public.normalized_supplier_search_name(p_display_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select trim(regexp_replace(
    lower(replace(trim(coalesce(p_display_name, '')), '&', ' och ')),
    '[^[:alnum:]%]+',
    ' ',
    'g'
  ));
$$;

create function public.normalized_supplier_match_name(p_display_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select public.normalized_supplier_search_name(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          coalesce(p_display_name, ''),
          '(^|[^[:alnum:]])[0-9]+([.,][0-9]+)?[[:space:]]*(x|×)[[:space:]]*[0-9]+([.,][0-9]+)?[[:space:]]*(milligrams?|mg|grams?|g|hektogram|hg|kilograms?|kilo|kg|milliliters?|ml|centiliters?|cl|deciliters?|dl|liters?|litres?|l|stycken|styck|st)([^[:alnum:]]|$)',
          ' ',
          'gi'
        ),
        '(^|[^[:alnum:]])[0-9]+([.,][0-9]+)?[[:space:]]*(milligrams?|mg|grams?|g|hektogram|hg|kilograms?|kilo|kg|milliliters?|ml|centiliters?|cl|deciliters?|dl|liters?|litres?|l|stycken|styck|st)([^[:alnum:]]|$)',
        ' ',
        'gi'
      ),
      '(^|[^[:alnum:]])(kolli|kartong|förpackning|förp|påse|burk)([^[:alnum:]]|$)',
      ' ',
      'gi'
    )
  );
$$;

alter table public.supplier_accounts
  add column account_key uuid not null default extensions.gen_random_uuid(),
  add constraint supplier_accounts_account_key_unique
    unique (organization_id, account_key);

alter table public.supplier_products
  add column source_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_metadata) = 'object'),
  add column normalized_search_name text
    generated always as (
      public.normalized_supplier_search_name(display_name)
    ) stored,
  add column brand text
    check (
      brand is null
      or length(trim(brand)) between 1 and 160
    ),
  add column category text
    check (
      category is null
      or length(trim(category)) between 1 and 160
    ),
  add column packaging_metadata jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(packaging_metadata) = 'object'
      and pg_column_size(packaging_metadata) <= 50000
    ),
  add column catch_weight boolean not null default false,
  add column product_fingerprint text,
  add constraint supplier_products_org_account_id_unique
    unique (organization_id, supplier_account_id, id);

update public.supplier_products
set product_fingerprint = public.supplier_product_fingerprint(
  supplier_article_number,
  display_name,
  gtin,
  purchase_unit,
  package_amount,
  package_unit,
  minimum_order_units,
  catch_weight
);

alter table public.supplier_products
  alter column product_fingerprint set not null,
  add constraint supplier_products_search_name_not_empty
    check (length(normalized_search_name) between 1 and 240),
  add constraint supplier_products_fingerprint_format
    check (product_fingerprint ~ '^[0-9a-f]{64}$');

create function public.set_supplier_product_fingerprint()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.product_fingerprint := public.supplier_product_fingerprint(
    new.supplier_article_number,
    new.display_name,
    new.gtin,
    new.purchase_unit,
    new.package_amount,
    new.package_unit,
    new.minimum_order_units,
    new.catch_weight
  );
  return new;
end;
$$;

create trigger supplier_products_set_fingerprint
before insert or update of
  supplier_article_number,
  display_name,
  gtin,
  purchase_unit,
  package_amount,
  package_unit,
  minimum_order_units,
  catch_weight
on public.supplier_products
for each row execute function public.set_supplier_product_fingerprint();

alter table public.ingredient_supplier_matches
  add column supplier_account_id uuid,
  add column approved_product_fingerprint text;

update public.ingredient_supplier_matches as ingredient_match
set
  supplier_account_id = product.supplier_account_id,
  approved_product_fingerprint = case
    when ingredient_match.approved_by is not null
      and ingredient_match.approved_at is not null
    then product.product_fingerprint
    else null
  end
from public.supplier_products as product
where product.organization_id = ingredient_match.organization_id
  and product.id = ingredient_match.supplier_product_id;

alter table public.ingredient_supplier_matches
  alter column supplier_account_id set not null,
  add constraint ingredient_supplier_matches_account_product_fk
    foreign key (
      organization_id,
      supplier_account_id,
      supplier_product_id
    )
    references public.supplier_products (
      organization_id,
      supplier_account_id,
      id
    )
    on delete cascade,
  add constraint ingredient_supplier_matches_approved_fingerprint_pair
    check (
      (
        approved_by is null
        and approved_at is null
        and approved_product_fingerprint is null
      )
      or (
        approved_by is not null
        and approved_at is not null
        and approved_product_fingerprint ~ '^[0-9a-f]{64}$'
      )
    );

create function public.set_ingredient_supplier_match_product_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_supplier_account_id uuid;
  current_product_fingerprint text;
begin
  select
    product.supplier_account_id,
    product.product_fingerprint
  into
    current_supplier_account_id,
    current_product_fingerprint
  from public.supplier_products as product
  where product.organization_id = new.organization_id
    and product.id = new.supplier_product_id;

  if current_supplier_account_id is null then
    raise exception 'Supplier product does not belong to the organization'
      using errcode = '22023';
  end if;

  new.supplier_account_id := current_supplier_account_id;
  if new.approved_by is not null and new.approved_at is not null then
    new.approved_product_fingerprint := current_product_fingerprint;
  else
    new.approved_product_fingerprint := null;
  end if;

  return new;
end;
$$;

create trigger ingredient_supplier_matches_set_product_snapshot
before insert or update of
  supplier_product_id,
  approved_by,
  approved_at
on public.ingredient_supplier_matches
for each row
execute function public.set_ingredient_supplier_match_product_snapshot();

create index ingredient_supplier_matches_account_product_idx
  on public.ingredient_supplier_matches (
    organization_id,
    supplier_account_id,
    supplier_product_id
  );

create index supplier_products_catalogue_search_idx
  on public.supplier_products (
    organization_id,
    supplier_account_id,
    normalized_search_name
  );

create table public.supplier_import_column_profiles (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  supplier_account_id uuid not null,
  profile_name text not null
    check (length(trim(profile_name)) between 1 and 120),
  source_kind text not null
    check (source_kind in ('csv', 'xlsx', 'json', 'api')),
  column_mapping jsonb not null
    check (
      jsonb_typeof(column_mapping) = 'array'
      and pg_column_size(column_mapping) <= 100000
    ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, supplier_account_id, id),
  constraint supplier_import_column_profiles_name_unique
    unique (organization_id, supplier_account_id, profile_name),
  constraint supplier_import_column_profiles_account_fk
    foreign key (organization_id, supplier_account_id)
    references public.supplier_accounts (organization_id, id)
    on delete cascade
);

create table public.supplier_import_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  supplier_account_id uuid not null,
  column_profile_id uuid,
  source_name text not null
    check (
      length(trim(source_name)) between 1 and 255
      and source_name !~ '[/\\]'
    ),
  source_kind text not null
    check (source_kind in ('csv', 'xlsx', 'json', 'api')),
  source_fingerprint text not null
    check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null default 'staging'
    check (status in ('staging', 'finalized', 'failed')),
  staged_row_count integer not null default 0
    check (staged_row_count >= 0),
  valid_row_count integer not null default 0
    check (valid_row_count >= 0),
  invalid_row_count integer not null default 0
    check (invalid_row_count >= 0),
  error_summary jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(error_summary) = 'object'
      and pg_column_size(error_summary) <= 100000
    ),
  started_by uuid not null references auth.users(id) on delete restrict,
  finalized_by uuid references auth.users(id) on delete restrict,
  started_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (organization_id, supplier_account_id, id),
  constraint supplier_import_runs_source_unique
    unique (
      organization_id,
      supplier_account_id,
      source_fingerprint
    ),
  constraint supplier_import_runs_finalization_pair
    check (
      (status = 'staging' and finalized_by is null and finalized_at is null)
      or (
        status in ('finalized', 'failed')
        and finalized_by is not null
        and finalized_at is not null
      )
    ),
  constraint supplier_import_runs_account_fk
    foreign key (organization_id, supplier_account_id)
    references public.supplier_accounts (organization_id, id)
    on delete cascade,
  constraint supplier_import_runs_profile_fk
    foreign key (
      organization_id,
      supplier_account_id,
      column_profile_id
    )
    references public.supplier_import_column_profiles (
      organization_id,
      supplier_account_id,
      id
    )
    on delete restrict
);

alter table public.supplier_products
  add column latest_import_run_id uuid,
  add constraint supplier_products_latest_import_fk
    foreign key (
      organization_id,
      supplier_account_id,
      latest_import_run_id
    )
    references public.supplier_import_runs (
      organization_id,
      supplier_account_id,
      id
    )
    on delete set null;

create table public.supplier_import_rows (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  supplier_account_id uuid not null,
  import_run_id uuid not null,
  source_row integer not null check (source_row > 0),
  raw_data jsonb not null
    check (
      jsonb_typeof(raw_data) = 'object'
      and pg_column_size(raw_data) <= 100000
    ),
  normalized_data jsonb not null
    check (
      jsonb_typeof(normalized_data) = 'object'
      and pg_column_size(normalized_data) <= 100000
    ),
  row_fingerprint text not null
    check (row_fingerprint ~ '^[0-9a-f]{64}$'),
  validation_errors jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(validation_errors) = 'array'
      and pg_column_size(validation_errors) <= 100000
    ),
  supplier_product_id uuid,
  staged_by uuid not null references auth.users(id) on delete restrict,
  staged_at timestamptz not null default now(),
  imported_at timestamptz,
  constraint supplier_import_rows_source_unique
    unique (organization_id, import_run_id, source_row),
  constraint supplier_import_rows_run_fk
    foreign key (
      organization_id,
      supplier_account_id,
      import_run_id
    )
    references public.supplier_import_runs (
      organization_id,
      supplier_account_id,
      id
    )
    on delete cascade,
  constraint supplier_import_rows_product_fk
    foreign key (
      organization_id,
      supplier_account_id,
      supplier_product_id
    )
    references public.supplier_products (
      organization_id,
      supplier_account_id,
      id
    )
    on delete set null
);

create table public.supplier_match_candidates (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  supplier_account_id uuid not null,
  canonical_key text not null,
  supplier_product_id uuid not null,
  import_run_id uuid,
  matcher_version text not null
    check (
      length(trim(matcher_version)) between 1 and 80
      and matcher_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$'
    ),
  status text not null
    check (
      status in (
        'safe',
        'review',
        'accepted',
        'rejected',
        'superseded'
      )
    ),
  score numeric(5,2) not null check (score between 0 and 100),
  signals jsonb not null
    check (
      jsonb_typeof(signals) = 'object'
      and pg_column_size(signals) <= 100000
    ),
  product_fingerprint text not null
    check (product_fingerprint ~ '^[0-9a-f]{64}$'),
  required_unit text not null
    check (length(trim(required_unit)) between 1 and 30),
  amount_per_purchase_unit numeric(20,6) not null
    check (amount_per_purchase_unit > 0),
  generated_by uuid not null references auth.users(id) on delete restrict,
  generated_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete restrict,
  decided_at timestamptz,
  decision_source text
    check (decision_source is null or decision_source in ('human', 'batch')),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint supplier_match_candidates_safe_threshold
    check (status <> 'safe' or score >= 96),
  constraint supplier_match_candidates_decision_pair
    check (
      (
        status in ('safe', 'review', 'superseded')
        and decided_by is null
        and decided_at is null
        and decision_source is null
      )
      or (
        status in ('accepted', 'rejected')
        and decided_by is not null
        and decided_at is not null
        and decision_source is not null
      )
    ),
  constraint supplier_match_candidates_account_fk
    foreign key (organization_id, supplier_account_id)
    references public.supplier_accounts (organization_id, id)
    on delete cascade,
  constraint supplier_match_candidates_canonical_fk
    foreign key (organization_id, canonical_key)
    references public.canonical_ingredients (organization_id, canonical_key)
    on delete restrict,
  constraint supplier_match_candidates_product_fk
    foreign key (
      organization_id,
      supplier_account_id,
      supplier_product_id
    )
    references public.supplier_products (
      organization_id,
      supplier_account_id,
      id
    )
    on delete cascade,
  constraint supplier_match_candidates_import_run_fk
    foreign key (
      organization_id,
      supplier_account_id,
      import_run_id
    )
    references public.supplier_import_runs (
      organization_id,
      supplier_account_id,
      id
    )
    on delete set null
);

create unique index supplier_match_candidates_open_unique
  on public.supplier_match_candidates (
    organization_id,
    supplier_account_id,
    canonical_key,
    supplier_product_id,
    matcher_version
  )
  where status in ('safe', 'review');

create table public.preferred_supplier_matches (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  canonical_key text not null,
  supplier_account_id uuid not null,
  ingredient_supplier_match_id uuid not null,
  supplier_product_id uuid not null,
  selected_by uuid not null references auth.users(id) on delete restrict,
  selected_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, canonical_key, supplier_account_id),
  constraint preferred_supplier_matches_account_fk
    foreign key (organization_id, supplier_account_id)
    references public.supplier_accounts (organization_id, id)
    on delete cascade,
  constraint preferred_supplier_matches_canonical_fk
    foreign key (organization_id, canonical_key)
    references public.canonical_ingredients (organization_id, canonical_key)
    on delete restrict,
  constraint preferred_supplier_matches_match_fk
    foreign key (
      organization_id,
      canonical_key,
      supplier_product_id
    )
    references public.ingredient_supplier_matches (
      organization_id,
      canonical_key,
      supplier_product_id
    )
    on delete cascade,
  constraint preferred_supplier_matches_match_id_fk
    foreign key (organization_id, ingredient_supplier_match_id)
    references public.ingredient_supplier_matches (organization_id, id)
    on delete cascade,
  constraint preferred_supplier_matches_product_fk
    foreign key (
      organization_id,
      supplier_account_id,
      supplier_product_id
    )
    references public.supplier_products (
      organization_id,
      supplier_account_id,
      id
    )
    on delete cascade
);

create index supplier_import_column_profiles_created_by_idx
  on public.supplier_import_column_profiles (created_by);
create index supplier_import_runs_profile_idx
  on public.supplier_import_runs (
    organization_id,
    supplier_account_id,
    column_profile_id
  );
create index supplier_import_runs_started_by_idx
  on public.supplier_import_runs (started_by);
create index supplier_import_runs_finalized_by_idx
  on public.supplier_import_runs (finalized_by);
create index supplier_products_latest_import_idx
  on public.supplier_products (
    organization_id,
    supplier_account_id,
    latest_import_run_id
  );
create index supplier_import_rows_run_idx
  on public.supplier_import_rows (
    organization_id,
    supplier_account_id,
    import_run_id
  );
create index supplier_import_rows_product_idx
  on public.supplier_import_rows (
    organization_id,
    supplier_account_id,
    supplier_product_id
  );
create index supplier_import_rows_staged_by_idx
  on public.supplier_import_rows (staged_by);
create index supplier_match_candidates_account_idx
  on public.supplier_match_candidates (
    organization_id,
    supplier_account_id
  );
create index supplier_match_candidates_canonical_idx
  on public.supplier_match_candidates (
    organization_id,
    canonical_key
  );
create index supplier_match_candidates_product_idx
  on public.supplier_match_candidates (
    organization_id,
    supplier_account_id,
    supplier_product_id
  );
create index supplier_match_candidates_import_run_idx
  on public.supplier_match_candidates (
    organization_id,
    supplier_account_id,
    import_run_id
  );
create index supplier_match_candidates_generated_by_idx
  on public.supplier_match_candidates (generated_by);
create index supplier_match_candidates_decided_by_idx
  on public.supplier_match_candidates (decided_by);
create index preferred_supplier_matches_account_idx
  on public.preferred_supplier_matches (
    organization_id,
    supplier_account_id
  );
create index preferred_supplier_matches_match_id_idx
  on public.preferred_supplier_matches (
    organization_id,
    ingredient_supplier_match_id
  );
create index preferred_supplier_matches_match_idx
  on public.preferred_supplier_matches (
    organization_id,
    canonical_key,
    supplier_product_id
  );
create index preferred_supplier_matches_product_idx
  on public.preferred_supplier_matches (
    organization_id,
    supplier_account_id,
    supplier_product_id
  );
create index preferred_supplier_matches_selected_by_idx
  on public.preferred_supplier_matches (selected_by);

create trigger supplier_import_column_profiles_set_updated_at
before update on public.supplier_import_column_profiles
for each row execute function public.set_updated_at();

create trigger supplier_match_candidates_set_updated_at
before update on public.supplier_match_candidates
for each row execute function public.set_updated_at();

create trigger preferred_supplier_matches_set_updated_at
before update on public.preferred_supplier_matches
for each row execute function public.set_updated_at();

create function public.supplier_import_row_errors(p_normalized_data jsonb)
returns jsonb
language plpgsql
stable
parallel safe
set search_path = ''
as $$
declare
  errors jsonb := '[]'::jsonb;
  package_amount numeric;
  minimum_order_units integer;
  price numeric;
begin
  if p_normalized_data is null
    or jsonb_typeof(p_normalized_data) <> 'object' then
    return '["normalized_data_must_be_an_object"]'::jsonb;
  end if;

  if (
    p_normalized_data - array[
      'supplier_article_number',
      'display_name',
      'gtin',
      'purchase_unit',
      'package_amount',
      'package_unit',
      'minimum_order_units',
      'price',
      'currency',
      'availability_status',
      'valid_from',
      'valid_to',
      'category',
      'brand',
      'catch_weight',
      'packaging_metadata',
      'metadata'
    ]
  ) <> '{}'::jsonb then
    errors := errors || '["unknown_field"]'::jsonb;
  end if;

  if jsonb_typeof(p_normalized_data -> 'supplier_article_number') <> 'string'
    or length(trim(coalesce(
      p_normalized_data ->> 'supplier_article_number',
      ''
    ))) not between 1 and 120 then
    errors := errors || '["invalid_supplier_article_number"]'::jsonb;
  end if;

  if jsonb_typeof(p_normalized_data -> 'display_name') <> 'string'
    or length(trim(coalesce(
      p_normalized_data ->> 'display_name',
      ''
    ))) not between 1 and 240 then
    errors := errors || '["invalid_display_name"]'::jsonb;
  end if;

  if jsonb_typeof(p_normalized_data -> 'purchase_unit') <> 'string'
    or length(trim(coalesce(
      p_normalized_data ->> 'purchase_unit',
      ''
    ))) not between 1 and 40 then
    errors := errors || '["invalid_purchase_unit"]'::jsonb;
  end if;

  package_amount :=
    public.supplier_jsonb_numeric(p_normalized_data -> 'package_amount');
  if package_amount is null
    or package_amount <= 0
    or package_amount > 99999999999999.999999 then
    errors := errors || '["invalid_package_amount"]'::jsonb;
  end if;

  if jsonb_typeof(p_normalized_data -> 'package_unit') <> 'string'
    or length(trim(coalesce(
      p_normalized_data ->> 'package_unit',
      ''
    ))) not between 1 and 40 then
    errors := errors || '["invalid_package_unit"]'::jsonb;
  end if;

  if p_normalized_data ? 'gtin'
    and p_normalized_data -> 'gtin' <> 'null'::jsonb
    and (
      jsonb_typeof(p_normalized_data -> 'gtin') <> 'string'
      or length(p_normalized_data ->> 'gtin') not in (8, 12, 13, 14)
      or (p_normalized_data ->> 'gtin') !~ '^[0-9]+$'
    ) then
    errors := errors || '["invalid_gtin"]'::jsonb;
  end if;

  if p_normalized_data ? 'minimum_order_units' then
    minimum_order_units := public.supplier_jsonb_integer(
      p_normalized_data -> 'minimum_order_units'
    );
    if minimum_order_units is null
      or minimum_order_units <= 0
      or minimum_order_units > 1000000 then
      errors := errors || '["invalid_minimum_order_units"]'::jsonb;
    end if;
  end if;

  if p_normalized_data ? 'price'
    and p_normalized_data -> 'price' <> 'null'::jsonb then
    price := public.supplier_jsonb_numeric(p_normalized_data -> 'price');
    if price is null
      or price < 0
      or price > 9999999999999999.9999 then
      errors := errors || '["invalid_price"]'::jsonb;
    end if;
  end if;

  if p_normalized_data ? 'currency'
    and (
      jsonb_typeof(p_normalized_data -> 'currency') <> 'string'
      or upper(trim(p_normalized_data ->> 'currency')) !~ '^[A-Z]{3}$'
    ) then
    errors := errors || '["invalid_currency"]'::jsonb;
  end if;

  if p_normalized_data ? 'availability_status'
    and (
      jsonb_typeof(p_normalized_data -> 'availability_status') <> 'string'
      or lower(trim(p_normalized_data ->> 'availability_status'))
        !~ '^[a-z][a-z0-9_-]{0,39}$'
    ) then
    errors := errors || '["invalid_availability_status"]'::jsonb;
  end if;

  if p_normalized_data ? 'valid_from'
    and p_normalized_data -> 'valid_from' <> 'null'::jsonb
    and (
      jsonb_typeof(p_normalized_data -> 'valid_from') <> 'string'
      or not pg_catalog.pg_input_is_valid(
        p_normalized_data ->> 'valid_from',
        'date'
      )
    ) then
    errors := errors || '["invalid_valid_from"]'::jsonb;
  end if;

  if p_normalized_data ? 'valid_to'
    and p_normalized_data -> 'valid_to' <> 'null'::jsonb
    and (
      jsonb_typeof(p_normalized_data -> 'valid_to') <> 'string'
      or not pg_catalog.pg_input_is_valid(
        p_normalized_data ->> 'valid_to',
        'date'
      )
    ) then
    errors := errors || '["invalid_valid_to"]'::jsonb;
  end if;

  if jsonb_typeof(p_normalized_data -> 'valid_from') = 'string'
    and jsonb_typeof(p_normalized_data -> 'valid_to') = 'string'
    and pg_catalog.pg_input_is_valid(
      p_normalized_data ->> 'valid_from',
      'date'
    )
    and pg_catalog.pg_input_is_valid(
      p_normalized_data ->> 'valid_to',
      'date'
    )
    and (p_normalized_data ->> 'valid_to')::date
      < (p_normalized_data ->> 'valid_from')::date then
    errors := errors || '["invalid_valid_period"]'::jsonb;
  end if;

  if p_normalized_data ? 'metadata'
    and (
      jsonb_typeof(p_normalized_data -> 'metadata') <> 'object'
      or pg_column_size(p_normalized_data -> 'metadata') > 50000
    ) then
    errors := errors || '["invalid_metadata"]'::jsonb;
  end if;

  if p_normalized_data ? 'category'
    and p_normalized_data -> 'category' <> 'null'::jsonb
    and (
      jsonb_typeof(p_normalized_data -> 'category') <> 'string'
      or length(trim(p_normalized_data ->> 'category'))
        not between 1 and 160
    ) then
    errors := errors || '["invalid_category"]'::jsonb;
  end if;

  if p_normalized_data ? 'brand'
    and p_normalized_data -> 'brand' <> 'null'::jsonb
    and (
      jsonb_typeof(p_normalized_data -> 'brand') <> 'string'
      or length(trim(p_normalized_data ->> 'brand'))
        not between 1 and 160
    ) then
    errors := errors || '["invalid_brand"]'::jsonb;
  end if;

  if p_normalized_data ? 'catch_weight'
    and jsonb_typeof(p_normalized_data -> 'catch_weight') <> 'boolean' then
    errors := errors || '["invalid_catch_weight"]'::jsonb;
  end if;

  if p_normalized_data ? 'packaging_metadata'
    and (
      jsonb_typeof(p_normalized_data -> 'packaging_metadata') <> 'object'
      or pg_column_size(p_normalized_data -> 'packaging_metadata') > 50000
    ) then
    errors := errors || '["invalid_packaging_metadata"]'::jsonb;
  end if;

  return errors;
end;
$$;

create function public.save_supplier_account_identity(
  p_organization_id uuid,
  p_account_key uuid,
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

  if p_account_key is null
    or normalized_provider_key
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
    account_key,
    provider_key,
    display_name,
    customer_number,
    active,
    created_by
  ) values (
    p_organization_id,
    p_account_key,
    normalized_provider_key,
    trim(p_display_name),
    normalized_customer_number,
    true,
    actor_user_id
  )
  on conflict on constraint supplier_accounts_account_key_unique
  do update set
    provider_key = excluded.provider_key,
    display_name = excluded.display_name,
    customer_number = excluded.customer_number,
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
    'supplier_account_identity_saved',
    'supplier_account',
    saved_account_id::text,
    jsonb_build_object(
      'account_key', p_account_key,
      'provider_key', normalized_provider_key
    )
  );

  return saved_account_id;
end;
$$;

create function public.save_supplier_import_column_profile(
  p_organization_id uuid,
  p_supplier_account_id uuid,
  p_profile_name text,
  p_source_kind text,
  p_column_mapping jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  normalized_source_kind text :=
    lower(trim(coalesce(p_source_kind, '')));
  mapping_targets text[];
  saved_profile_id uuid;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.supplier_accounts as account
    where account.organization_id = p_organization_id
      and account.id = p_supplier_account_id
      and account.active
  ) then
    raise exception 'Active supplier account required'
      using errcode = '22023';
  end if;

  if length(trim(coalesce(p_profile_name, ''))) not between 1 and 120
    or normalized_source_kind not in ('csv', 'xlsx', 'json', 'api')
    or jsonb_typeof(p_column_mapping) <> 'array'
    or pg_column_size(p_column_mapping) > 100000 then
    raise exception 'Column profile failed validation'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_column_mapping) not between 1 and 250 then
    raise exception 'Column profile failed validation'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_column_mapping) as mapping(value)
    where jsonb_typeof(mapping.value) <> 'object'
      or (
        mapping.value - array['index', 'source', 'target']
      ) <> '{}'::jsonb
      or public.supplier_jsonb_integer(mapping.value -> 'index') is null
      or public.supplier_jsonb_integer(mapping.value -> 'index')
        not between 0 and 10000
      or jsonb_typeof(mapping.value -> 'source') <> 'string'
      or length(trim(mapping.value ->> 'source')) not between 1 and 200
      or jsonb_typeof(mapping.value -> 'target') <> 'string'
      or mapping.value ->> 'target' not in (
        'supplier_article_number',
        'display_name',
        'purchase_unit',
        'total_quantity',
        'total_amount',
        'total_unit',
        'gtin',
        'price',
        'minimum_order_units',
        'valid_from',
        'valid_to',
        'category',
        'brand',
        'catch_weight',
        'ignore'
      )
  ) or exists (
    select 1
    from jsonb_array_elements(p_column_mapping) as mapping(value)
    group by public.supplier_jsonb_integer(mapping.value -> 'index')
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(p_column_mapping) as mapping(value)
    where mapping.value ->> 'target' <> 'ignore'
    group by mapping.value ->> 'target'
    having count(*) > 1
  ) then
    raise exception 'Column mapping failed validation'
      using errcode = '22023';
  end if;

  select coalesce(
    array_agg(mapping.value ->> 'target') filter (
      where mapping.value ->> 'target' <> 'ignore'
    ),
    array[]::text[]
  )
  into mapping_targets
  from jsonb_array_elements(p_column_mapping) as mapping(value);

  if not (
    mapping_targets @> array[
      'supplier_article_number',
      'display_name',
      'purchase_unit'
    ]
    and (
      'total_quantity' = any(mapping_targets)
      or mapping_targets @> array['total_amount', 'total_unit']
    )
  ) then
    raise exception 'Column mapping failed validation'
      using errcode = '22023';
  end if;

  insert into public.supplier_import_column_profiles as profile (
    organization_id,
    supplier_account_id,
    profile_name,
    source_kind,
    column_mapping,
    created_by
  ) values (
    p_organization_id,
    p_supplier_account_id,
    trim(p_profile_name),
    normalized_source_kind,
    p_column_mapping,
    actor_user_id
  )
  on conflict on constraint supplier_import_column_profiles_name_unique
  do update set
    source_kind = excluded.source_kind,
    column_mapping = excluded.column_mapping,
    updated_at = now()
  returning id into saved_profile_id;

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
    'supplier_import_column_profile_saved',
    'supplier_import_column_profile',
    saved_profile_id::text,
    jsonb_build_object(
      'supplier_account_id', p_supplier_account_id,
      'source_kind', normalized_source_kind
    )
  );

  return saved_profile_id;
end;
$$;

create function public.start_supplier_import(
  p_organization_id uuid,
  p_supplier_account_id uuid,
  p_column_profile_id uuid,
  p_source_name text,
  p_source_kind text,
  p_source_fingerprint text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  normalized_source_kind text :=
    lower(trim(coalesce(p_source_kind, '')));
  normalized_source_fingerprint text :=
    lower(trim(coalesce(p_source_fingerprint, '')));
  saved_import_run_id uuid;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.supplier_accounts as account
    where account.organization_id = p_organization_id
      and account.id = p_supplier_account_id
      and account.active
  ) then
    raise exception 'Active supplier account required'
      using errcode = '22023';
  end if;

  if length(trim(coalesce(p_source_name, ''))) not between 1 and 255
    or p_source_name ~ '[/\\]'
    or normalized_source_kind not in ('csv', 'xlsx', 'json', 'api')
    or normalized_source_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Supplier import parameters failed validation'
      using errcode = '22023';
  end if;

  if p_column_profile_id is not null
    and not exists (
      select 1
      from public.supplier_import_column_profiles as profile
      where profile.organization_id = p_organization_id
        and profile.supplier_account_id = p_supplier_account_id
        and profile.id = p_column_profile_id
        and profile.source_kind = normalized_source_kind
    ) then
    raise exception 'Compatible supplier import column profile required'
      using errcode = '22023';
  end if;

  insert into public.supplier_import_runs (
    organization_id,
    supplier_account_id,
    column_profile_id,
    source_name,
    source_kind,
    source_fingerprint,
    started_by
  ) values (
    p_organization_id,
    p_supplier_account_id,
    p_column_profile_id,
    trim(p_source_name),
    normalized_source_kind,
    normalized_source_fingerprint,
    actor_user_id
  )
  on conflict on constraint supplier_import_runs_source_unique
  do nothing
  returning id into saved_import_run_id;

  if saved_import_run_id is null then
    select import_run.id
    into saved_import_run_id
    from public.supplier_import_runs as import_run
    where import_run.organization_id = p_organization_id
      and import_run.supplier_account_id = p_supplier_account_id
      and import_run.source_fingerprint = normalized_source_fingerprint;
  else
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
      'supplier_import_started',
      'supplier_import_run',
      saved_import_run_id::text,
      jsonb_build_object(
        'supplier_account_id', p_supplier_account_id,
        'source_kind', normalized_source_kind
      )
    );
  end if;

  return saved_import_run_id;
end;
$$;

create function public.stage_supplier_import_rows(
  p_organization_id uuid,
  p_supplier_account_id uuid,
  p_import_run_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  row_data jsonb;
  normalized_data jsonb;
  validation_errors jsonb;
  staged_count integer;
  valid_count integer;
  invalid_count integer;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  perform 1
  from public.supplier_import_runs as import_run
  join public.supplier_accounts as account
    on account.organization_id = import_run.organization_id
    and account.id = import_run.supplier_account_id
  where import_run.organization_id = p_organization_id
    and import_run.supplier_account_id = p_supplier_account_id
    and import_run.id = p_import_run_id
    and import_run.status = 'staging'
    and account.active
  for update of import_run;

  if not found then
    raise exception 'Active staging import run required'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Import batch must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) not between 1 and 500
    or pg_column_size(p_rows) > 5000000 then
    raise exception 'Import batch must contain 1 to 500 bounded rows'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or (
        item.value - array['source_row', 'raw_data', 'normalized_data']
      ) <> '{}'::jsonb
      or public.supplier_jsonb_integer(item.value -> 'source_row') is null
      or public.supplier_jsonb_integer(item.value -> 'source_row') <= 0
      or jsonb_typeof(item.value -> 'raw_data') <> 'object'
      or pg_column_size(item.value -> 'raw_data') > 100000
      or jsonb_typeof(item.value -> 'normalized_data') <> 'object'
      or pg_column_size(item.value -> 'normalized_data') > 100000
  ) or exists (
    select 1
    from jsonb_array_elements(p_rows) as item(value)
    group by public.supplier_jsonb_integer(item.value -> 'source_row')
    having count(*) > 1
  ) then
    raise exception 'Import batch rows failed structural validation'
      using errcode = '22023';
  end if;

  if (
    select count(*)
    from public.supplier_import_rows as existing_row
    where existing_row.organization_id = p_organization_id
      and existing_row.import_run_id = p_import_run_id
      and not exists (
        select 1
        from jsonb_array_elements(p_rows) as item(value)
        where public.supplier_jsonb_integer(
          item.value -> 'source_row'
        ) = existing_row.source_row
      )
  ) + jsonb_array_length(p_rows) > 50000 then
    raise exception 'Supplier import exceeds 50000 staged rows'
      using errcode = '22023';
  end if;

  for row_data in
    select item.value
    from jsonb_array_elements(p_rows) as item(value)
  loop
    normalized_data := row_data -> 'normalized_data';
    validation_errors :=
      public.supplier_import_row_errors(normalized_data);

    insert into public.supplier_import_rows (
      organization_id,
      supplier_account_id,
      import_run_id,
      source_row,
      raw_data,
      normalized_data,
      row_fingerprint,
      validation_errors,
      supplier_product_id,
      staged_by,
      staged_at,
      imported_at
    ) values (
      p_organization_id,
      p_supplier_account_id,
      p_import_run_id,
      public.supplier_jsonb_integer(row_data -> 'source_row'),
      row_data -> 'raw_data',
      normalized_data,
      encode(
        extensions.digest(
          convert_to(normalized_data::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
      validation_errors,
      null,
      actor_user_id,
      now(),
      null
    )
    on conflict on constraint supplier_import_rows_source_unique
    do update set
      raw_data = excluded.raw_data,
      normalized_data = excluded.normalized_data,
      row_fingerprint = excluded.row_fingerprint,
      validation_errors = excluded.validation_errors,
      supplier_product_id = null,
      staged_by = excluded.staged_by,
      staged_at = now(),
      imported_at = null;
  end loop;

  select
    count(*)::integer,
    count(*) filter (
      where staged_row.validation_errors = '[]'::jsonb
    )::integer,
    count(*) filter (
      where staged_row.validation_errors <> '[]'::jsonb
    )::integer
  into staged_count, valid_count, invalid_count
  from public.supplier_import_rows as staged_row
  where staged_row.organization_id = p_organization_id
    and staged_row.import_run_id = p_import_run_id;

  update public.supplier_import_runs
  set
    staged_row_count = staged_count,
    valid_row_count = valid_count,
    invalid_row_count = invalid_count,
    error_summary = jsonb_build_object(
      'invalid_rows', invalid_count
    )
  where organization_id = p_organization_id
    and supplier_account_id = p_supplier_account_id
    and id = p_import_run_id;

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
    'supplier_import_rows_staged',
    'supplier_import_run',
    p_import_run_id::text,
    jsonb_build_object(
      'batch_rows', jsonb_array_length(p_rows),
      'staged_rows', staged_count,
      'valid_rows', valid_count,
      'invalid_rows', invalid_count
    )
  );

  return jsonb_build_object(
    'import_run_id', p_import_run_id,
    'staged_rows', staged_count,
    'valid_rows', valid_count,
    'invalid_rows', invalid_count
  );
end;
$$;

create function public.finalize_supplier_import(
  p_organization_id uuid,
  p_supplier_account_id uuid,
  p_import_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  import_status text;
  staged_count integer;
  valid_count integer;
  invalid_count integer;
  imported_count integer := 0;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  select import_run.status
  into import_status
  from public.supplier_import_runs as import_run
  join public.supplier_accounts as account
    on account.organization_id = import_run.organization_id
    and account.id = import_run.supplier_account_id
  where import_run.organization_id = p_organization_id
    and import_run.supplier_account_id = p_supplier_account_id
    and import_run.id = p_import_run_id
    and account.active
  for update of import_run;

  if not found then
    raise exception 'Active supplier import run required'
      using errcode = '22023';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where staged_row.validation_errors = '[]'::jsonb
    )::integer,
    count(*) filter (
      where staged_row.validation_errors <> '[]'::jsonb
    )::integer
  into staged_count, valid_count, invalid_count
  from public.supplier_import_rows as staged_row
  where staged_row.organization_id = p_organization_id
    and staged_row.import_run_id = p_import_run_id;

  if import_status = 'finalized' then
    return jsonb_build_object(
      'import_run_id', p_import_run_id,
      'status', 'finalized',
      'staged_rows', staged_count,
      'imported_rows', valid_count,
      'invalid_rows', invalid_count
    );
  end if;

  if import_status <> 'staging' then
    raise exception 'Only staging imports can be finalized'
      using errcode = '22023';
  end if;

  if staged_count = 0 then
    raise exception 'Supplier import has no staged rows'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.supplier_import_rows as staged_row
    where staged_row.organization_id = p_organization_id
      and staged_row.import_run_id = p_import_run_id
      and staged_row.validation_errors = '[]'::jsonb
    group by lower(trim(
      staged_row.normalized_data ->> 'supplier_article_number'
    ))
    having count(*) > 1
  ) then
    raise exception
      'Valid import rows contain duplicate supplier article numbers'
      using errcode = '22023';
  end if;

  insert into public.supplier_products as product (
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
    source_metadata,
    brand,
    category,
    packaging_metadata,
    catch_weight,
    latest_import_run_id,
    created_by
  )
  select
    p_organization_id,
    p_supplier_account_id,
    trim(staged_row.normalized_data ->> 'supplier_article_number'),
    trim(staged_row.normalized_data ->> 'display_name'),
    nullif(trim(staged_row.normalized_data ->> 'gtin'), ''),
    trim(staged_row.normalized_data ->> 'purchase_unit'),
    public.supplier_jsonb_numeric(
      staged_row.normalized_data -> 'package_amount'
    ),
    trim(staged_row.normalized_data ->> 'package_unit'),
    coalesce(
      public.supplier_jsonb_integer(
        staged_row.normalized_data -> 'minimum_order_units'
      ),
      1
    ),
    true,
    'import:' || import_run.source_kind,
    now(),
    coalesce(staged_row.normalized_data -> 'metadata', '{}'::jsonb),
    nullif(trim(staged_row.normalized_data ->> 'brand'), ''),
    nullif(trim(staged_row.normalized_data ->> 'category'), ''),
    coalesce(
      staged_row.normalized_data -> 'packaging_metadata',
      jsonb_build_object(
        'normalization_version', 'supplier-import-v1',
        'purchase_unit',
          trim(staged_row.normalized_data ->> 'purchase_unit'),
        'package_amount',
          public.supplier_jsonb_numeric(
            staged_row.normalized_data -> 'package_amount'
          ),
        'package_unit',
          trim(staged_row.normalized_data ->> 'package_unit')
      )
    ),
    coalesce(
      (staged_row.normalized_data ->> 'catch_weight')::boolean,
      false
    ),
    p_import_run_id,
    actor_user_id
  from public.supplier_import_rows as staged_row
  join public.supplier_import_runs as import_run
    on import_run.organization_id = staged_row.organization_id
    and import_run.id = staged_row.import_run_id
  where staged_row.organization_id = p_organization_id
    and staged_row.supplier_account_id = p_supplier_account_id
    and staged_row.import_run_id = p_import_run_id
    and staged_row.validation_errors = '[]'::jsonb
  on conflict on constraint supplier_products_article_unique
  do update set
    display_name = excluded.display_name,
    gtin = excluded.gtin,
    purchase_unit = excluded.purchase_unit,
    package_amount = excluded.package_amount,
    package_unit = excluded.package_unit,
    minimum_order_units = excluded.minimum_order_units,
    active = true,
    product_data_source = excluded.product_data_source,
    source_updated_at = excluded.source_updated_at,
    source_metadata = excluded.source_metadata,
    brand = excluded.brand,
    category = excluded.category,
    packaging_metadata = excluded.packaging_metadata,
    catch_weight = excluded.catch_weight,
    latest_import_run_id = excluded.latest_import_run_id,
    updated_at = now();

  get diagnostics imported_count = row_count;

  insert into public.supplier_offers as offer (
    organization_id,
    supplier_product_id,
    price,
    currency,
    availability_status,
    valid_from,
    valid_to,
    fetched_at
  )
  select
    p_organization_id,
    product.id,
    public.supplier_jsonb_numeric(staged_row.normalized_data -> 'price'),
    upper(trim(coalesce(
      staged_row.normalized_data ->> 'currency',
      'SEK'
    ))),
    lower(trim(coalesce(
      staged_row.normalized_data ->> 'availability_status',
      'unknown'
    ))),
    (staged_row.normalized_data ->> 'valid_from')::date,
    (staged_row.normalized_data ->> 'valid_to')::date,
    now()
  from public.supplier_import_rows as staged_row
  join public.supplier_products as product
    on product.organization_id = staged_row.organization_id
    and product.supplier_account_id = staged_row.supplier_account_id
    and product.supplier_article_number =
      trim(staged_row.normalized_data ->> 'supplier_article_number')
  where staged_row.organization_id = p_organization_id
    and staged_row.supplier_account_id = p_supplier_account_id
    and staged_row.import_run_id = p_import_run_id
    and staged_row.validation_errors = '[]'::jsonb
    and (
      staged_row.normalized_data ? 'price'
      or staged_row.normalized_data ? 'availability_status'
      or staged_row.normalized_data ? 'valid_from'
      or staged_row.normalized_data ? 'valid_to'
    )
  on conflict on constraint supplier_offers_product_period_unique
  do update set
    price = excluded.price,
    currency = excluded.currency,
    availability_status = excluded.availability_status,
    fetched_at = now(),
    updated_at = now();

  update public.supplier_import_rows as staged_row
  set
    supplier_product_id = product.id,
    imported_at = now()
  from public.supplier_products as product
  where staged_row.organization_id = p_organization_id
    and staged_row.supplier_account_id = p_supplier_account_id
    and staged_row.import_run_id = p_import_run_id
    and staged_row.validation_errors = '[]'::jsonb
    and product.organization_id = staged_row.organization_id
    and product.supplier_account_id = staged_row.supplier_account_id
    and product.supplier_article_number =
      trim(staged_row.normalized_data ->> 'supplier_article_number');

  update public.supplier_import_runs
  set
    status = 'finalized',
    staged_row_count = staged_count,
    valid_row_count = valid_count,
    invalid_row_count = invalid_count,
    error_summary = jsonb_build_object('invalid_rows', invalid_count),
    finalized_by = actor_user_id,
    finalized_at = now()
  where organization_id = p_organization_id
    and supplier_account_id = p_supplier_account_id
    and id = p_import_run_id;

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
    'supplier_import_finalized',
    'supplier_import_run',
    p_import_run_id::text,
    jsonb_build_object(
      'supplier_account_id', p_supplier_account_id,
      'staged_rows', staged_count,
      'imported_rows', imported_count,
      'invalid_rows', invalid_count,
      'unseen_products_deactivated', 0
    )
  );

  return jsonb_build_object(
    'import_run_id', p_import_run_id,
    'status', 'finalized',
    'staged_rows', staged_count,
    'imported_rows', imported_count,
    'invalid_rows', invalid_count
  );
end;
$$;

create function public.supplier_safe_match_score(
  p_organization_id uuid,
  p_canonical_key text,
  p_supplier_account_id uuid,
  p_supplier_product_id uuid,
  p_required_unit text
)
returns numeric
language sql
stable
parallel safe
set search_path = ''
as $$
  select case
    when account.active
      and product.active
      and not product.catch_weight
      and length(trim(product.purchase_unit)) > 0
      and product.minimum_order_units > 0
      and public.canonical_ingredient_key(
        canonical.display_name,
        p_required_unit
      ) = p_canonical_key
      and public.normalized_supplier_search_name(
        canonical.display_name
      ) = public.normalized_supplier_match_name(
        product.display_name
      )
      and public.supplier_expected_amount(
        product.package_amount,
        product.package_unit,
        p_required_unit
      ) is not null
    then 80
      + case
          when public.normalized_supplier_unit(product.package_unit)
            = public.normalized_supplier_unit(p_required_unit)
          then 15
          else 12
        end
      + 5
    else null
  end
  from public.canonical_ingredients as canonical
  join public.supplier_products as product
    on product.organization_id = canonical.organization_id
    and product.supplier_account_id = p_supplier_account_id
    and product.id = p_supplier_product_id
  join public.supplier_accounts as account
    on account.organization_id = product.organization_id
    and account.id = product.supplier_account_id
  where canonical.organization_id = p_organization_id
    and canonical.canonical_key = p_canonical_key;
$$;

create function public.is_supplier_candidate_current(
  p_organization_id uuid,
  p_candidate_id uuid,
  p_require_safe boolean
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.supplier_match_candidates as candidate
    join public.canonical_ingredients as canonical
      on canonical.organization_id = candidate.organization_id
      and canonical.canonical_key = candidate.canonical_key
    join public.supplier_products as product
      on product.organization_id = candidate.organization_id
      and product.supplier_account_id = candidate.supplier_account_id
      and product.id = candidate.supplier_product_id
    join public.supplier_accounts as account
      on account.organization_id = candidate.organization_id
      and account.id = candidate.supplier_account_id
    where candidate.organization_id = p_organization_id
      and candidate.id = p_candidate_id
      and candidate.status in ('safe', 'review')
      and (
        not p_require_safe
        or (
          candidate.status = 'safe'
          and candidate.score >= 96
          and not product.catch_weight
          and candidate.score = public.supplier_safe_match_score(
            candidate.organization_id,
            candidate.canonical_key,
            candidate.supplier_account_id,
            candidate.supplier_product_id,
            candidate.required_unit
          )
        )
      )
      and account.active
      and product.active
      and product.product_fingerprint = candidate.product_fingerprint
      and public.canonical_ingredient_key(
        canonical.display_name,
        candidate.required_unit
      ) = candidate.canonical_key
      and public.supplier_expected_amount(
        product.package_amount,
        product.package_unit,
        candidate.required_unit
      ) is not null
      and round(
        public.supplier_expected_amount(
          product.package_amount,
          product.package_unit,
          candidate.required_unit
        ),
        6
      ) = candidate.amount_per_purchase_unit
  );
$$;

create function public.sync_preferred_supplier_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.approved_by is null or new.approved_at is null then
    return new;
  end if;

  insert into public.preferred_supplier_matches as preferred (
    organization_id,
    canonical_key,
    supplier_account_id,
    ingredient_supplier_match_id,
    supplier_product_id,
    selected_by,
    selected_at
  ) values (
    new.organization_id,
    new.canonical_key,
    new.supplier_account_id,
    new.id,
    new.supplier_product_id,
    new.approved_by,
    new.approved_at
  )
  on conflict (
    organization_id,
    canonical_key,
    supplier_account_id
  )
  do update set
    ingredient_supplier_match_id =
      excluded.ingredient_supplier_match_id,
    supplier_product_id = excluded.supplier_product_id,
    selected_by = excluded.selected_by,
    selected_at = excluded.selected_at,
    updated_at = now()
  where preferred.selected_at <= excluded.selected_at;

  return new;
end;
$$;

create trigger ingredient_supplier_matches_sync_preferred
after insert or update of
  supplier_product_id,
  approved_by,
  approved_at
on public.ingredient_supplier_matches
for each row execute function public.sync_preferred_supplier_match();

insert into public.preferred_supplier_matches (
  organization_id,
  canonical_key,
  supplier_account_id,
  ingredient_supplier_match_id,
  supplier_product_id,
  selected_by,
  selected_at
)
select
  candidate.organization_id,
  candidate.canonical_key,
  candidate.supplier_account_id,
  candidate.ingredient_supplier_match_id,
  candidate.supplier_product_id,
  candidate.approved_by,
  candidate.approved_at
from (
  select
    ingredient_match.organization_id,
    ingredient_match.canonical_key,
    product.supplier_account_id,
    ingredient_match.id as ingredient_supplier_match_id,
    ingredient_match.supplier_product_id,
    ingredient_match.approved_by,
    ingredient_match.approved_at,
    row_number() over (
      partition by
        ingredient_match.organization_id,
        ingredient_match.canonical_key,
        product.supplier_account_id
      order by
        ingredient_match.approved_at desc,
        ingredient_match.id desc
    ) as preference_order
  from public.ingredient_supplier_matches as ingredient_match
  join public.supplier_products as product
    on product.organization_id = ingredient_match.organization_id
    and product.id = ingredient_match.supplier_product_id
  where ingredient_match.approved_by is not null
    and ingredient_match.approved_at is not null
) as candidate
where candidate.preference_order = 1;

create function public.replace_supplier_match_candidates(
  p_organization_id uuid,
  p_supplier_account_id uuid,
  p_matcher_version text,
  p_candidates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  normalized_matcher_version text :=
    trim(coalesce(p_matcher_version, ''));
  superseded_count integer := 0;
  inserted_count integer := 0;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.supplier_accounts as account
    where account.organization_id = p_organization_id
      and account.id = p_supplier_account_id
      and account.active
  ) then
    raise exception 'Active supplier account required'
      using errcode = '22023';
  end if;

  if normalized_matcher_version
      !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$' then
    raise exception 'Matcher version failed validation'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'Candidates must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_candidates) > 500
    or pg_column_size(p_candidates) > 2000000 then
    raise exception 'Candidate replacement exceeds its bounded batch'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_candidates) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or (
        item.value - array[
          'canonical_key',
          'supplier_product_id',
          'status',
          'score',
          'signals',
          'product_fingerprint',
          'required_unit',
          'amount_per_purchase_unit',
          'import_run_id'
        ]
      ) <> '{}'::jsonb
      or jsonb_typeof(item.value -> 'canonical_key') <> 'string'
      or item.value ->> 'canonical_key' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(item.value -> 'supplier_product_id') <> 'string'
      or item.value ->> 'supplier_product_id'
        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(item.value -> 'status') <> 'string'
      or item.value ->> 'status' not in ('safe', 'review')
      or public.supplier_jsonb_numeric(item.value -> 'score') is null
      or public.supplier_jsonb_numeric(item.value -> 'score')
        not between 0 and 100
      or (
        item.value ->> 'status' = 'safe'
        and public.supplier_jsonb_numeric(item.value -> 'score') < 96
      )
      or jsonb_typeof(item.value -> 'signals') <> 'object'
      or pg_column_size(item.value -> 'signals') > 100000
      or jsonb_typeof(item.value -> 'product_fingerprint') <> 'string'
      or item.value ->> 'product_fingerprint' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(item.value -> 'required_unit') <> 'string'
      or length(trim(item.value ->> 'required_unit'))
        not between 1 and 30
      or public.supplier_jsonb_numeric(
        item.value -> 'amount_per_purchase_unit'
      ) is null
      or public.supplier_jsonb_numeric(
        item.value -> 'amount_per_purchase_unit'
      ) <= 0
      or public.supplier_jsonb_numeric(
        item.value -> 'amount_per_purchase_unit'
      ) > 99999999999999.999999
      or (
        item.value ? 'import_run_id'
        and item.value -> 'import_run_id' <> 'null'::jsonb
        and (
          jsonb_typeof(item.value -> 'import_run_id') <> 'string'
          or item.value ->> 'import_run_id'
            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      )
  ) then
    raise exception 'Candidate payload failed structural validation'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_candidates) as candidate_data(
      canonical_key text,
      supplier_product_id uuid
    )
    group by
      candidate_data.canonical_key,
      candidate_data.supplier_product_id
    having count(*) > 1
  ) then
    raise exception 'Candidate payload contains duplicates'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_candidates) as candidate_data(
      canonical_key text,
      supplier_product_id uuid,
      status text,
      score numeric,
      product_fingerprint text,
      required_unit text,
      amount_per_purchase_unit numeric,
      import_run_id uuid
    )
    left join public.canonical_ingredients as canonical
      on canonical.organization_id = p_organization_id
      and canonical.canonical_key = candidate_data.canonical_key
    left join public.supplier_products as product
      on product.organization_id = p_organization_id
      and product.supplier_account_id = p_supplier_account_id
      and product.id = candidate_data.supplier_product_id
    left join public.supplier_import_runs as import_run
      on import_run.organization_id = p_organization_id
      and import_run.supplier_account_id = p_supplier_account_id
      and import_run.id = candidate_data.import_run_id
    where canonical.canonical_key is null
      or product.id is null
      or not product.active
      or product.product_fingerprint
        <> candidate_data.product_fingerprint
      or public.canonical_ingredient_key(
        canonical.display_name,
        candidate_data.required_unit
      ) <> candidate_data.canonical_key
      or (
        candidate_data.import_run_id is not null
        and import_run.id is null
      )
      or (
        candidate_data.status = 'safe'
        and (
          product.catch_weight
          or public.supplier_safe_match_score(
            p_organization_id,
            candidate_data.canonical_key,
            p_supplier_account_id,
            candidate_data.supplier_product_id,
            candidate_data.required_unit
          ) is null
          or round(
            public.supplier_safe_match_score(
              p_organization_id,
              candidate_data.canonical_key,
              p_supplier_account_id,
              candidate_data.supplier_product_id,
              candidate_data.required_unit
            ),
            2
          ) <> round(candidate_data.score, 2)
          or public.supplier_expected_amount(
            product.package_amount,
            product.package_unit,
            candidate_data.required_unit
          ) is null
          or round(
            public.supplier_expected_amount(
              product.package_amount,
              product.package_unit,
              candidate_data.required_unit
            ),
            6
          ) <> round(candidate_data.amount_per_purchase_unit, 6)
        )
      )
  ) then
    raise exception
      'Candidates failed supplier ownership, fingerprint or unit validation'
      using errcode = '22023';
  end if;

  update public.supplier_match_candidates
  set
    status = 'superseded',
    updated_at = now()
  where organization_id = p_organization_id
    and supplier_account_id = p_supplier_account_id
    and matcher_version = normalized_matcher_version
    and status in ('safe', 'review');

  get diagnostics superseded_count = row_count;

  insert into public.supplier_match_candidates (
    organization_id,
    supplier_account_id,
    canonical_key,
    supplier_product_id,
    import_run_id,
    matcher_version,
    status,
    score,
    signals,
    product_fingerprint,
    required_unit,
    amount_per_purchase_unit,
    generated_by
  )
  select
    p_organization_id,
    p_supplier_account_id,
    candidate_data.canonical_key,
    candidate_data.supplier_product_id,
    candidate_data.import_run_id,
    normalized_matcher_version,
    candidate_data.status,
    candidate_data.score,
    candidate_data.signals,
    candidate_data.product_fingerprint,
    trim(candidate_data.required_unit),
    candidate_data.amount_per_purchase_unit,
    actor_user_id
  from jsonb_to_recordset(p_candidates) as candidate_data(
    canonical_key text,
    supplier_product_id uuid,
    import_run_id uuid,
    status text,
    score numeric,
    signals jsonb,
    product_fingerprint text,
    required_unit text,
    amount_per_purchase_unit numeric
  );

  get diagnostics inserted_count = row_count;

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
    'supplier_match_candidates_replaced',
    'supplier_account',
    p_supplier_account_id::text,
    jsonb_build_object(
      'matcher_version', normalized_matcher_version,
      'superseded_candidates', superseded_count,
      'inserted_candidates', inserted_count
    )
  );

  return jsonb_build_object(
    'supplier_account_id', p_supplier_account_id,
    'matcher_version', normalized_matcher_version,
    'superseded_candidates', superseded_count,
    'inserted_candidates', inserted_count
  );
end;
$$;

create function public.apply_supplier_candidate_approval(
  p_organization_id uuid,
  p_candidate_id uuid,
  p_actor_user_id uuid,
  p_decision_source text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_data public.supplier_match_candidates%rowtype;
  saved_match_id uuid;
begin
  select candidate.*
  into candidate_data
  from public.supplier_match_candidates as candidate
  where candidate.organization_id = p_organization_id
    and candidate.id = p_candidate_id
  for update;

  if not found
    or candidate_data.status not in ('safe', 'review') then
    raise exception 'Open supplier match candidate required'
      using errcode = '22023';
  end if;

  if not public.is_supplier_candidate_current(
    p_organization_id,
    p_candidate_id,
    false
  ) then
    raise exception 'Supplier match candidate is stale or unsafe'
      using errcode = '22023';
  end if;

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
    candidate_data.canonical_key,
    candidate_data.supplier_product_id,
    candidate_data.required_unit,
    candidate_data.amount_per_purchase_unit,
    p_actor_user_id,
    now()
  )
  on conflict on constraint ingredient_supplier_matches_product_unique
  do update set
    required_unit = excluded.required_unit,
    amount_per_purchase_unit = excluded.amount_per_purchase_unit,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at,
    updated_at = now()
  returning id into saved_match_id;

  update public.supplier_match_candidates
  set
    status = 'accepted',
    decided_by = p_actor_user_id,
    decided_at = now(),
    decision_source = p_decision_source,
    updated_at = now()
  where organization_id = p_organization_id
    and id = p_candidate_id;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    p_organization_id,
    p_actor_user_id,
    'supplier_match_candidate_accepted',
    'supplier_match_candidate',
    p_candidate_id::text,
    jsonb_build_object(
      'ingredient_supplier_match_id', saved_match_id,
      'decision_source', p_decision_source,
      'matcher_version', candidate_data.matcher_version,
      'score', candidate_data.score,
      'signals', candidate_data.signals
    )
  );

  return saved_match_id;
end;
$$;

create function public.decide_supplier_match_candidate(
  p_organization_id uuid,
  p_candidate_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  normalized_decision text := lower(trim(coalesce(p_decision, '')));
  saved_match_id uuid;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  if normalized_decision not in ('accepted', 'rejected') then
    raise exception 'Decision must be accepted or rejected'
      using errcode = '22023';
  end if;

  if normalized_decision = 'accepted' then
    saved_match_id := public.apply_supplier_candidate_approval(
      p_organization_id,
      p_candidate_id,
      actor_user_id,
      'human'
    );

    return jsonb_build_object(
      'candidate_id', p_candidate_id,
      'status', 'accepted',
      'ingredient_supplier_match_id', saved_match_id
    );
  end if;

  update public.supplier_match_candidates
  set
    status = 'rejected',
    decided_by = actor_user_id,
    decided_at = now(),
    decision_source = 'human',
    updated_at = now()
  where organization_id = p_organization_id
    and id = p_candidate_id
    and status in ('safe', 'review');

  if not found then
    raise exception 'Open supplier match candidate required'
      using errcode = '22023';
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
    'supplier_match_candidate_rejected',
    'supplier_match_candidate',
    p_candidate_id::text,
    jsonb_build_object('decision_source', 'human')
  );

  return jsonb_build_object(
    'candidate_id', p_candidate_id,
    'status', 'rejected'
  );
end;
$$;

create function public.approve_safe_supplier_match_candidates(
  p_organization_id uuid,
  p_supplier_account_id uuid,
  p_matcher_version text,
  p_candidate_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  normalized_matcher_version text :=
    trim(coalesce(p_matcher_version, ''));
  candidate_id uuid;
  candidate_count integer;
  approved_count integer := 0;
begin
  if actor_user_id is null
    or not public.is_org_member(p_organization_id) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  candidate_count := coalesce(array_length(p_candidate_ids, 1), 0);
  if candidate_count not between 1 and 500
    or normalized_matcher_version
      !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$' then
    raise exception 'Safe approval batch failed validation'
      using errcode = '22023';
  end if;

  if (
    select count(distinct selected_id)
    from unnest(p_candidate_ids) as selected(selected_id)
  ) <> candidate_count then
    raise exception 'Safe approval batch contains duplicate candidates'
      using errcode = '22023';
  end if;

  perform candidate.id
  from public.supplier_match_candidates as candidate
  where candidate.organization_id = p_organization_id
    and candidate.id = any(p_candidate_ids)
  order by candidate.id
  for update;

  if (
    select count(*)
    from public.supplier_match_candidates as candidate
    where candidate.organization_id = p_organization_id
      and candidate.id = any(p_candidate_ids)
      and candidate.supplier_account_id = p_supplier_account_id
      and candidate.matcher_version = normalized_matcher_version
      and candidate.status = 'safe'
      and candidate.score >= 96
  ) <> candidate_count then
    raise exception
      'Every selected candidate must be current, safe and version-matched'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.supplier_match_candidates as candidate
    where candidate.organization_id = p_organization_id
      and candidate.id = any(p_candidate_ids)
      and not public.is_supplier_candidate_current(
        p_organization_id,
        candidate.id,
        true
      )
  ) then
    raise exception
      'Safe approval batch failed fingerprint or unit revalidation'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.supplier_match_candidates as candidate
    where candidate.organization_id = p_organization_id
      and candidate.id = any(p_candidate_ids)
    group by candidate.canonical_key
    having count(*) > 1
  ) then
    raise exception
      'Safe approval batch has more than one candidate per ingredient'
      using errcode = '22023';
  end if;

  foreach candidate_id in array p_candidate_ids
  loop
    perform public.apply_supplier_candidate_approval(
      p_organization_id,
      candidate_id,
      actor_user_id,
      'batch'
    );
    approved_count := approved_count + 1;
  end loop;

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
    'supplier_match_candidates_batch_approved',
    'supplier_account',
    p_supplier_account_id::text,
    jsonb_build_object(
      'matcher_version', normalized_matcher_version,
      'approved_candidates', approved_count,
      'candidate_ids', to_jsonb(p_candidate_ids)
    )
  );

  return jsonb_build_object(
    'supplier_account_id', p_supplier_account_id,
    'matcher_version', normalized_matcher_version,
    'approved_candidates', approved_count
  );
end;
$$;

alter table public.supplier_import_column_profiles enable row level security;
alter table public.supplier_import_runs enable row level security;
alter table public.supplier_import_rows enable row level security;
alter table public.supplier_match_candidates enable row level security;
alter table public.preferred_supplier_matches enable row level security;

create policy supplier_import_column_profiles_member_select
on public.supplier_import_column_profiles
for select to authenticated
using ((select public.is_org_member(organization_id)));

create policy supplier_import_runs_member_select
on public.supplier_import_runs
for select to authenticated
using ((select public.is_org_member(organization_id)));

create policy supplier_import_rows_member_select
on public.supplier_import_rows
for select to authenticated
using ((select public.is_org_member(organization_id)));

create policy supplier_match_candidates_member_select
on public.supplier_match_candidates
for select to authenticated
using ((select public.is_org_member(organization_id)));

create policy preferred_supplier_matches_member_select
on public.preferred_supplier_matches
for select to authenticated
using (
  (select public.is_org_member(organization_id))
  and exists (
    select 1
    from public.ingredient_supplier_matches as ingredient_match
    join public.supplier_products as product
      on product.organization_id = ingredient_match.organization_id
      and product.id = ingredient_match.supplier_product_id
    where ingredient_match.organization_id =
      preferred_supplier_matches.organization_id
      and ingredient_match.id =
        preferred_supplier_matches.ingredient_supplier_match_id
      and ingredient_match.supplier_product_id =
        preferred_supplier_matches.supplier_product_id
      and ingredient_match.approved_product_fingerprint =
        product.product_fingerprint
      and ingredient_match.approved_by is not null
      and ingredient_match.approved_at is not null
      and product.active
  )
);

revoke all on table
  public.supplier_import_column_profiles,
  public.supplier_import_runs,
  public.supplier_import_rows,
  public.supplier_match_candidates,
  public.preferred_supplier_matches
from public, anon, authenticated, service_role;

grant select on table
  public.supplier_import_column_profiles,
  public.supplier_import_runs,
  public.supplier_import_rows,
  public.supplier_match_candidates,
  public.preferred_supplier_matches
to authenticated;

revoke all on function public.normalized_supplier_unit(text)
from public, anon, authenticated, service_role;
revoke all on function public.supplier_unit_dimension(text)
from public, anon, authenticated, service_role;
revoke all on function public.supplier_unit_base_factor(text)
from public, anon, authenticated, service_role;
revoke all on function public.supplier_expected_amount(numeric, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.supplier_jsonb_numeric(jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.supplier_jsonb_integer(jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.supplier_product_fingerprint(
  text, text, text, text, numeric, text, integer, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.normalized_supplier_search_name(text)
from public, anon, authenticated, service_role;
revoke all on function public.normalized_supplier_match_name(text)
from public, anon, authenticated, service_role;
revoke all on function public.supplier_safe_match_score(
  uuid, text, uuid, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.set_supplier_product_fingerprint()
from public, anon, authenticated, service_role;
revoke all on function
  public.set_ingredient_supplier_match_product_snapshot()
from public, anon, authenticated, service_role;
revoke all on function public.supplier_import_row_errors(jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.is_supplier_candidate_current(
  uuid, uuid, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.sync_preferred_supplier_match()
from public, anon, authenticated, service_role;
revoke all on function public.apply_supplier_candidate_approval(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

revoke all on function public.save_supplier_account_identity(
  uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_supplier_account_identity(
  uuid, uuid, text, text, text
) to authenticated;

revoke all on function public.save_supplier_import_column_profile(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.save_supplier_import_column_profile(
  uuid, uuid, text, text, jsonb
) to authenticated;

revoke all on function public.start_supplier_import(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.start_supplier_import(
  uuid, uuid, uuid, text, text, text
) to authenticated;

revoke all on function public.stage_supplier_import_rows(
  uuid, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.stage_supplier_import_rows(
  uuid, uuid, uuid, jsonb
) to authenticated;

revoke all on function public.finalize_supplier_import(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_supplier_import(
  uuid, uuid, uuid
) to authenticated;

revoke all on function public.replace_supplier_match_candidates(
  uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.replace_supplier_match_candidates(
  uuid, uuid, text, jsonb
) to authenticated;

revoke all on function public.decide_supplier_match_candidate(
  uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.decide_supplier_match_candidate(
  uuid, uuid, text
) to authenticated;

revoke all on function public.approve_safe_supplier_match_candidates(
  uuid, uuid, text, uuid[]
) from public, anon, authenticated, service_role;
grant execute on function public.approve_safe_supplier_match_candidates(
  uuid, uuid, text, uuid[]
) to authenticated;
