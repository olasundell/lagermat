alter table public.recipe_ingredients
  add column comment text,
  add column source_row integer check (source_row is null or source_row > 0);

drop policy camp_recipe_copies_member_access on public.camp_recipe_copies;
create policy camp_recipe_copies_member_select
  on public.camp_recipe_copies
  for select
  to authenticated
  using (public.is_org_member(organization_id));

revoke insert, update, delete on public.camp_recipe_copies from authenticated;

create function public.freeze_recipe_version(
  p_camp_id uuid,
  p_recipe_version_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_recipe_name text;
  target_version_number integer;
  target_content_digest text;
  target_instructions text;
  target_portion_size numeric;
  target_version_key text;
  target_snapshot jsonb;
  copy_id uuid;
begin
  select camp.organization_id
  into target_organization_id
  from public.camps camp
  where camp.id = p_camp_id;

  if not found or not public.is_org_member(target_organization_id) then
    raise exception 'Camp not found' using errcode = '42501';
  end if;

  select recipe.name, version.version_number, version.content_digest,
    version.instructions, version.portion_size
  into target_recipe_name, target_version_number, target_content_digest,
    target_instructions, target_portion_size
  from public.recipe_versions version
  join public.recipes recipe
    on recipe.organization_id = version.organization_id
   and recipe.id = version.recipe_id
  where version.id = p_recipe_version_id
    and version.organization_id = target_organization_id
    and version.status = 'published';

  if not found then
    raise exception 'Published recipe version not found' using errcode = '22023';
  end if;

  target_version_key := p_recipe_version_id::text || '@' || left(target_content_digest, 16);

  select jsonb_build_object(
    'name', target_recipe_name,
    'version', target_version_number,
    'version_key', target_version_key,
    'content_digest', target_content_digest,
    'instructions', target_instructions,
    'portion_size', target_portion_size,
    'ingredients', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', ingredient.id,
        'name', ingredient.name,
        'unit', ingredient.unit,
        'amount', ingredient.amount::text,
        'mode', ingredient.mode,
        'dietary_rule', ingredient.dietary_rule,
        'dietary_tag_label', ingredient.dietary_tag_label,
        'comment', ingredient.comment,
        'source_row', ingredient.source_row,
        'sort_order', ingredient.sort_order
      ) order by ingredient.sort_order, ingredient.id
    ) filter (where ingredient.id is not null), '[]'::jsonb)
  )
  into target_snapshot
  from public.recipe_versions version
  left join public.recipe_ingredients ingredient
    on ingredient.organization_id = version.organization_id
   and ingredient.recipe_version_id = version.id
  where version.id = p_recipe_version_id
  group by version.id;

  insert into public.camp_recipe_copies (
    organization_id, camp_id, source_recipe_version_id, name,
    version_key, frozen_snapshot, copied_by
  ) values (
    target_organization_id, p_camp_id, p_recipe_version_id, target_recipe_name,
    target_version_key, target_snapshot, (select auth.uid())
  )
  on conflict (organization_id, camp_id, version_key) do nothing
  returning id into copy_id;

  if copy_id is null then
    select copy.id into copy_id
    from public.camp_recipe_copies copy
    where copy.organization_id = target_organization_id
      and copy.camp_id = p_camp_id
      and copy.version_key = target_version_key;
  else
    insert into public.audit_events (
      organization_id, actor_user_id, event_type, entity_type, entity_id, payload
    ) values (
      target_organization_id, (select auth.uid()), 'recipe_version_frozen',
      'camp_recipe_copy', copy_id::text,
      jsonb_build_object('camp_id', p_camp_id, 'recipe_version_id', p_recipe_version_id, 'version_key', target_version_key)
    );
  end if;

  return copy_id;
end;
$$;

create function public.switch_meal_recipe_version(
  p_meal_id uuid,
  p_recipe_version_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_camp_id uuid;
  copy_id uuid;
begin
  select meal.organization_id, meal.camp_id
  into target_organization_id, target_camp_id
  from public.meals meal
  where meal.id = p_meal_id;

  if not found or not public.is_org_member(target_organization_id) then
    raise exception 'Meal not found' using errcode = '42501';
  end if;

  copy_id := public.freeze_recipe_version(target_camp_id, p_recipe_version_id);

  update public.meals
  set camp_recipe_copy_id = copy_id,
      status = 'draft'
  where id = p_meal_id
    and organization_id = target_organization_id
    and camp_id = target_camp_id;

  insert into public.audit_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    target_organization_id, (select auth.uid()), 'meal_recipe_version_switched',
    'meal', p_meal_id::text,
    jsonb_build_object('camp_id', target_camp_id, 'recipe_version_id', p_recipe_version_id, 'camp_recipe_copy_id', copy_id)
  );

  return copy_id;
end;
$$;

revoke all on function public.freeze_recipe_version(uuid, uuid) from public, anon;
revoke all on function public.switch_meal_recipe_version(uuid, uuid) from public, anon;
grant execute on function public.freeze_recipe_version(uuid, uuid) to authenticated;
grant execute on function public.switch_meal_recipe_version(uuid, uuid) to authenticated;
