alter table public.supply_lists
  add column list_key text,
  add column source_present boolean not null default true;

update public.supply_lists
set list_key = 'legacy:' || id::text;

alter table public.supply_lists
  alter column list_key set not null,
  add constraint supply_lists_camp_list_key_unique
    unique (organization_id, camp_id, list_key);

alter table public.supply_list_items
  add column item_key text,
  add column source_line_keys jsonb not null default '[]'::jsonb,
  add column source_present boolean not null default true,
  add column manually_moved boolean not null default false;

update public.supply_list_items
set item_key = 'legacy:' || id::text;

alter table public.supply_list_items
  alter column item_key set not null,
  add constraint supply_list_items_camp_item_key_unique
    unique (organization_id, camp_id, item_key),
  add constraint supply_list_items_source_lines_array
    check (jsonb_typeof(source_line_keys) = 'array');

create index supply_lists_current_kind_idx
  on public.supply_lists (organization_id, camp_id, kind, source_present);
create index supply_list_items_current_list_idx
  on public.supply_list_items (organization_id, supply_list_id, source_present);

revoke insert, update, delete on public.supply_lists from authenticated;
revoke insert, update, delete on public.supply_list_items from authenticated;

create type public.generated_supply_row as (
  kind public.supply_list_kind,
  list_key text,
  list_title text,
  meal_group_id uuid,
  range_start timestamptz,
  range_end timestamptz,
  item_key text,
  category text,
  item_name text,
  required_amount numeric(30,12),
  required_unit text,
  source_line_keys jsonb
);

create function public.generate_supply_lists(
  p_organization_id uuid,
  p_camp_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_revision_id uuid;
  target_revision_number integer;
  target_timezone text;
  generated_list_count integer;
  generated_item_count integer;
  disappeared_item_count integer;
  generated_rows public.generated_supply_row[] := array[]::public.generated_supply_row[];
  new_rows public.generated_supply_row[] := array[]::public.generated_supply_row[];
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'Camp not found' using errcode = '42501';
  end if;

  select camp.timezone
  into target_timezone
  from public.camps camp
  where camp.organization_id = p_organization_id
    and camp.id = p_camp_id;

  if not found then
    raise exception 'Camp not found' using errcode = '42501';
  end if;

  select revision.id, revision.revision_number
  into target_revision_id, target_revision_number
  from public.calculation_revisions revision
  where revision.organization_id = p_organization_id
    and revision.camp_id = p_camp_id
    and revision.status = 'current'
  order by revision.revision_number desc
  limit 1;

  if target_revision_id is null then
    raise exception 'A current calculation revision is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('supply:' || p_organization_id::text || ':' || p_camp_id::text));

  select coalesce(array_agg(row(
    purchase.kind, purchase.list_key, purchase.list_title,
    purchase.meal_group_id, purchase.range_start, purchase.range_end,
    purchase.item_key, purchase.category, purchase.item_name,
    purchase.required_amount, purchase.required_unit, purchase.source_line_keys
  )::public.generated_supply_row), array[]::public.generated_supply_row[])
  into generated_rows
  from (
    select
      'purchase'::public.supply_list_kind as kind,
      'purchase:all'::text as list_key,
      'Hela lägret'::text as list_title,
      null::uuid as meal_group_id,
      null::timestamptz as range_start,
      null::timestamptz as range_end,
      'purchase:' || md5(lower(trim(line.ingredient_name)) || chr(31) || lower(trim(line.unit))) as item_key,
      case
        when lower(line.ingredient_name) ~ '(aubergine|lök|morot|potatis|paprika|tomat|gurka|sallad|frukt|äpple|banan)' then 'Grönt'
        when lower(line.ingredient_name) ~ '(mjölk|ost|smör|bregott|bacon|grädde|yoghurt|ägg)' then 'Kylvaror'
        else 'Torrvaror'
      end as category,
      min(line.ingredient_name) as item_name,
      sum(line.exact_amount)::numeric(30,12) as required_amount,
      min(line.unit) as required_unit,
      jsonb_agg(line.line_key order by line.line_key) as source_line_keys
    from public.calculation_lines line
    where line.organization_id = p_organization_id
      and line.camp_id = p_camp_id
      and line.calculation_revision_id = target_revision_id
    group by lower(trim(line.ingredient_name)), lower(trim(line.unit)),
      case
        when lower(line.ingredient_name) ~ '(aubergine|lök|morot|potatis|paprika|tomat|gurka|sallad|frukt|äpple|banan)' then 'Grönt'
        when lower(line.ingredient_name) ~ '(mjölk|ost|smör|bregott|bacon|grädde|yoghurt|ägg)' then 'Kylvaror'
        else 'Torrvaror'
      end
  ) purchase;

  with distribution_sources as (
    select
      line.meal_id,
      meal.starts_at,
      meal.title as meal_title,
      line.ingredient_key,
      line.ingredient_name,
      line.unit,
      line.line_key,
      line.trace ->> 'mode' as mode,
      (line.trace ->> 'amount_per_unit')::numeric as amount_per_unit,
      source.value as source,
      case
        when nullif(source.value ->> 'meal_group_id', '') is not null
          then source.value ->> 'meal_group_id'
        when source.value ->> 'source' = 'reserves' then 'reserves'
        else 'ungrouped'
      end as group_key,
      case
        when nullif(source.value ->> 'meal_group', '') is not null
          then source.value ->> 'meal_group'
        when source.value ->> 'source' = 'reserves' then 'Reserv'
        else 'Utan matlag'
      end as group_label,
      (nullif(source.value ->> 'meal_group_id', ''))::uuid as meal_group_id,
      case
        when line.trace ->> 'mode' = 'head'
          then (source.value ->> 'head_count')::numeric
        else (source.value ->> 'food_factor_sum')::numeric
      end as multiplier
    from public.calculation_lines line
    join public.meals meal on meal.id = line.meal_id
    cross join lateral jsonb_array_elements(line.trace -> 'groups') source(value)
    where line.organization_id = p_organization_id
      and line.camp_id = p_camp_id
      and line.calculation_revision_id = target_revision_id
      and line.trace ->> 'mode' <> 'fixed_once_per_camp'
  ),
  regular_rows as (
    select
      'distribution'::public.supply_list_kind as kind,
      'distribution:' || source.meal_id::text || ':' || source.group_key as list_key,
      source.meal_title || ' · ' || source.group_label as list_title,
      source.meal_group_id,
      source.starts_at as range_start,
      source.starts_at + interval '1 second' as range_end,
      'distribution:' || source.meal_id::text || ':' || source.group_key || ':' || source.ingredient_key as item_key,
      case
        when lower(source.ingredient_name) ~ '(aubergine|lök|morot|potatis|paprika|tomat|gurka|sallad|frukt|äpple|banan)' then 'Grönt'
        when lower(source.ingredient_name) ~ '(mjölk|ost|smör|bregott|bacon|grädde|yoghurt|ägg)' then 'Kylvaror'
        else 'Torrvaror'
      end as category,
      source.ingredient_name as item_name,
      sum(source.amount_per_unit * source.multiplier)::numeric(30,12) as required_amount,
      source.unit as required_unit,
      jsonb_agg(distinct source.line_key) as source_line_keys
    from distribution_sources source
    group by source.meal_id, source.meal_title, source.group_key, source.group_label,
      source.meal_group_id, source.starts_at, source.ingredient_key,
      source.ingredient_name, source.unit
  ),
  fixed_rows as (
    select
      'distribution'::public.supply_list_kind as kind,
      'distribution:' || line.meal_id::text || ':shared' as list_key,
      meal.title || ' · Gemensamt' as list_title,
      null::uuid as meal_group_id,
      meal.starts_at as range_start,
      meal.starts_at + interval '1 second' as range_end,
      'distribution:' || line.meal_id::text || ':shared:' || line.ingredient_key as item_key,
      case
        when lower(line.ingredient_name) ~ '(aubergine|lök|morot|potatis|paprika|tomat|gurka|sallad|frukt|äpple|banan)' then 'Grönt'
        when lower(line.ingredient_name) ~ '(mjölk|ost|smör|bregott|bacon|grädde|yoghurt|ägg)' then 'Kylvaror'
        else 'Torrvaror'
      end as category,
      line.ingredient_name as item_name,
      line.exact_amount::numeric(30,12) as required_amount,
      line.unit as required_unit,
      jsonb_build_array(line.line_key) as source_line_keys
    from public.calculation_lines line
    join public.meals meal on meal.id = line.meal_id
    where line.organization_id = p_organization_id
      and line.camp_id = p_camp_id
      and line.calculation_revision_id = target_revision_id
      and line.trace ->> 'mode' = 'fixed_once_per_camp'
  ),
  distribution_rows as (
    select * from regular_rows
    union all
    select * from fixed_rows
  )
  select coalesce(array_agg(row(
    distribution.kind, distribution.list_key, distribution.list_title,
    distribution.meal_group_id, distribution.range_start, distribution.range_end,
    distribution.item_key, distribution.category, distribution.item_name,
    distribution.required_amount, distribution.required_unit, distribution.source_line_keys
  )::public.generated_supply_row), array[]::public.generated_supply_row[])
  into new_rows
  from distribution_rows distribution;

  generated_rows := generated_rows || new_rows;

  with meal_dates as (
    select distinct (meal.starts_at at time zone target_timezone)::date as meal_date
    from public.calculation_lines line
    join public.meals meal on meal.id = line.meal_id
    where line.organization_id = p_organization_id
      and line.camp_id = p_camp_id
      and line.calculation_revision_id = target_revision_id
  ),
  delivery_buckets as (
    select
      meal_date,
      row_number() over (order by meal_date) as delivery_number,
      (meal_date::timestamp at time zone target_timezone) as range_start,
      (coalesce(lead(meal_date) over (order by meal_date), meal_date + 1)::timestamp at time zone target_timezone) as range_end
    from meal_dates
  ),
  delivery_rows as (
    select
      'delivery'::public.supply_list_kind as kind,
      'delivery:auto:' || bucket.meal_date::text as list_key,
      'Leverans ' || bucket.delivery_number::text || ' · ' || bucket.meal_date::text as list_title,
      null::uuid as meal_group_id,
      bucket.range_start,
      bucket.range_end,
      'delivery:' || bucket.meal_date::text || ':' || md5(lower(trim(line.ingredient_name)) || chr(31) || lower(trim(line.unit))) as item_key,
      case
        when lower(line.ingredient_name) ~ '(aubergine|lök|morot|potatis|paprika|tomat|gurka|sallad|frukt|äpple|banan)' then 'Grönt'
        when lower(line.ingredient_name) ~ '(mjölk|ost|smör|bregott|bacon|grädde|yoghurt|ägg)' then 'Kylvaror'
        else 'Torrvaror'
      end as category,
      min(line.ingredient_name) as item_name,
      sum(line.exact_amount)::numeric(30,12) as required_amount,
      min(line.unit) as required_unit,
      jsonb_agg(line.line_key order by line.line_key) as source_line_keys
    from delivery_buckets bucket
    join public.meals meal
      on (meal.starts_at at time zone target_timezone)::date = bucket.meal_date
    join public.calculation_lines line
      on line.meal_id = meal.id
     and line.calculation_revision_id = target_revision_id
    group by bucket.meal_date, bucket.delivery_number, bucket.range_start, bucket.range_end,
      lower(trim(line.ingredient_name)), lower(trim(line.unit)),
      case
        when lower(line.ingredient_name) ~ '(aubergine|lök|morot|potatis|paprika|tomat|gurka|sallad|frukt|äpple|banan)' then 'Grönt'
        when lower(line.ingredient_name) ~ '(mjölk|ost|smör|bregott|bacon|grädde|yoghurt|ägg)' then 'Kylvaror'
        else 'Torrvaror'
      end
  )
  select coalesce(array_agg(row(
    delivery.kind, delivery.list_key, delivery.list_title,
    delivery.meal_group_id, delivery.range_start, delivery.range_end,
    delivery.item_key, delivery.category, delivery.item_name,
    delivery.required_amount, delivery.required_unit, delivery.source_line_keys
  )::public.generated_supply_row), array[]::public.generated_supply_row[])
  into new_rows
  from delivery_rows delivery;

  generated_rows := generated_rows || new_rows;

  update public.supply_list_items item
  set source_present = false,
      row_version = item.row_version + 1
  where item.organization_id = p_organization_id
    and item.camp_id = p_camp_id;

  update public.supply_lists list
  set source_present = false,
      version = list.version + 1
  where list.organization_id = p_organization_id
    and list.camp_id = p_camp_id;

  insert into public.supply_lists (
    organization_id, camp_id, calculation_revision_id, meal_group_id,
    kind, status, title, range_start, range_end, list_key, source_present
  )
  select distinct on (row.list_key)
    p_organization_id,
    p_camp_id,
    target_revision_id,
    row.meal_group_id,
    row.kind,
    'draft'::public.supply_list_status,
    row.list_title,
    row.range_start,
    row.range_end,
    row.list_key,
    true
  from unnest(generated_rows) row
  order by row.list_key, row.item_key
  on conflict (organization_id, camp_id, list_key) do update
  set calculation_revision_id = excluded.calculation_revision_id,
      meal_group_id = excluded.meal_group_id,
      title = excluded.title,
      range_start = excluded.range_start,
      range_end = excluded.range_end,
      source_present = true;

  insert into public.supply_list_items (
    organization_id, camp_id, supply_list_id, item_key, category, item_name,
    required_amount, required_unit, source_line_keys, source_present, updated_by
  )
  select
    p_organization_id,
    p_camp_id,
    list.id,
    row.item_key,
    row.category,
    row.item_name,
    row.required_amount,
    row.required_unit,
    row.source_line_keys,
    true,
    (select auth.uid())
  from unnest(generated_rows) row
  join public.supply_lists list
    on list.organization_id = p_organization_id
   and list.camp_id = p_camp_id
   and list.list_key = row.list_key
  on conflict (organization_id, camp_id, item_key) do update
  set supply_list_id = case
        when public.supply_list_items.manually_moved
          and excluded.item_key like 'delivery:%'
          then public.supply_list_items.supply_list_id
        else excluded.supply_list_id
      end,
      category = excluded.category,
      item_name = excluded.item_name,
      required_amount = excluded.required_amount,
      required_unit = excluded.required_unit,
      source_line_keys = excluded.source_line_keys,
      source_present = true,
      row_version = public.supply_list_items.row_version + 1,
      updated_by = excluded.updated_by;

  select count(*)::integer into generated_list_count
  from public.supply_lists list
  where list.organization_id = p_organization_id
    and list.camp_id = p_camp_id
    and list.source_present;

  select count(*)::integer into generated_item_count
  from public.supply_list_items item
  where item.organization_id = p_organization_id
    and item.camp_id = p_camp_id
    and item.source_present;

  select count(*)::integer into disappeared_item_count
  from public.supply_list_items item
  where item.organization_id = p_organization_id
    and item.camp_id = p_camp_id
    and not item.source_present;

  insert into public.audit_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_organization_id, (select auth.uid()), 'supply_lists_generated',
    'calculation_revision', target_revision_id::text,
    jsonb_build_object(
      'camp_id', p_camp_id,
      'revision_number', target_revision_number,
      'list_count', generated_list_count,
      'item_count', generated_item_count,
      'disappeared_item_count', disappeared_item_count
    )
  );

  return jsonb_build_object(
    'revision_id', target_revision_id,
    'revision_number', target_revision_number,
    'list_count', generated_list_count,
    'item_count', generated_item_count,
    'disappeared_item_count', disappeared_item_count
  );
end;
$$;

create function public.update_supply_item(
  p_item_id uuid,
  p_expected_version bigint,
  p_ordered_amount numeric,
  p_ordered_unit text,
  p_package_note text,
  p_comment text,
  p_completed boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_item public.supply_list_items%rowtype;
  next_version bigint;
begin
  select item.* into target_item
  from public.supply_list_items item
  where item.id = p_item_id
  for update;

  if not found or not public.is_org_member(target_item.organization_id) then
    raise exception 'Supply item not found' using errcode = '42501';
  end if;
  if target_item.row_version <> p_expected_version then
    raise exception 'Supply item has changed' using errcode = '40001';
  end if;
  if p_ordered_amount is not null and p_ordered_amount < 0 then
    raise exception 'Ordered amount must be non-negative' using errcode = '22023';
  end if;
  if length(coalesce(p_ordered_unit, '')) > 40
    or length(coalesce(p_package_note, '')) > 240
    or length(coalesce(p_comment, '')) > 1000 then
    raise exception 'Supply item text is too long' using errcode = '22023';
  end if;

  update public.supply_list_items
  set ordered_amount = p_ordered_amount,
      ordered_unit = nullif(trim(p_ordered_unit), ''),
      package_note = nullif(trim(p_package_note), ''),
      comment = nullif(trim(p_comment), ''),
      completed = p_completed,
      row_version = row_version + 1,
      updated_by = (select auth.uid())
  where id = p_item_id
  returning row_version into next_version;

  insert into public.audit_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    target_item.organization_id, (select auth.uid()), 'supply_item_updated',
    'supply_list_item', p_item_id::text,
    jsonb_build_object(
      'camp_id', target_item.camp_id,
      'base_version', p_expected_version,
      'new_version', next_version,
      'completed', p_completed
    )
  );

  return next_version;
end;
$$;

create function public.move_delivery_item(
  p_item_id uuid,
  p_target_list_id uuid,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_item public.supply_list_items%rowtype;
  source_kind public.supply_list_kind;
  target_list public.supply_lists%rowtype;
  next_version bigint;
begin
  select item.* into target_item
  from public.supply_list_items item
  where item.id = p_item_id
  for update;

  if not found or not public.is_org_member(target_item.organization_id) then
    raise exception 'Supply item not found' using errcode = '42501';
  end if;
  if target_item.row_version <> p_expected_version then
    raise exception 'Supply item has changed' using errcode = '40001';
  end if;

  select list.kind into source_kind
  from public.supply_lists list
  where list.id = target_item.supply_list_id;

  select list.* into target_list
  from public.supply_lists list
  where list.id = p_target_list_id;

  if source_kind <> 'delivery'
    or not found
    or target_list.kind <> 'delivery'
    or target_list.organization_id <> target_item.organization_id
    or target_list.camp_id <> target_item.camp_id
    or not target_list.source_present then
    raise exception 'Target delivery not found' using errcode = '22023';
  end if;

  update public.supply_list_items
  set supply_list_id = p_target_list_id,
      manually_moved = true,
      row_version = row_version + 1,
      updated_by = (select auth.uid())
  where id = p_item_id
  returning row_version into next_version;

  insert into public.audit_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    target_item.organization_id, (select auth.uid()), 'delivery_item_moved',
    'supply_list_item', p_item_id::text,
    jsonb_build_object(
      'camp_id', target_item.camp_id,
      'from_list_id', target_item.supply_list_id,
      'to_list_id', p_target_list_id,
      'base_version', p_expected_version,
      'new_version', next_version
    )
  );

  return next_version;
end;
$$;

create function public.set_supply_list_status(
  p_list_id uuid,
  p_expected_version bigint,
  p_status public.supply_list_status
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_list public.supply_lists%rowtype;
  next_version bigint;
begin
  select list.* into target_list
  from public.supply_lists list
  where list.id = p_list_id
  for update;

  if not found or not public.is_org_member(target_list.organization_id) then
    raise exception 'Supply list not found' using errcode = '42501';
  end if;
  if target_list.version <> p_expected_version then
    raise exception 'Supply list has changed' using errcode = '40001';
  end if;
  if p_status = 'complete' and exists (
    select 1 from public.supply_list_items item
    where item.supply_list_id = p_list_id
      and item.source_present
      and not item.completed
  ) then
    raise exception 'All current items must be completed' using errcode = '22023';
  end if;

  update public.supply_lists
  set status = p_status,
      version = version + 1
  where id = p_list_id
  returning version into next_version;

  insert into public.audit_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    target_list.organization_id, (select auth.uid()), 'supply_list_status_changed',
    'supply_list', p_list_id::text,
    jsonb_build_object(
      'camp_id', target_list.camp_id,
      'status', p_status,
      'base_version', p_expected_version,
      'new_version', next_version
    )
  );

  return next_version;
end;
$$;

revoke all on function public.generate_supply_lists(uuid, uuid) from public, anon;
revoke all on function public.update_supply_item(uuid, bigint, numeric, text, text, text, boolean) from public, anon;
revoke all on function public.move_delivery_item(uuid, uuid, bigint) from public, anon;
revoke all on function public.set_supply_list_status(uuid, bigint, public.supply_list_status) from public, anon;
grant execute on function public.generate_supply_lists(uuid, uuid) to authenticated;
grant execute on function public.update_supply_item(uuid, bigint, numeric, text, text, text, boolean) to authenticated;
grant execute on function public.move_delivery_item(uuid, uuid, bigint) to authenticated;
grant execute on function public.set_supply_list_status(uuid, bigint, public.supply_list_status) to authenticated;
