-- Recipes describe food requirements. Retail and wholesale packaging belongs
-- to supplier products and is chosen later, after the actual article is known.

-- Replace the package-based rows inherited from the legacy workbook with
-- explicit culinary quantities. Fixed "extra packages" are removed instead
-- of being silently added to every camp.
update app_private.recipe_ingredient_templates
set unit = 'skivor',
    amount = 1,
    mode = 'weighted_portion'
where id = 'c648b1ab-0635-4a05-380c-36d93176e2f6';

update app_private.recipe_ingredient_templates
set unit = 'kg',
    amount = 0.015,
    mode = 'weighted_portion'
where id = 'dd492d6c-e3e9-f22d-27c5-7645fa903c11';

delete from app_private.recipe_ingredient_templates
where id = 'a6da3812-c033-7248-b19d-0477da0bc001';

update app_private.recipe_ingredient_templates
set unit = 'kg',
    amount = 0.01,
    mode = 'weighted_portion'
where id = '4cb2ee15-2be1-0fa6-7b56-641b131f7343';

delete from app_private.recipe_ingredient_templates
where id = '5a9d22ea-0293-8612-3245-becda79265d9';

update app_private.recipe_ingredient_templates
set unit = 'kg',
    amount = 0.01,
    mode = 'weighted_portion'
where id = 'eeaf7be6-1891-6dd7-992c-206db49abe42';

delete from app_private.recipe_ingredient_templates
where id = '50d149a1-6962-c5d4-ac60-8807a0f8627e';

-- These were workbook shopping reminders, not defined culinary quantities.
-- Keeping "5 st" would falsely claim that salt, pepper and herbs are countable
-- recipe ingredients, while guessing grams would be equally misleading.
delete from app_private.recipe_ingredient_templates
where id in (
  '5e68d090-68f8-8723-ee60-c1944b647a79',
  '63954e9c-020b-bcf9-30f1-274eaf15ea7d',
  '877c6dc9-93e2-bf99-21df-a4e6db158728',
  '4fdc028e-7fdb-6e16-a775-27a5814666b8'
);

update app_private.recipe_ingredient_templates
set unit = 'kg',
    amount = 0.012,
    mode = 'weighted_portion'
where id = '7399f48f-6c34-3647-5d4c-4217134c1519';

update app_private.recipe_ingredient_templates
set unit = 'kg',
    amount = 0.03,
    mode = 'weighted_portion'
where id = '059453c6-44d2-aa98-98cf-5b2b88a4d049';

update app_private.recipe_ingredient_templates
set unit = 'kg',
    amount = 0.025,
    mode = 'weighted_portion'
where id = '8ca91107-fe42-9ffd-1486-df0158186428';

update app_private.recipe_ingredient_templates
set unit = 'st',
    amount = 2,
    mode = 'weighted_portion'
where id in (
  'bfc5ed9c-afae-cc14-4702-6987b2f6b73a',
  'd3457b3e-a34b-a8eb-cebe-08c83e6fd36f'
);

-- The template digest must describe the curated rows copied into a published
-- recipe version, not the superseded workbook package hints.
update app_private.recipe_templates as template
set content_digest = encode(
  extensions.digest(
    convert_to(
      'lagermat:physical-recipe-units:v1:'
        || template.template_key
        || ':'
        || coalesce((
          select string_agg(
            concat_ws(
              chr(31),
              ingredient.name,
              ingredient.unit,
              ingredient.amount::text,
              ingredient.mode::text,
              ingredient.dietary_rule::text,
              coalesce(ingredient.dietary_tag_label, ''),
              coalesce(ingredient.comment, '')
            ),
            chr(30)
            order by ingredient.sort_order, ingredient.id
          )
          from app_private.recipe_ingredient_templates as ingredient
          where ingredient.recipe_template_id = template.id
        ), ''),
      'UTF8'
    ),
    'sha256'
  ),
  'hex'
)
where template.id in (
  '8bd039f5-3789-f36b-47ed-e60ef54c303f',
  '0decc918-a38f-d800-411f-b8ce0dadb186',
  '11599c37-58b9-4bb8-b110-1026ca779cdf',
  '9b4e81ca-fb73-c2f3-d742-866d914e1e14'
);

alter table app_private.recipe_ingredient_templates
  add constraint recipe_ingredient_templates_no_purchase_packaging
  check (
    lower(regexp_replace(trim(unit), '[[:space:]]+', ' ', 'g'))
      not in (
        'ask', 'askar', 'burk', 'burkar', 'flaska', 'flaskor',
        'förpackning', 'förpackningar', 'kartong', 'kartonger',
        'kolli', 'paket', 'påse', 'påsar', 'rulle', 'rullar',
        'säck', 'säckar', 'tub', 'tuber'
      )
  );

-- Existing published versions are immutable historical input. Keep any
-- legacy rows readable, but reject package units for all new recipe rows and
-- for future edits. Fresh databases validate the constraint immediately.
alter table public.recipe_ingredients
  add constraint recipe_ingredients_no_purchase_packaging
  check (
    lower(regexp_replace(trim(unit), '[[:space:]]+', ' ', 'g'))
      not in (
        'ask', 'askar', 'burk', 'burkar', 'flaska', 'flaskor',
        'förpackning', 'förpackningar', 'kartong', 'kartonger',
        'kolli', 'paket', 'påse', 'påsar', 'rulle', 'rullar',
        'säck', 'säckar', 'tub', 'tuber'
      )
  ) not valid;

do $$
begin
  if not exists (
    select 1
    from public.recipe_ingredients
    where lower(regexp_replace(trim(unit), '[[:space:]]+', ' ', 'g'))
      in (
        'ask', 'askar', 'burk', 'burkar', 'flaska', 'flaskor',
        'förpackning', 'förpackningar', 'kartong', 'kartonger',
        'kolli', 'paket', 'påse', 'påsar', 'rulle', 'rullar',
        'säck', 'säckar', 'tub', 'tuber'
      )
  ) then
    alter table public.recipe_ingredients
      validate constraint recipe_ingredients_no_purchase_packaging;
  end if;
end;
$$;
