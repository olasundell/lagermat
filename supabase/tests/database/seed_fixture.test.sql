begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

select is(
  (select count(*)::integer from public.participants where camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  55,
  'the local demo camp contains exactly 55 participants'
);

select is(
  (select count(distinct source_reference)::integer from public.participants where camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  55,
  'every demo participant has a distinct source reference'
);

select is(
  (select count(distinct import_batch_id)::integer from public.participants where camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  1,
  'all demo participants belong to the recorded import batch'
);

select is(
  (select string_agg(group_row.name || ':' || grouped.participant_count, ',' order by group_row.sort_order)
   from (
     select division_id, count(*)::text as participant_count
     from public.participants
     where camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
     group by division_id
   ) grouped
   join public.camp_groups group_row on group_row.id = grouped.division_id),
  'Spårarna:10,Upptäckarna:16,Äventyrarna:14,Utmanarna:10,Ledare:5',
  'the five divisions have realistic deterministic sizes'
);

select is(
  (select string_agg(group_row.name || ':' || grouped.food_factor_range, ',' order by group_row.sort_order)
   from (
     select division_id, min(food_factor)::text || '-' || max(food_factor)::text as food_factor_range
     from public.participants
     where camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and division_id in (
         'd1000000-0000-0000-0000-000000000004',
         'd1000000-0000-0000-0000-000000000005'
       )
     group by division_id
   ) grouped
   join public.camp_groups group_row on group_row.id = grouped.division_id),
  'Utmanarna:1.1000-1.1000,Ledare:1.1000-1.1000',
  'leaders and challengers have the same food factor'
);

select is(
  (select string_agg(grouped.participant_count, ',' order by group_row.id)
   from (
     select patrol_id, count(*)::text as participant_count
     from public.participants
     where camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
     group by patrol_id
   ) grouped
   join public.camp_groups group_row on group_row.id = grouped.patrol_id),
  '5,5,8,8,7,7,5,5',
  'the eight patrols contain all 50 youth participants'
);

select is(
  (select string_agg(grouped.participant_count, ',' order by group_row.sort_order)
   from (
     select meal_group_id, count(*)::text as participant_count
     from public.participants
     where camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
     group by meal_group_id
   ) grouped
   join public.camp_groups group_row on group_row.id = grouped.meal_group_id),
  '11,11,11,11,11',
  'the five meal groups contain eleven participants each'
);

select is(
  (select count(*)::text || '|' || count(distinct participant_id)::text
   from public.participant_attendance
   where camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  '55|55',
  'every demo participant has exactly one attendance interval'
);

select is(
  (select count(*)::integer
   from public.participant_attendance
   where camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
     and starts_at = '2026-08-02 12:00:00+02'::timestamptz
     and ends_at = '2026-08-11 10:00:00+02'::timestamptz),
  43,
  '43 participants attend the full camp while 12 have varied attendance'
);

select is(
  (select count(*)::text || '|' ||
          (select count(*) from public.dietary_need_tags where camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')::text || '|' ||
          count(*) filter (where review_status = 'unreviewed')::text
   from public.participant_dietary_needs
   where camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  '10|12|1',
  'the demo includes ten dietary needs, twelve tags and one review task'
);

select ok(
  not exists (
    select 1
    from public.dietary_tags tag
    where tag.camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and not exists (
        select 1 from public.recipe_ingredients ingredient
        where ingredient.dietary_tag_label = tag.label
      )
  ),
  'every seeded dietary tag is understood by the recipe calculation'
);

select ok(
  not exists (
    select 1
    from public.participants
    where camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and (display_name ~* 'demo|test|scout' or display_name like '%@%' or display_name ~ '[0-9]{6,}')
  ),
  'participant names contain no placeholder names, email addresses or identity numbers'
);

select ok(
  (select jsonb_typeof(column_mapping) = 'array'
      and validation_summary ->> 'accepted' = '55'
   from public.import_batches
   where id = 'a1000000-0000-0000-0000-000000000001'),
  'the recorded import batch has the same valid shape and count as a real import'
);

select is(
  (select count(*)::integer
   from public.recipes
   where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  26,
  'the local organization has the complete catalogue plus one operational fixture recipe'
);

select is(
  (select count(*)::integer
   from public.recipe_ingredients
   where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  246,
  'the local organization has every catalogue component plus the fixture component'
);

select * from finish();
rollback;
