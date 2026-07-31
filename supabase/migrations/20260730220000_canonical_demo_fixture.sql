-- One canonical, private and digest-bound synthetic camp fixture is shared by
-- local seeding and hosted demo provisioning. Browser roles never receive
-- access to either the fixture definition or its instance registry.

create extension if not exists pg_cron with schema pg_catalog;

create table app_private.demo_fixture_versions (
  fixture_key text not null check (fixture_key ~ '^[a-z0-9-]+$'),
  template_version integer not null check (template_version > 0),
  content_digest text not null unique check (content_digest ~ '^[0-9a-f]{64}$'),
  recipe_catalogue_digest text not null check (
    recipe_catalogue_digest ~ '^[0-9a-f]{64}$'
  ),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (fixture_key, template_version)
);

create unique index demo_fixture_versions_one_active_idx
  on app_private.demo_fixture_versions (fixture_key)
  where is_active;

alter table app_private.demo_fixture_versions enable row level security;
create policy demo_fixture_versions_deny_all
  on app_private.demo_fixture_versions
  as restrictive
  for all
  to public
  using (false)
  with check (false);
revoke all on table app_private.demo_fixture_versions
  from public, anon, authenticated, service_role;

create function app_private.demo_fixture_digest(p_definition jsonb)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(
    extensions.digest(convert_to(p_definition::text, 'UTF8'), 'sha256'),
    'hex'
  );
$$;

create function app_private.recipe_catalogue_digest()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        coalesce((
          select string_agg(
            template.template_key || ':' || template.content_digest,
            E'\n'
            order by template.sort_order, template.template_key
          )
          from app_private.recipe_templates as template
        ), ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create table app_private.demo_instances (
  user_id uuid primary key
    references auth.users(id) on delete cascade,
  organization_id uuid not null unique
    references public.organizations(id) on delete cascade,
  camp_id uuid not null unique,
  fixture_key text not null,
  template_version integer not null,
  template_digest text not null check (template_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  constraint demo_instances_camp_fk
    foreign key (organization_id, camp_id)
    references public.camps(organization_id, id)
    on delete cascade,
  constraint demo_instances_fixture_fk
    foreign key (fixture_key, template_version)
    references app_private.demo_fixture_versions(fixture_key, template_version)
    on delete restrict,
  constraint demo_instances_exact_lifetime_check
    check (expires_at = created_at + interval '24 hours')
);

create unique index demo_instances_organization_camp_idx
  on app_private.demo_instances (organization_id, camp_id);
create index demo_instances_fixture_fk_idx
  on app_private.demo_instances (fixture_key, template_version);
create index demo_instances_expires_at_idx
  on app_private.demo_instances (expires_at);

alter table app_private.demo_instances enable row level security;
create policy demo_instances_deny_all
  on app_private.demo_instances
  as restrictive
  for all
  to public
  using (false)
  with check (false);
revoke all on table app_private.demo_instances
  from public, anon, authenticated, service_role;

create function app_private.demo_fixture_uuid(
  p_symbolic_key text,
  p_use_legacy_test_ids boolean
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_use_legacy_test_ids then
    return p_symbolic_key::uuid;
  end if;
  return extensions.gen_random_uuid();
exception
  when invalid_text_representation then
    raise exception 'Invalid fixture UUID key: %', p_symbolic_key
      using errcode = '22023';
end;
$$;

create function app_private.demo_fixture_mapped_uuid(
  p_mapping jsonb,
  p_symbolic_key text,
  p_relation_name text
)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  mapped_value text;
begin
  if p_symbolic_key is null then
    return null;
  end if;

  mapped_value := p_mapping ->> p_symbolic_key;
  if mapped_value is null then
    raise exception 'Unknown % fixture reference: %', p_relation_name, p_symbolic_key
      using errcode = '23503';
  end if;
  return mapped_value::uuid;
end;
$$;

create function app_private.delete_demo_organization(
  p_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null
    or not exists (
      select 1
      from app_private.demo_instances as instance
      where instance.organization_id = p_organization_id
    ) then
    raise exception 'Registered demo organization required'
      using errcode = '42501';
  end if;

  -- Several tenant relations intentionally use RESTRICT so planners cannot
  -- accidentally invalidate operational history. Demo expiry is different:
  -- remove those dependants explicitly, then let the organization cascade
  -- clear the rest of the isolated tenant.
  delete from public.supplier_match_candidates
  where organization_id = p_organization_id;
  delete from public.preferred_supplier_matches
  where organization_id = p_organization_id;
  delete from public.ingredient_supplier_matches
  where organization_id = p_organization_id;
  delete from public.supplier_semantic_match_cache
  where organization_id = p_organization_id;
  delete from public.supplier_import_runs
  where organization_id = p_organization_id;
  delete from public.supplier_import_column_profiles
  where organization_id = p_organization_id;

  delete from public.supply_lists
  where organization_id = p_organization_id;
  delete from public.calculation_lines
  where organization_id = p_organization_id;
  delete from public.meals
  where organization_id = p_organization_id;
  delete from public.camp_recipe_copies
  where organization_id = p_organization_id;

  delete from public.organizations
  where id = p_organization_id;

  if found then
    return;
  end if;
  raise exception 'Demo organization disappeared during cleanup'
    using errcode = '55000';
end;
$$;

create function app_private.instantiate_demo_fixture(
  p_user_id uuid,
  p_created_at timestamptz,
  p_reset boolean,
  p_use_legacy_test_ids boolean,
  p_camp_starts_on date,
  p_allow_non_anonymous_local_user boolean default false
)
returns table (
  user_id uuid,
  organization_id uuid,
  camp_id uuid,
  template_version integer,
  template_digest text,
  created_at timestamptz,
  expires_at timestamptz,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  fixture app_private.demo_fixture_versions%rowtype;
  existing_instance app_private.demo_instances%rowtype;
  target_user auth.users%rowtype;
  definition jsonb;
  target_organization_id uuid;
  target_camp_id uuid;
  target_timezone text;
  reference_starts_on date;
  target_ends_on date;
  date_shift integer;
  time_shift interval;
  target_organization_name text;
  target_organization_slug text;
  target_camp_name text;
  target_id uuid;
  import_batch_id uuid;
  parent_id uuid;
  target_recipe_id uuid;
  version_id uuid;
  copy_id uuid;
  slot_id uuid;
  calculation_id uuid;
  list_id uuid;
  row_data jsonb;
  nested_row jsonb;
  template_row app_private.recipe_templates%rowtype;
  group_ids jsonb := '{}'::jsonb;
  participant_ids jsonb := '{}'::jsonb;
  dietary_tag_ids jsonb := '{}'::jsonb;
  dietary_need_ids jsonb := '{}'::jsonb;
  recipe_ids jsonb := '{}'::jsonb;
  recipe_version_ids jsonb := '{}'::jsonb;
  recipe_version_ids_by_template jsonb := '{}'::jsonb;
  recipe_ids_by_template jsonb := '{}'::jsonb;
  recipe_copy_ids jsonb := '{}'::jsonb;
  meal_slot_ids jsonb := '{}'::jsonb;
  calculation_ids jsonb := '{}'::jsonb;
  active_fixture_count integer;
begin
  if p_user_id is null
    or p_created_at is null
    or p_camp_starts_on is null then
    raise exception 'Demo fixture parameters cannot be null'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('lagermat:demo-instance:' || p_user_id::text, 0)
  );

  select users.*
  into target_user
  from auth.users as users
  where users.id = p_user_id
  for update;

  if not found then
    raise exception 'Demo user does not exist' using errcode = '22023';
  end if;
  if not p_allow_non_anonymous_local_user
    and not coalesce(target_user.is_anonymous, false) then
    raise exception 'Only anonymous Auth users can own hosted demo instances'
      using errcode = '42501';
  end if;

  select count(*)::integer
  into active_fixture_count
  from app_private.demo_fixture_versions as candidate
  where candidate.fixture_key = 'bjorkstad'
    and candidate.is_active;

  if active_fixture_count <> 1 then
    raise exception 'Exactly one active Björkstad fixture is required'
      using errcode = '55000';
  end if;

  select candidate.*
  into fixture
  from app_private.demo_fixture_versions as candidate
  where candidate.fixture_key = 'bjorkstad'
    and candidate.is_active
  for share;

  definition := fixture.definition;
  if app_private.demo_fixture_digest(definition) <> fixture.content_digest
    or definition ->> 'fixture_key' <> fixture.fixture_key
    or (definition ->> 'template_version')::integer <> fixture.template_version then
    raise exception 'Demo fixture digest or identity mismatch'
      using errcode = '55000';
  end if;
  if app_private.recipe_catalogue_digest() <> fixture.recipe_catalogue_digest then
    raise exception 'Demo fixture recipe catalogue digest mismatch'
      using errcode = '55000';
  end if;

  select instance.*
  into existing_instance
  from app_private.demo_instances as instance
  where instance.user_id = p_user_id
  for update;

  if found
    and not p_reset
    and existing_instance.expires_at > p_created_at
    and existing_instance.template_version = fixture.template_version
    and existing_instance.template_digest = fixture.content_digest then
    return query
    select
      existing_instance.user_id,
      existing_instance.organization_id,
      existing_instance.camp_id,
      existing_instance.template_version,
      existing_instance.template_digest,
      existing_instance.created_at,
      existing_instance.expires_at,
      true;
    return;
  end if;

  if found then
    -- The registry row is removed by the organization cascade. A later failure
    -- rolls this deletion back together with every newly inserted fixture row.
    perform app_private.delete_demo_organization(
      existing_instance.organization_id
    );
  end if;

  reference_starts_on := (definition -> 'camp' ->> 'starts_on')::date;
  target_timezone := definition -> 'camp' ->> 'timezone';
  if not exists (
    select 1 from pg_timezone_names where name = target_timezone
  ) then
    raise exception 'Unknown demo camp timezone' using errcode = '22023';
  end if;

  target_ends_on := p_camp_starts_on
    + ((definition -> 'camp' ->> 'ends_on')::date - reference_starts_on);
  date_shift := p_camp_starts_on - reference_starts_on;
  time_shift := (
    p_camp_starts_on::timestamp at time zone target_timezone
  ) - (
    reference_starts_on::timestamp at time zone target_timezone
  );

  target_organization_id := app_private.demo_fixture_uuid(
    definition -> 'organization' ->> 'key',
    p_use_legacy_test_ids
  );
  target_camp_id := app_private.demo_fixture_uuid(
    definition -> 'camp' ->> 'key',
    p_use_legacy_test_ids
  );
  target_organization_name := definition -> 'organization' ->> 'name';
  target_organization_slug := case
    when p_use_legacy_test_ids then definition -> 'organization' ->> 'slug'
    else 'demo-' || left(replace(target_organization_id::text, '-', ''), 24)
  end;
  target_camp_name := case
    when p_use_legacy_test_ids then definition -> 'camp' ->> 'name'
    else regexp_replace(
      definition -> 'camp' ->> 'name',
      '\s+[0-9]{4}$',
      ' ' || extract(year from p_camp_starts_on)::integer::text
    )
  end;

  insert into public.organizations (id, name, slug, created_by)
  values (
    target_organization_id,
    target_organization_name,
    target_organization_slug,
    p_user_id
  );

  -- The legacy organization trigger makes every creator an administrator.
  -- Hosted demo identities must only receive the planner surface. The stable
  -- local fixture deliberately keeps Oskar as an administrator so existing
  -- local administration tests remain representative.
  if not p_allow_non_anonymous_local_user then
    update public.organization_memberships as membership
    set role = 'planner'
    where membership.organization_id = target_organization_id
      and membership.user_id = p_user_id;
  end if;

  insert into public.camps (
    id,
    organization_id,
    name,
    starts_on,
    ends_on,
    timezone,
    status,
    created_by,
    meal_plan_confirmed_at,
    meal_plan_confirmed_by
  ) values (
    target_camp_id,
    target_organization_id,
    target_camp_name,
    p_camp_starts_on,
    target_ends_on,
    target_timezone,
    (definition -> 'camp' ->> 'status')::public.camp_status,
    p_user_id,
    p_created_at,
    p_user_id
  );

  -- Allocate every group ID before inserting rows so parent references can be
  -- resolved independently of JSON ordering.
  for row_data in
    select value from jsonb_array_elements(definition -> 'groups')
  loop
    target_id := app_private.demo_fixture_uuid(
      row_data ->> 'key',
      p_use_legacy_test_ids
    );
    group_ids := group_ids || jsonb_build_object(row_data ->> 'key', target_id);
  end loop;

  for row_data in
    select value from jsonb_array_elements(definition -> 'groups')
  loop
    target_id := app_private.demo_fixture_mapped_uuid(
      group_ids,
      row_data ->> 'key',
      'group'
    );
    parent_id := app_private.demo_fixture_mapped_uuid(
      group_ids,
      row_data ->> 'parent_key',
      'parent group'
    );
    insert into public.camp_groups (
      id,
      organization_id,
      camp_id,
      parent_group_id,
      kind,
      name,
      sort_order
    ) values (
      target_id,
      target_organization_id,
      target_camp_id,
      parent_id,
      (row_data ->> 'kind')::public.group_kind,
      row_data ->> 'name',
      (row_data ->> 'sort_order')::integer
    );
  end loop;

  import_batch_id := app_private.demo_fixture_uuid(
    definition -> 'import_batch' ->> 'key',
    p_use_legacy_test_ids
  );
  insert into public.import_batches (
    id,
    organization_id,
    camp_id,
    source_filename,
    source_kind,
    column_mapping,
    validation_summary,
    status,
    imported_by,
    completed_at
  ) values (
    import_batch_id,
    target_organization_id,
    target_camp_id,
    definition -> 'import_batch' ->> 'source_filename',
    definition -> 'import_batch' ->> 'source_kind',
    definition -> 'import_batch' -> 'column_mapping',
    definition -> 'import_batch' -> 'validation_summary',
    (definition -> 'import_batch' ->> 'status')::public.import_status,
    p_user_id,
    p_created_at
  );

  for row_data in
    select value from jsonb_array_elements(definition -> 'participants')
  loop
    target_id := app_private.demo_fixture_uuid(
      row_data ->> 'key',
      p_use_legacy_test_ids
    );
    participant_ids := participant_ids
      || jsonb_build_object(row_data ->> 'key', target_id);
    insert into public.participants (
      id,
      organization_id,
      camp_id,
      display_name,
      division_id,
      patrol_id,
      meal_group_id,
      food_factor,
      source_reference,
      import_batch_id
    ) values (
      target_id,
      target_organization_id,
      target_camp_id,
      row_data ->> 'display_name',
      app_private.demo_fixture_mapped_uuid(
        group_ids,
        row_data ->> 'division_key',
        'division'
      ),
      app_private.demo_fixture_mapped_uuid(
        group_ids,
        row_data ->> 'patrol_key',
        'patrol'
      ),
      app_private.demo_fixture_mapped_uuid(
        group_ids,
        row_data ->> 'meal_group_key',
        'meal group'
      ),
      (row_data ->> 'food_factor')::numeric,
      row_data ->> 'source_reference',
      import_batch_id
    );
  end loop;

  for row_data in
    select value from jsonb_array_elements(definition -> 'attendance')
  loop
    insert into public.participant_attendance (
      id,
      organization_id,
      camp_id,
      participant_id,
      starts_at,
      ends_at
    ) values (
      app_private.demo_fixture_uuid(
        row_data ->> 'key',
        p_use_legacy_test_ids
      ),
      target_organization_id,
      target_camp_id,
      app_private.demo_fixture_mapped_uuid(
        participant_ids,
        row_data ->> 'participant_key',
        'participant'
      ),
      (row_data ->> 'starts_at')::timestamptz + time_shift,
      (row_data ->> 'ends_at')::timestamptz + time_shift
    );
  end loop;

  for row_data in
    select value from jsonb_array_elements(definition -> 'dietary_tags')
  loop
    target_id := app_private.demo_fixture_uuid(
      row_data ->> 'key',
      p_use_legacy_test_ids
    );
    dietary_tag_ids := dietary_tag_ids
      || jsonb_build_object(row_data ->> 'key', target_id);
    insert into public.dietary_tags (
      id,
      organization_id,
      camp_id,
      label,
      description
    ) values (
      target_id,
      target_organization_id,
      target_camp_id,
      row_data ->> 'label',
      row_data ->> 'description'
    );
  end loop;

  for row_data in
    select value from jsonb_array_elements(definition -> 'dietary_needs')
  loop
    target_id := app_private.demo_fixture_uuid(
      row_data ->> 'key',
      p_use_legacy_test_ids
    );
    dietary_need_ids := dietary_need_ids
      || jsonb_build_object(row_data ->> 'key', target_id);
    insert into public.participant_dietary_needs (
      id,
      organization_id,
      camp_id,
      participant_id,
      raw_food_note,
      review_status,
      reviewed_by,
      reviewed_at
    ) values (
      target_id,
      target_organization_id,
      target_camp_id,
      app_private.demo_fixture_mapped_uuid(
        participant_ids,
        row_data ->> 'participant_key',
        'dietary participant'
      ),
      row_data ->> 'raw_food_note',
      (row_data ->> 'review_status')::public.dietary_review_status,
      case
        when row_data ->> 'review_status' = 'resolved' then p_user_id
        else null
      end,
      case
        when row_data ->> 'review_status' = 'resolved' then p_created_at
        else null
      end
    );
  end loop;

  for row_data in
    select value from jsonb_array_elements(definition -> 'dietary_need_tags')
  loop
    insert into public.dietary_need_tags (
      organization_id,
      camp_id,
      dietary_need_id,
      dietary_tag_id
    ) values (
      target_organization_id,
      target_camp_id,
      app_private.demo_fixture_mapped_uuid(
        dietary_need_ids,
        row_data ->> 'dietary_need_key',
        'dietary need'
      ),
      app_private.demo_fixture_mapped_uuid(
        dietary_tag_ids,
        row_data ->> 'dietary_tag_key',
        'dietary tag'
      )
    );
  end loop;

  -- Clone the reviewed catalogue with new IDs. The fixture row binds the exact
  -- catalogue digest, so catalogue drift fails before any tenant row is made.
  for template_row in
    select template.*
    from app_private.recipe_templates as template
    order by template.sort_order, template.template_key
  loop
    target_recipe_id := app_private.demo_fixture_uuid(
      template_row.id::text,
      p_use_legacy_test_ids
    );
    version_id := app_private.demo_fixture_uuid(
      template_row.id::text,
      p_use_legacy_test_ids
    );
    recipe_ids_by_template := recipe_ids_by_template
      || jsonb_build_object(template_row.template_key, target_recipe_id);
    recipe_version_ids_by_template := recipe_version_ids_by_template
      || jsonb_build_object(template_row.template_key, version_id);

    insert into public.recipes (id, organization_id, name, created_by)
    values (
      target_recipe_id,
      target_organization_id,
      template_row.name,
      p_user_id
    );
    insert into public.recipe_versions (
      id,
      organization_id,
      recipe_id,
      version_number,
      status,
      instructions,
      portion_size,
      content_digest,
      created_by,
      published_at
    ) values (
      version_id,
      target_organization_id,
      target_recipe_id,
      1,
      'published',
      template_row.instructions,
      template_row.portion_size,
      template_row.content_digest,
      p_user_id,
      p_created_at
    );
    insert into public.recipe_ingredients (
      id,
      organization_id,
      recipe_version_id,
      name,
      unit,
      amount,
      mode,
      dietary_rule,
      dietary_tag_label,
      comment,
      source_row,
      sort_order
    )
    select
      app_private.demo_fixture_uuid(
        ingredient.id::text,
        p_use_legacy_test_ids
      ),
      target_organization_id,
      version_id,
      ingredient.name,
      ingredient.unit,
      ingredient.amount,
      ingredient.mode,
      ingredient.dietary_rule,
      ingredient.dietary_tag_label,
      ingredient.comment,
      ingredient.source_row,
      ingredient.sort_order
    from app_private.recipe_ingredient_templates as ingredient
    where ingredient.recipe_template_id = template_row.id
    order by ingredient.sort_order, ingredient.id;
  end loop;

  for row_data in
    select value from jsonb_array_elements(definition -> 'local_recipes')
  loop
    target_recipe_id := app_private.demo_fixture_uuid(
      row_data ->> 'recipe_key',
      p_use_legacy_test_ids
    );
    version_id := app_private.demo_fixture_uuid(
      row_data ->> 'version_key',
      p_use_legacy_test_ids
    );
    recipe_ids := recipe_ids
      || jsonb_build_object(row_data ->> 'recipe_key', target_recipe_id);
    recipe_version_ids := recipe_version_ids
      || jsonb_build_object(row_data ->> 'recipe_key', version_id);

    insert into public.recipes (id, organization_id, name, created_by)
    values (
      target_recipe_id,
      target_organization_id,
      row_data ->> 'name',
      p_user_id
    );
    insert into public.recipe_versions (
      id,
      organization_id,
      recipe_id,
      version_number,
      status,
      instructions,
      portion_size,
      content_digest,
      created_by,
      published_at
    ) values (
      version_id,
      target_organization_id,
      target_recipe_id,
      (row_data ->> 'version_number')::integer,
      (row_data ->> 'status')::public.recipe_status,
      row_data ->> 'instructions',
      nullif(row_data ->> 'portion_size', '')::numeric,
      row_data ->> 'content_digest',
      p_user_id,
      p_created_at
    );

    for nested_row in
      select value from jsonb_array_elements(row_data -> 'ingredients')
    loop
      insert into public.recipe_ingredients (
        id,
        organization_id,
        recipe_version_id,
        name,
        unit,
        amount,
        mode,
        dietary_rule,
        dietary_tag_label,
        comment,
        source_row,
        sort_order
      ) values (
        app_private.demo_fixture_uuid(
          nested_row ->> 'key',
          p_use_legacy_test_ids
        ),
        target_organization_id,
        version_id,
        nested_row ->> 'name',
        nested_row ->> 'unit',
        (nested_row ->> 'amount')::numeric,
        (nested_row ->> 'mode')::public.ingredient_mode,
        (nested_row ->> 'dietary_rule')::public.dietary_rule,
        nested_row ->> 'dietary_tag_label',
        nested_row ->> 'comment',
        nullif(nested_row ->> 'source_row', '')::integer,
        (nested_row ->> 'sort_order')::integer
      );
    end loop;
  end loop;

  for row_data in
    select value from jsonb_array_elements(definition -> 'local_recipe_copies')
  loop
    copy_id := app_private.demo_fixture_uuid(
      row_data ->> 'key',
      p_use_legacy_test_ids
    );
    target_recipe_id := app_private.demo_fixture_mapped_uuid(
      recipe_ids,
      row_data ->> 'recipe_key',
      'local recipe'
    );
    version_id := app_private.demo_fixture_mapped_uuid(
      recipe_version_ids,
      row_data ->> 'recipe_key',
      'local recipe version'
    );
    recipe_copy_ids := recipe_copy_ids
      || jsonb_build_object(row_data ->> 'key', copy_id);

    insert into public.camp_recipe_copies (
      id,
      organization_id,
      camp_id,
      source_recipe_version_id,
      name,
      version_key,
      frozen_snapshot,
      copied_by
    )
    select
      copy_id,
      target_organization_id,
      target_camp_id,
      version.id,
      recipe.name,
      version.id::text || '@' || left(version.content_digest, 16),
      jsonb_build_object(
        'name', recipe.name,
        'version', version.version_number,
        'version_key', version.id::text || '@' || left(version.content_digest, 16),
        'content_digest', version.content_digest,
        'instructions', version.instructions,
        'portion_size', version.portion_size,
        'ingredients', coalesce((
          select jsonb_agg(
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
            )
            order by ingredient.sort_order, ingredient.id
          )
          from public.recipe_ingredients as ingredient
          where ingredient.organization_id = target_organization_id
            and ingredient.recipe_version_id = version.id
        ), '[]'::jsonb)
      ),
      p_user_id
    from public.recipe_versions as version
    join public.recipes as recipe
      on recipe.organization_id = version.organization_id
     and recipe.id = version.recipe_id
    where version.organization_id = target_organization_id
      and version.id = version_id
      and recipe.id = target_recipe_id;
  end loop;

  for row_data in
    select value from jsonb_array_elements(definition -> 'catalogue_copies')
  loop
    copy_id := app_private.demo_fixture_uuid(
      row_data ->> 'key',
      p_use_legacy_test_ids
    );
    target_recipe_id := app_private.demo_fixture_mapped_uuid(
      recipe_ids_by_template,
      row_data ->> 'template_key',
      'catalogue recipe'
    );
    version_id := app_private.demo_fixture_mapped_uuid(
      recipe_version_ids_by_template,
      row_data ->> 'template_key',
      'catalogue recipe version'
    );
    recipe_copy_ids := recipe_copy_ids
      || jsonb_build_object(row_data ->> 'key', copy_id);

    insert into public.camp_recipe_copies (
      id,
      organization_id,
      camp_id,
      source_recipe_version_id,
      name,
      version_key,
      frozen_snapshot,
      copied_by
    )
    select
      copy_id,
      target_organization_id,
      target_camp_id,
      version.id,
      recipe.name,
      version.id::text || '@' || left(version.content_digest, 16),
      jsonb_build_object(
        'name', recipe.name,
        'version', version.version_number,
        'version_key', version.id::text || '@' || left(version.content_digest, 16),
        'content_digest', version.content_digest,
        'instructions', version.instructions,
        'portion_size', version.portion_size,
        'ingredients', coalesce((
          select jsonb_agg(
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
            )
            order by ingredient.sort_order, ingredient.id
          )
          from public.recipe_ingredients as ingredient
          where ingredient.organization_id = target_organization_id
            and ingredient.recipe_version_id = version.id
        ), '[]'::jsonb)
      ),
      p_user_id
    from public.recipe_versions as version
    join public.recipes as recipe
      on recipe.organization_id = version.organization_id
     and recipe.id = version.recipe_id
    where version.organization_id = target_organization_id
      and version.id = version_id
      and recipe.id = target_recipe_id;
  end loop;

  for row_data in
    select value from jsonb_array_elements(definition -> 'meal_slots')
  loop
    slot_id := app_private.demo_fixture_uuid(
      row_data ->> 'key',
      p_use_legacy_test_ids
    );
    meal_slot_ids := meal_slot_ids
      || jsonb_build_object(row_data ->> 'key', slot_id);
    insert into public.camp_meal_slots (
      id,
      organization_id,
      camp_id,
      slot_key,
      service_date,
      starts_at,
      meal_type,
      label,
      service_status,
      source,
      sort_order
    ) values (
      slot_id,
      target_organization_id,
      target_camp_id,
      row_data ->> 'slot_key',
      (row_data ->> 'service_date')::date + date_shift,
      (row_data ->> 'starts_at')::timestamptz + time_shift,
      row_data ->> 'meal_type',
      row_data ->> 'label',
      row_data ->> 'service_status',
      row_data ->> 'source',
      (row_data ->> 'sort_order')::integer
    );
  end loop;

  for row_data in
    select value from jsonb_array_elements(definition -> 'meals')
  loop
    insert into public.meals (
      id,
      organization_id,
      camp_id,
      camp_recipe_copy_id,
      meal_slot_id,
      starts_at,
      meal_type,
      title,
      status
    ) values (
      app_private.demo_fixture_uuid(
        row_data ->> 'key',
        p_use_legacy_test_ids
      ),
      target_organization_id,
      target_camp_id,
      app_private.demo_fixture_mapped_uuid(
        recipe_copy_ids,
        row_data ->> 'recipe_copy_key',
        'recipe copy'
      ),
      app_private.demo_fixture_mapped_uuid(
        meal_slot_ids,
        row_data ->> 'meal_slot_key',
        'meal slot'
      ),
      (row_data ->> 'starts_at')::timestamptz + time_shift,
      row_data ->> 'meal_type',
      row_data ->> 'title',
      (row_data ->> 'status')::public.meal_status
    );
  end loop;

  for row_data in
    select value from jsonb_array_elements(definition -> 'calculation_revisions')
  loop
    calculation_id := app_private.demo_fixture_uuid(
      row_data ->> 'key',
      p_use_legacy_test_ids
    );
    calculation_ids := calculation_ids
      || jsonb_build_object(row_data ->> 'key', calculation_id);
    insert into public.calculation_revisions (
      id,
      organization_id,
      camp_id,
      revision_number,
      status,
      input_digest,
      problem_summary,
      calculated_by
    ) values (
      calculation_id,
      target_organization_id,
      target_camp_id,
      (row_data ->> 'revision_number')::integer,
      (row_data ->> 'status')::public.calculation_status,
      row_data ->> 'input_digest',
      row_data -> 'problem_summary',
      p_user_id
    );
  end loop;

  for row_data in
    select value from jsonb_array_elements(definition -> 'supply_lists')
  loop
    list_id := app_private.demo_fixture_uuid(
      row_data ->> 'key',
      p_use_legacy_test_ids
    );
    insert into public.supply_lists (
      id,
      organization_id,
      camp_id,
      calculation_revision_id,
      meal_group_id,
      kind,
      status,
      title,
      list_key,
      source_present
    ) values (
      list_id,
      target_organization_id,
      target_camp_id,
      app_private.demo_fixture_mapped_uuid(
        calculation_ids,
        row_data ->> 'calculation_revision_key',
        'calculation revision'
      ),
      app_private.demo_fixture_mapped_uuid(
        group_ids,
        row_data ->> 'meal_group_key',
        'meal group'
      ),
      (row_data ->> 'kind')::public.supply_list_kind,
      (row_data ->> 'status')::public.supply_list_status,
      row_data ->> 'title',
      row_data ->> 'list_key',
      (row_data ->> 'source_present')::boolean
    );

    for nested_row in
      select value from jsonb_array_elements(row_data -> 'items')
    loop
      insert into public.supply_list_items (
        organization_id,
        camp_id,
        supply_list_id,
        category,
        item_name,
        required_amount,
        required_unit,
        ordered_amount,
        ordered_unit,
        package_note,
        comment,
        completed,
        updated_by,
        item_key,
        source_line_keys,
        source_present,
        manually_moved
      ) values (
        target_organization_id,
        target_camp_id,
        list_id,
        nested_row ->> 'category',
        nested_row ->> 'item_name',
        (nested_row ->> 'required_amount')::numeric,
        nested_row ->> 'required_unit',
        nullif(nested_row ->> 'ordered_amount', '')::numeric,
        nested_row ->> 'ordered_unit',
        nested_row ->> 'package_note',
        nested_row ->> 'comment',
        (nested_row ->> 'completed')::boolean,
        p_user_id,
        nested_row ->> 'item_key',
        nested_row -> 'source_line_keys',
        (nested_row ->> 'source_present')::boolean,
        (nested_row ->> 'manually_moved')::boolean
      );
    end loop;
  end loop;

  insert into app_private.demo_instances (
    user_id,
    organization_id,
    camp_id,
    fixture_key,
    template_version,
    template_digest,
    created_at,
    expires_at
  ) values (
    p_user_id,
    target_organization_id,
    target_camp_id,
    fixture.fixture_key,
    fixture.template_version,
    fixture.content_digest,
    p_created_at,
    p_created_at + interval '24 hours'
  );

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    target_organization_id,
    p_user_id,
    'demo_instance_provisioned',
    'demo_instance',
    target_organization_id::text,
    jsonb_build_object(
      'camp_id', target_camp_id,
      'fixture_key', fixture.fixture_key,
      'template_version', fixture.template_version,
      'template_digest', fixture.content_digest,
      'expires_at', p_created_at + interval '24 hours',
      'participant_count', jsonb_array_length(definition -> 'participants'),
      'recipe_count', (
        select count(*) from public.recipes as recipe_count_row
        where recipe_count_row.organization_id = target_organization_id
      ),
      'meal_count', jsonb_array_length(definition -> 'meals')
    )
  );

  return query
  select
    p_user_id,
    target_organization_id,
    target_camp_id,
    fixture.template_version,
    fixture.content_digest,
    p_created_at,
    p_created_at + interval '24 hours',
    false;
end;
$$;

create function public.provision_demo_instance(
  p_user_id uuid,
  p_reset boolean default false
)
returns table (
  user_id uuid,
  organization_id uuid,
  camp_id uuid,
  template_version integer,
  template_digest text,
  created_at timestamptz,
  expires_at timestamptz,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  provisioned_at timestamptz := clock_timestamp();
  starts_on date := (
    (clock_timestamp() at time zone 'Europe/Stockholm')::date + 3
  );
begin
  if not exists (
    select 1
    from auth.users as users
    where users.id = p_user_id
      and users.is_anonymous is true
  ) then
    raise exception 'Verified anonymous Auth user required'
      using errcode = '42501';
  end if;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || '{"lagermat_demo":true}'::jsonb
  where id = p_user_id
    and is_anonymous is true;

  return query
  select *
  from app_private.instantiate_demo_fixture(
    p_user_id,
    provisioned_at,
    p_reset,
    false,
    starts_on,
    false
  );
end;
$$;

create function public.get_demo_session_status()
returns table (
  state text,
  expires_at timestamptz,
  organization_id uuid,
  camp_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  anonymous_user boolean;
  instance app_private.demo_instances%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authenticated session required' using errcode = '42501';
  end if;

  select users.is_anonymous
  into anonymous_user
  from auth.users as users
  where users.id = current_user_id;

  if not coalesce(anonymous_user, false) then
    return query select 'not_demo'::text, null::timestamptz, null::uuid, null::uuid;
    return;
  end if;

  select candidate.*
  into instance
  from app_private.demo_instances as candidate
  where candidate.user_id = current_user_id;

  if not found then
    return query select 'missing'::text, null::timestamptz, null::uuid, null::uuid;
  elsif instance.expires_at <= statement_timestamp() then
    return query
    select 'expired'::text, instance.expires_at, null::uuid, null::uuid;
  else
    return query
    select
      'active'::text,
      instance.expires_at,
      instance.organization_id,
      instance.camp_id;
  end if;
end;
$$;

-- An expired demo loses all tenant access at the exact boundary, even if the
-- hourly cleanup has not yet run and its JWT has not yet expired.
create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_memberships as membership
      where membership.organization_id = target_organization_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
    )
    and not exists (
      select 1
      from app_private.demo_instances as instance
      where instance.user_id = (select auth.uid())
        and instance.organization_id = target_organization_id
        and instance.expires_at <= statement_timestamp()
    );
$$;

create or replace function public.is_org_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_org_member(target_organization_id)
    and exists (
      select 1
      from public.organization_memberships as membership
      where membership.organization_id = target_organization_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and membership.role = 'admin'
    );
$$;

create function app_private.cleanup_expired_demo_instances(
  p_now timestamptz default clock_timestamp()
)
returns table (
  expired_instances_deleted integer,
  orphan_users_deleted integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_instance record;
  deleted_expired integer := 0;
  deleted_orphans integer := 0;
  affected integer;
begin
  if p_now is null then
    raise exception 'Cleanup timestamp cannot be null' using errcode = '22023';
  end if;

  for expired_instance in
    select
      instance.user_id,
      instance.organization_id
    from app_private.demo_instances as instance
    join auth.users as users on users.id = instance.user_id
    where instance.expires_at <= p_now
      and users.is_anonymous is true
    order by instance.expires_at, instance.user_id
    for update of instance skip locked
  loop
    perform app_private.delete_demo_organization(
      expired_instance.organization_id
    );

    delete from auth.users
    where id = expired_instance.user_id
      and is_anonymous is true;
    get diagnostics affected = row_count;
    deleted_expired := deleted_expired + affected;
  end loop;

  -- Anonymous users created for a demo but abandoned before an instance was
  -- registered have no membership. A one-hour grace period avoids racing a
  -- legitimate in-flight provisioner while still bounding orphan growth.
  delete from auth.users as users
  where users.is_anonymous is true
    and users.created_at <= p_now - interval '1 hour'
    and not exists (
      select 1 from app_private.demo_instances as instance
      where instance.user_id = users.id
    )
    and not exists (
      select 1 from public.organization_memberships as membership
      where membership.user_id = users.id
    );
  get diagnostics deleted_orphans = row_count;

  return query select deleted_expired, deleted_orphans;
end;
$$;

revoke all on function app_private.demo_fixture_digest(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_private.recipe_catalogue_digest()
  from public, anon, authenticated, service_role;
revoke all on function app_private.demo_fixture_uuid(text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function app_private.demo_fixture_mapped_uuid(jsonb, text, text)
  from public, anon, authenticated, service_role;
revoke all on function app_private.delete_demo_organization(uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.instantiate_demo_fixture(
  uuid, timestamptz, boolean, boolean, date, boolean
) from public, anon, authenticated, service_role;
revoke all on function app_private.cleanup_expired_demo_instances(timestamptz)
  from public, anon, authenticated, service_role;

revoke all on function public.provision_demo_instance(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.provision_demo_instance(uuid, boolean)
  to service_role;

revoke all on function public.get_demo_session_status()
  from public, anon;
grant execute on function public.get_demo_session_status()
  to authenticated;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.is_org_admin(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;

select cron.schedule(
  'lagermat-demo-cleanup-hourly',
  '0 * * * *',
  'select app_private.cleanup_expired_demo_instances();'
);
