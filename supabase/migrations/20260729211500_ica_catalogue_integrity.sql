-- Keep automatic ICA matching server-verifiable and ensure that a changed
-- inner package invalidates an earlier approval.

create function public.normalized_supplier_match_name(
  p_display_name text,
  p_brand text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with normalized as (
    select
      public.normalized_supplier_match_name(
        regexp_replace(
          coalesce(p_display_name, ''),
          '(^|[^[:alnum:]])[0-9]+([.,][0-9]+)?[[:space:]]*(-[[:space:]]*)?(p|pack|stycken|styck|st)([^[:alnum:]]|$)',
          ' ',
          'gi'
        )
      ) as product_name,
      public.normalized_supplier_search_name(p_brand) as brand_name
  )
  select trim(
    case
      when brand_name = '' or product_name = brand_name
        then product_name
      when product_name like brand_name || ' %'
        then substr(product_name, length(brand_name) + 2)
      when product_name like '% ' || brand_name
        then left(product_name, length(product_name) - length(brand_name) - 1)
      else product_name
    end
  )
  from normalized;
$$;

create or replace function public.supplier_safe_match_score(
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
        product.display_name,
        product.brand
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

create function public.supplier_product_fingerprint(
  p_supplier_article_number text,
  p_display_name text,
  p_gtin text,
  p_purchase_unit text,
  p_package_amount numeric,
  p_package_unit text,
  p_minimum_order_units integer,
  p_catch_weight boolean,
  p_packaging_metadata jsonb
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
          'catch_weight', coalesce(p_catch_weight, false),
          'inner_package', jsonb_strip_nulls(jsonb_build_object(
            'count', p_packaging_metadata -> 'inner_unit_count',
            'label', lower(trim(
              coalesce(p_packaging_metadata ->> 'inner_unit_label', '')
            ))
          ))
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.set_supplier_product_fingerprint()
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
    new.catch_weight,
    new.packaging_metadata
  );
  return new;
end;
$$;

drop trigger supplier_products_set_fingerprint
  on public.supplier_products;

create trigger supplier_products_set_fingerprint
before insert or update of
  supplier_article_number,
  display_name,
  gtin,
  purchase_unit,
  package_amount,
  package_unit,
  minimum_order_units,
  catch_weight,
  packaging_metadata
on public.supplier_products
for each row execute function public.set_supplier_product_fingerprint();

update public.supplier_products as product
set product_fingerprint = public.supplier_product_fingerprint(
  product.supplier_article_number,
  product.display_name,
  product.gtin,
  product.purchase_unit,
  product.package_amount,
  product.package_unit,
  product.minimum_order_units,
  product.catch_weight,
  product.packaging_metadata
);

-- Old hand-written/demo products must never appear under an ICA account.
update public.supplier_products as product
set
  active = false,
  updated_at = now()
from public.supplier_accounts as account
where account.organization_id = product.organization_id
  and account.id = product.supplier_account_id
  and account.provider_key = 'ica'
  and product.active
  and (
    product.product_data_source <> 'import:api'
    or product.source_metadata ->> 'source' <> 'ica_public_webshop'
    or product.source_metadata ->> 'store_id'
      is distinct from account.provider_location_id
  );

create function public.enforce_ica_supplier_product_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  supplier_provider_key text;
  supplier_location_id text;
begin
  select account.provider_key, account.provider_location_id
  into supplier_provider_key, supplier_location_id
  from public.supplier_accounts as account
  where account.organization_id = new.organization_id
    and account.id = new.supplier_account_id;

  if supplier_provider_key = 'ica'
    and new.active
    and (
      new.product_data_source <> 'import:api'
      or new.source_metadata ->> 'source' <> 'ica_public_webshop'
      or new.source_metadata ->> 'store_id'
        is distinct from supplier_location_id
    ) then
    raise exception
      'ICA supplier products must come from the configured store catalogue'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger supplier_products_enforce_ica_provenance
before insert or update of
  organization_id,
  supplier_account_id,
  active,
  product_data_source,
  source_metadata
on public.supplier_products
for each row execute function public.enforce_ica_supplier_product_provenance();

revoke all on function public.normalized_supplier_match_name(text, text)
from public, anon, authenticated;
revoke all on function public.supplier_product_fingerprint(
  text,
  text,
  text,
  text,
  numeric,
  text,
  integer,
  boolean,
  jsonb
)
from public, anon, authenticated;
revoke all on function public.enforce_ica_supplier_product_provenance()
from public, anon, authenticated;
