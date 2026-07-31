select jsonb_build_object(
  'fixture_key', 'bjorkstad',
  'template_version', 1,
  'organization', (
    select jsonb_build_object(
      'key', organization.id,
      'name', organization.name,
      'slug', organization.slug
    )
    from public.organizations as organization
    where organization.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  ),
  'camp', (
    select jsonb_build_object(
      'key', camp.id,
      'name', camp.name,
      'starts_on', camp.starts_on,
      'ends_on', camp.ends_on,
      'timezone', camp.timezone,
      'status', camp.status
    )
    from public.camps as camp
    where camp.id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  ),
  'groups', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'key', group_row.id,
        'parent_key', group_row.parent_group_id,
        'kind', group_row.kind,
        'name', group_row.name,
        'sort_order', group_row.sort_order
      )
      order by group_row.kind, group_row.sort_order, group_row.id
    )
    from public.camp_groups as group_row
    where group_row.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and group_row.camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  ), '[]'::jsonb),
  'import_batch', (
    select jsonb_build_object(
      'key', batch.id,
      'source_filename', batch.source_filename,
      'source_kind', batch.source_kind,
      'column_mapping', batch.column_mapping,
      'validation_summary', batch.validation_summary,
      'status', batch.status
    )
    from public.import_batches as batch
    where batch.id = 'a1000000-0000-0000-0000-000000000001'
  ),
  'participants', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'key', participant.id,
        'display_name', participant.display_name,
        'division_key', participant.division_id,
        'patrol_key', participant.patrol_id,
        'meal_group_key', participant.meal_group_id,
        'food_factor', participant.food_factor,
        'source_reference', participant.source_reference,
        'import_batch_key', participant.import_batch_id
      )
      order by participant.source_reference
    )
    from public.participants as participant
    where participant.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and participant.camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and participant.source_reference like 'scoutnet-2026-%'
  ), '[]'::jsonb),
  'attendance', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'key', attendance.id,
        'participant_key', attendance.participant_id,
        'starts_at', attendance.starts_at,
        'ends_at', attendance.ends_at
      )
      order by attendance.id
    )
    from public.participant_attendance as attendance
    where attendance.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and attendance.camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and attendance.id::text like 'e2000000-%'
  ), '[]'::jsonb),
  'dietary_tags', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'key', tag.id,
        'label', tag.label,
        'description', tag.description
      )
      order by tag.id
    )
    from public.dietary_tags as tag
    where tag.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and tag.camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and tag.id::text like 'f1000000-%'
  ), '[]'::jsonb),
  'dietary_needs', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'key', need.id,
        'participant_key', need.participant_id,
        'raw_food_note', need.raw_food_note,
        'review_status', case
          when need.id = 'f2000000-0000-0000-0000-000000000004' then 'unreviewed'
          else 'resolved'
        end
      )
      order by need.id
    )
    from public.participant_dietary_needs as need
    where need.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and need.camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and need.id::text like 'f2000000-%'
  ), '[]'::jsonb),
  'dietary_need_tags', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'dietary_need_key', link.dietary_need_id,
        'dietary_tag_key', link.dietary_tag_id
      )
      order by link.dietary_need_id, link.dietary_tag_id
    )
    from public.dietary_need_tags as link
    where link.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and link.camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and link.dietary_need_id::text like 'f2000000-%'
  ), '[]'::jsonb),
  'local_recipes', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'recipe_key', recipe.id,
        'name', recipe.name,
        'version_key', version.id,
        'version_number', version.version_number,
        'status', version.status,
        'instructions', version.instructions,
        'portion_size', version.portion_size,
        'content_digest', version.content_digest,
        'ingredients', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'key', ingredient.id,
              'name', ingredient.name,
              'unit', ingredient.unit,
              'amount', ingredient.amount,
              'mode', ingredient.mode,
              'dietary_rule', ingredient.dietary_rule,
              'dietary_tag_label', ingredient.dietary_tag_label,
              'comment', ingredient.comment,
              'source_row', ingredient.source_row,
              'sort_order', ingredient.sort_order
            )
            order by ingredient.sort_order, ingredient.id
          )
          from public.recipe_ingredients as ingredient
          where ingredient.organization_id = recipe.organization_id
            and ingredient.recipe_version_id = version.id
        ), '[]'::jsonb)
      )
      order by recipe.id
    )
    from public.recipes as recipe
    join public.recipe_versions as version
      on version.organization_id = recipe.organization_id
     and version.recipe_id = recipe.id
    where recipe.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and (
        recipe.id::text like 'b2000000-%'
        or recipe.id = 'a2000000-0000-0000-0000-000000000001'
      )
  ), '[]'::jsonb),
  'catalogue_copies', jsonb_build_array(
    jsonb_build_object('key', 'a4000000-0000-0000-0000-000000000001', 'template_key', 'frukost'),
    jsonb_build_object('key', 'a4000000-0000-0000-0000-000000000002', 'template_key', 'pasta-carbonara'),
    jsonb_build_object('key', 'a4000000-0000-0000-0000-000000000003', 'template_key', 'thaigryta-med-kyckling-och-kokosmjolk'),
    jsonb_build_object('key', 'a4000000-0000-0000-0000-000000000004', 'template_key', 'tacos'),
    jsonb_build_object('key', 'a4000000-0000-0000-0000-000000000005', 'template_key', 'hamburgare'),
    jsonb_build_object('key', 'a4000000-0000-0000-0000-000000000006', 'template_key', 'kottbullar-med-pasta-och-tomatsas'),
    jsonb_build_object('key', 'a4000000-0000-0000-0000-000000000007', 'template_key', 'korv-med-brod'),
    jsonb_build_object('key', 'a4000000-0000-0000-0000-000000000008', 'template_key', 'falafel-med-pasta-och-tomatsas')
  ),
  'local_recipe_copies', jsonb_build_array(
    jsonb_build_object(
      'key', 'a2000000-0000-0000-0000-000000000003',
      'recipe_key', 'a2000000-0000-0000-0000-000000000001'
    )
  ),
  'meal_slots', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'key', slot.id,
        'slot_key', slot.slot_key,
        'service_date', slot.service_date,
        'starts_at', slot.starts_at,
        'meal_type', slot.meal_type,
        'label', slot.label,
        'service_status', slot.service_status,
        'source', slot.source,
        'sort_order', slot.sort_order
      )
      order by slot.starts_at, slot.sort_order, slot.id
    )
    from public.camp_meal_slots as slot
    where slot.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and slot.camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and slot.id::text like 'a3000000-%'
  ), '[]'::jsonb),
  'meals', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'key', meal.id,
        'recipe_copy_key', meal.camp_recipe_copy_id,
        'meal_slot_key', meal.meal_slot_id,
        'starts_at', meal.starts_at,
        'meal_type', meal.meal_type,
        'title', meal.title,
        'status', meal.status
      )
      order by meal.starts_at, meal.id
    )
    from public.meals as meal
    where meal.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and meal.camp_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
      and meal.id::text like 'a2000000-%'
      and meal.meal_slot_id is not null
  ), '[]'::jsonb),
  'calculation_revisions', jsonb_build_array(
    jsonb_build_object(
      'key', 'a2000000-0000-0000-0000-000000000005',
      'revision_number', 1,
      'status', 'stale',
      'input_digest', repeat('b', 64),
      'problem_summary', jsonb_build_object('unreviewed_dietary_needs', 1)
    )
  ),
  'supply_lists', jsonb_build_array(
    jsonb_build_object(
      'key', 'a2000000-0000-0000-0000-000000000006',
      'calculation_revision_key', 'a2000000-0000-0000-0000-000000000005',
      'meal_group_key', null,
      'kind', 'delivery',
      'status', 'active',
      'title', 'Leverans 1',
      'list_key', 'legacy:delivery-1',
      'source_present', true,
      'items', jsonb_build_array(
        jsonb_build_object(
          'key', 'legacy:delivery-1:onion',
          'category', 'Grönt',
          'item_name', 'Gul lök',
          'required_amount', 5.5,
          'required_unit', 'kg',
          'ordered_amount', 6,
          'ordered_unit', 'kg',
          'package_note', '1 säck',
          'comment', 'Kontrollerad vid leverans',
          'completed', true,
          'item_key', 'legacy:delivery-1:onion',
          'source_line_keys', '[]'::jsonb,
          'source_present', true,
          'manually_moved', false
        ),
        jsonb_build_object(
          'key', 'legacy:delivery-1:aubergine',
          'category', 'Grönt',
          'item_name', 'Aubergine',
          'required_amount', 5.7,
          'required_unit', 'st',
          'ordered_amount', 3,
          'ordered_unit', 'kg',
          'package_note', null,
          'comment', 'Olika enheter: jämför inte automatiskt.',
          'completed', false,
          'item_key', 'legacy:delivery-1:aubergine',
          'source_line_keys', '[]'::jsonb,
          'source_present', true,
          'manually_moved', false
        )
      )
    )
  )
);
