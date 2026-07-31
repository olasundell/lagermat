begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select is(
  (
    select count(*)::integer
    from app_private.recipe_ingredient_templates
    where lower(trim(unit)) in (
      'ask', 'askar', 'burk', 'burkar', 'flaska', 'flaskor',
      'förpackning', 'förpackningar', 'kartong', 'kartonger',
      'kolli', 'paket', 'påse', 'påsar', 'rulle', 'rullar',
      'säck', 'säckar', 'tub', 'tuber'
    )
  ),
  0,
  'recipe templates never express requirements in purchase packaging'
);

select is(
  (select count(*)::integer from app_private.recipe_ingredient_templates),
  238,
  'the curated catalogue removes package allowances and undefined pantry reminders'
);

select is(
  (
    select count(*)::integer
    from app_private.recipe_ingredient_templates as ingredient
    join app_private.recipe_templates as template
      on template.id = ingredient.recipe_template_id
    where template.template_key = 'frukost'
      and (
        (ingredient.name = 'Hårt bröd'
          and ingredient.unit = 'skivor'
          and ingredient.amount = 1
          and ingredient.mode = 'weighted_portion')
        or (ingredient.name = 'Marmelad'
          and ingredient.unit = 'kg'
          and ingredient.amount = 0.015
          and ingredient.mode = 'weighted_portion')
        or (ingredient.name = 'Matfett'
          and ingredient.unit = 'kg'
          and ingredient.amount = 0.01
          and ingredient.mode = 'weighted_portion')
        or (ingredient.name = 'Mjölkfritt matfett'
          and ingredient.unit = 'kg'
          and ingredient.amount = 0.01
          and ingredient.mode = 'weighted_portion')
        or (ingredient.name = 'Kaffe'
          and ingredient.unit = 'kg'
          and ingredient.amount = 0.012
          and ingredient.mode = 'weighted_portion')
      )
  ),
  5,
  'breakfast uses physical serving quantities'
);

select is(
  (
    select count(*)::integer
    from app_private.recipe_ingredient_templates as ingredient
    join app_private.recipe_templates as template
      on template.id = ingredient.recipe_template_id
    where template.template_key = 'frukost'
      and ingredient.name in (
        'Marmelad',
        'Matfett',
        'Mjölkfritt matfett'
      )
      and ingredient.mode = 'fixed_once_per_camp'
  ),
  0,
  'breakfast no longer adds guessed spare packages'
);

select is(
  (
    select count(*)::integer
    from app_private.recipe_ingredient_templates
    where (
      name = 'saltgurka'
      and unit = 'kg'
      and amount = 0.03
      and mode = 'weighted_portion'
    ) or (
      name = 'Nachos'
      and unit = 'kg'
      and amount = 0.025
      and mode = 'weighted_portion'
    ) or (
      name in ('Salta kex', 'Havrekex')
      and unit = 'st'
      and amount = 2
      and mode = 'weighted_portion'
    )
  ),
  4,
  'other legacy package hints are curated into mass or count'
);

select is(
  (
    select count(*)::integer
    from app_private.recipe_ingredient_templates
    where name in ('Salt', 'Peppar', 'Oregano', 'Övriga kryddor')
      and unit in ('st', 'styck', 'stycken')
  ),
  0,
  'spices are never represented as semantically meaningless pieces'
);

select throws_ok(
  $query$
    insert into app_private.recipe_ingredient_templates (
      id, recipe_template_id, name, unit, amount, mode,
      dietary_rule, sort_order
    ) values (
      '7f000000-0000-0000-0000-000000000001',
      '8bd039f5-3789-f36b-47ed-e60ef54c303f',
      'Ogiltig mallrad',
      'paket',
      1,
      'weighted_portion',
      'standard',
      999
    )
  $query$,
  '23514',
  'new row for relation "recipe_ingredient_templates" violates check constraint "recipe_ingredient_templates_no_purchase_packaging"',
  'the private catalogue rejects purchase packaging'
);

select throws_ok(
  $query$
    insert into public.recipe_ingredients (
      id, organization_id, recipe_version_id, name, unit, amount, mode,
      dietary_rule, sort_order
    ) values (
      '7f000000-0000-0000-0000-000000000002',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      '8bd039f5-3789-f36b-47ed-e60ef54c303f',
      'Ogiltig receptrad',
      'påse',
      1,
      'weighted_portion',
      'standard',
      999
    )
  $query$,
  '23514',
  'new row for relation "recipe_ingredients" violates check constraint "recipe_ingredients_no_purchase_packaging"',
  'published recipe rows reject purchase packaging'
);

select * from finish();
rollback;
