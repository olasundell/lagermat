-- Keep server-side safe-match validation aligned with the deterministic
-- matcher for exact culinary volume units. These conversions are definitions,
-- not package assumptions: 1 tablespoon = 15 ml and 1 teaspoon = 5 ml.

create or replace function public.normalized_supplier_unit(p_unit text)
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
    when 'matsked' then 'msk'
    when 'matskedar' then 'msk'
    when 'tesked' then 'tsk'
    when 'teskedar' then 'tsk'
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

create or replace function public.supplier_unit_dimension(p_unit text)
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
    when 'msk' then 'volume'
    when 'tsk' then 'volume'
    when 'st' then 'count'
    else null
  end;
$$;

create or replace function public.supplier_unit_base_factor(p_unit text)
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
    when 'msk' then 15::numeric
    when 'tsk' then 5::numeric
    when 'st' then 1::numeric
    else null
  end;
$$;
