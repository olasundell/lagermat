-- Production privilege boundary, hosted bootstrap and deterministic calculation freshness.

-- Invitation UUIDs are identifiers, not bearer secrets. Existing local token-based
-- invitations cannot be upgraded safely, so invalidate them during deployment.
update public.organization_invitations
set accepted_at = coalesce(accepted_at, now())
where token_hash is not null
  and accepted_at is null;

alter table public.organization_invitations
  alter column token_hash drop not null;

update public.organization_invitations set token_hash = null;

drop function public.accept_organization_invitation(text);

create function public.current_authentication_assurance_level()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims_text text;
  assurance_level text;
begin
  claims_text := nullif(current_setting('request.jwt.claims', true), '');
  if claims_text is not null then
    assurance_level := claims_text::jsonb ->> 'aal';
  end if;
  return coalesce(
    assurance_level,
    nullif(current_setting('request.jwt.claim.aal', true), '')
  );
end;
$$;

revoke all on function public.current_authentication_assurance_level()
  from public, anon, authenticated;
grant execute on function public.current_authentication_assurance_level()
  to authenticated;

create function public.accept_organization_invitation(invitation_id uuid)
returns table (organization_id uuid, role public.organization_role)
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_invitation public.organization_invitations%rowtype;
  signed_in_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if invitation_id is null then
    raise exception 'Invitation is invalid or expired' using errcode = '22023';
  end if;

  select lower(trim(users.email))
  into signed_in_email
  from auth.users as users
  where users.id = (select auth.uid());

  select invitations.*
  into matched_invitation
  from public.organization_invitations as invitations
  where invitations.id = invitation_id
    and invitations.accepted_at is null
    and invitations.expires_at > now()
  for update;

  if not found or signed_in_email is null then
    raise exception 'Invitation is invalid or expired' using errcode = '22023';
  end if;

  if matched_invitation.email <> signed_in_email then
    raise exception 'Invitation belongs to another email address' using errcode = '42501';
  end if;

  insert into public.organization_memberships as memberships (
    organization_id,
    user_id,
    role,
    status
  ) values (
    matched_invitation.organization_id,
    (select auth.uid()),
    matched_invitation.role,
    'active'
  )
  on conflict on constraint organization_memberships_pkey do update
  set role = case
        when memberships.role = 'admin' then memberships.role
        else excluded.role
      end,
      status = 'active',
      updated_at = now();

  update public.organization_invitations
  set accepted_at = now(),
      accepted_by = (select auth.uid())
  where id = matched_invitation.id;

  insert into public.audit_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    matched_invitation.organization_id,
    (select auth.uid()),
    'organization_invitation_accepted',
    'organization_invitation',
    matched_invitation.id::text,
    jsonb_build_object('invited_role', matched_invitation.role)
  );

  return query
  select memberships.organization_id, memberships.role
  from public.organization_memberships as memberships
  where memberships.organization_id = matched_invitation.organization_id
    and memberships.user_id = (select auth.uid());
end;
$$;

revoke all on function public.accept_organization_invitation(uuid)
  from public, anon;
grant execute on function public.accept_organization_invitation(uuid)
  to authenticated;

create or replace function public.list_organization_members(target_organization_id uuid)
returns table (
  user_id uuid,
  email text,
  display_name text,
  role public.organization_role,
  status public.membership_status
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_org_admin(target_organization_id)
    or public.current_authentication_assurance_level() <> 'aal2' then
    raise exception 'AAL2 administrator session required' using errcode = '42501';
  end if;

  return query
  select
    memberships.user_id,
    users.email::text,
    coalesce(
      users.raw_user_meta_data ->> 'display_name',
      split_part(users.email, '@', 1)
    )::text,
    memberships.role,
    memberships.status
  from public.organization_memberships as memberships
  join auth.users as users on users.id = memberships.user_id
  where memberships.organization_id = target_organization_id
  order by lower(users.email);
end;
$$;

create function public.change_member_role(
  p_organization_id uuid,
  p_member_user_id uuid,
  p_role public.organization_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_membership public.organization_memberships%rowtype;
  active_admin_count integer;
begin
  if not public.is_org_admin(p_organization_id)
    or public.current_authentication_assurance_level() <> 'aal2' then
    raise exception 'AAL2 administrator session required' using errcode = '42501';
  end if;

  select membership.*
  into target_membership
  from public.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_member_user_id
  for update;

  if not found then
    raise exception 'Organization membership not found' using errcode = '22023';
  end if;

  if target_membership.role = 'admin'
    and target_membership.status = 'active'
    and p_role <> 'admin' then
    select count(*)::integer
    into active_admin_count
    from public.organization_memberships as membership
    where membership.organization_id = p_organization_id
      and membership.role = 'admin'
      and membership.status = 'active';

    if active_admin_count <= 1 then
      raise exception 'The final active administrator cannot be demoted'
        using errcode = '22023';
    end if;
  end if;

  if target_membership.role = p_role then
    return;
  end if;

  update public.organization_memberships
  set role = p_role
  where organization_id = p_organization_id
    and user_id = p_member_user_id;

  insert into public.audit_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_organization_id,
    (select auth.uid()),
    'organization_member_role_changed',
    'organization_membership',
    p_member_user_id::text,
    jsonb_build_object('previous_role', target_membership.role, 'role', p_role)
  );
end;
$$;

revoke all on function public.change_member_role(uuid, uuid, public.organization_role)
  from public, anon;
grant execute on function public.change_member_role(uuid, uuid, public.organization_role)
  to authenticated;

drop policy invitations_admin_access on public.organization_invitations;
create policy invitations_aal2_admin_select
  on public.organization_invitations
  for select
  to authenticated
  using (
    public.is_org_admin(organization_id)
    and public.current_authentication_assurance_level() = 'aal2'
  );

-- Recipe templates are deployment data, not tenant data and are deliberately
-- kept outside the schemas exposed by the Data API.
create schema app_private;
revoke all on schema app_private from public, anon, authenticated;

create table app_private.recipe_templates (
  id uuid primary key,
  template_key text not null unique check (template_key ~ '^[a-z0-9-]+$'),
  name text not null check (length(trim(name)) between 1 and 180),
  instructions text,
  portion_size numeric(16,6) check (portion_size is null or portion_size > 0),
  content_digest text not null unique check (length(content_digest) = 64),
  sort_order integer not null default 0
);

create table app_private.recipe_ingredient_templates (
  id uuid primary key,
  recipe_template_id uuid not null
    references app_private.recipe_templates(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  unit text not null check (length(trim(unit)) between 1 and 30),
  amount numeric(20,6) not null check (amount >= 0),
  mode public.ingredient_mode not null,
  dietary_rule public.dietary_rule not null default 'standard',
  dietary_tag_label text,
  comment text,
  source_row integer check (source_row is null or source_row > 0),
  sort_order integer not null default 0
);

create index recipe_ingredient_templates_recipe_idx
  on app_private.recipe_ingredient_templates (recipe_template_id, sort_order);

-- A small, provenance-free starter set. The local workbook seed remains a
-- development fixture and is never required by production migrations.
insert into app_private.recipe_templates (
  id, template_key, name, instructions, content_digest, sort_order
) values
  (
    '01000000-0000-0000-0000-000000000001',
    'frukostbas',
    'Frukostbas',
    'Grundrecept att anpassa efter lägrets deltagare och specialkost.',
    encode(extensions.digest(convert_to('frukostbas-v1', 'UTF8'), 'sha256'), 'hex'),
    10
  ),
  (
    '01000000-0000-0000-0000-000000000002',
    'chili-sin-carne',
    'Chili sin carne',
    'Grundrecept att anpassa efter lägrets deltagare och specialkost.',
    encode(extensions.digest(convert_to('chili-sin-carne-v1', 'UTF8'), 'sha256'), 'hex'),
    20
  );

insert into app_private.recipe_ingredient_templates (
  id, recipe_template_id, name, unit, amount, mode,
  dietary_rule, dietary_tag_label, sort_order
) values
  ('02000000-0000-0000-0000-000000000001', '01000000-0000-0000-0000-000000000001', 'Havregryn', 'kg', 0.040, 'weighted_portion', 'standard', null, 10),
  ('02000000-0000-0000-0000-000000000002', '01000000-0000-0000-0000-000000000001', 'Mjukt bröd', 'skivor', 2, 'head', 'exclude', 'Gluten', 20),
  ('02000000-0000-0000-0000-000000000003', '01000000-0000-0000-0000-000000000001', 'Glutenfritt bröd', 'skivor', 2, 'head', 'only', 'Gluten', 30),
  ('02000000-0000-0000-0000-000000000004', '01000000-0000-0000-0000-000000000002', 'Bönor', 'kg', 0.100, 'weighted_portion', 'standard', null, 10),
  ('02000000-0000-0000-0000-000000000005', '01000000-0000-0000-0000-000000000002', 'Krossade tomater', 'kg', 0.100, 'weighted_portion', 'standard', null, 20),
  ('02000000-0000-0000-0000-000000000006', '01000000-0000-0000-0000-000000000002', 'Ris', 'kg', 0.080, 'weighted_portion', 'standard', null, 30);

create function public.bootstrap_first_organization(
  p_admin_user_id uuid,
  p_organization_name text,
  p_organization_slug text,
  p_camp_name text,
  p_starts_on date,
  p_ends_on date,
  p_timezone text
)
returns table (organization_id uuid, camp_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid := extensions.gen_random_uuid();
  new_camp_id uuid := extensions.gen_random_uuid();
  new_recipe_id uuid;
  new_version_id uuid;
  template_row app_private.recipe_templates%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('lagermat:first-organization', 0));

  if not exists (select 1 from auth.users as users where users.id = p_admin_user_id) then
    raise exception 'Administrator user does not exist' using errcode = '22023';
  end if;
  if exists (select 1 from public.organizations) then
    raise exception 'The first organization has already been bootstrapped'
      using errcode = '55000';
  end if;
  if p_admin_user_id is null
    or length(trim(coalesce(p_organization_name, ''))) not between 2 and 120
    or coalesce(p_organization_slug, '') <> lower(coalesce(p_organization_slug, ''))
    or coalesce(p_organization_slug, '') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or length(trim(coalesce(p_camp_name, ''))) not between 2 and 160
    or p_starts_on is null
    or p_ends_on is null
    or p_ends_on < p_starts_on
    or length(trim(coalesce(p_timezone, ''))) not between 1 and 80 then
    raise exception 'Bootstrap parameters failed validation' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown camp timezone' using errcode = '22023';
  end if;
  if not exists (select 1 from app_private.recipe_templates) then
    raise exception 'No approved recipe templates are installed' using errcode = '55000';
  end if;

  insert into public.organizations (id, name, slug, created_by)
  values (
    new_organization_id,
    trim(p_organization_name),
    p_organization_slug,
    p_admin_user_id
  );

  insert into public.camps (
    id, organization_id, name, starts_on, ends_on, timezone, created_by
  ) values (
    new_camp_id,
    new_organization_id,
    trim(p_camp_name),
    p_starts_on,
    p_ends_on,
    p_timezone,
    p_admin_user_id
  );

  for template_row in
    select template.*
    from app_private.recipe_templates as template
    order by template.sort_order, template.template_key
  loop
    new_recipe_id := extensions.gen_random_uuid();
    new_version_id := extensions.gen_random_uuid();

    insert into public.recipes (id, organization_id, name, created_by)
    values (new_recipe_id, new_organization_id, template_row.name, p_admin_user_id);

    insert into public.recipe_versions (
      id, organization_id, recipe_id, version_number, status,
      instructions, portion_size, content_digest, created_by, published_at
    ) values (
      new_version_id,
      new_organization_id,
      new_recipe_id,
      1,
      'published',
      template_row.instructions,
      template_row.portion_size,
      template_row.content_digest,
      p_admin_user_id,
      now()
    );

    insert into public.recipe_ingredients (
      organization_id, recipe_version_id, name, unit, amount, mode,
      dietary_rule, dietary_tag_label, comment, source_row, sort_order
    )
    select
      new_organization_id,
      new_version_id,
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

  insert into public.audit_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    new_organization_id,
    p_admin_user_id,
    'first_organization_bootstrapped',
    'organization',
    new_organization_id::text,
    jsonb_build_object(
      'camp_id', new_camp_id,
      'recipe_count', (select count(*) from app_private.recipe_templates),
      'ingredient_count', (
        select count(*) from app_private.recipe_ingredient_templates
      ),
      'recipe_catalogue_digest', encode(extensions.digest(convert_to(
        coalesce((
          select string_agg(
            template.template_key || ':' || template.content_digest,
            E'\n' order by template.sort_order, template.template_key
          )
          from app_private.recipe_templates as template
        ), ''),
        'UTF8'
      ), 'sha256'), 'hex')
    )
  );

  return query select new_organization_id, new_camp_id;
end;
$$;

revoke all on function public.bootstrap_first_organization(
  uuid, text, text, text, date, date, text
) from public, anon, authenticated;
grant execute on function public.bootstrap_first_organization(
  uuid, text, text, text, date, date, text
) to service_role;

-- A single canonical digest is used by calculation, readiness and supply
-- generation. Arrays are explicitly ordered so the same input always hashes to
-- the same value independently of planner query order.
create function public.camp_input_digest(
  p_organization_id uuid,
  p_camp_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'camp', coalesce((
      select jsonb_build_object(
        'starts_on', camp.starts_on,
        'ends_on', camp.ends_on,
        'timezone', camp.timezone
      )
      from public.camps as camp
      where camp.organization_id = p_organization_id
        and camp.id = p_camp_id
    ), '{}'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', group_row.id,
        'parent_id', group_row.parent_group_id,
        'kind', group_row.kind,
        'name', group_row.name,
        'sort_order', group_row.sort_order
      ) order by group_row.id)
      from public.camp_groups as group_row
      where group_row.organization_id = p_organization_id
        and group_row.camp_id = p_camp_id
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', participant.id,
        'factor', participant.food_factor,
        'division_id', participant.division_id,
        'patrol_id', participant.patrol_id,
        'meal_group_id', participant.meal_group_id
      ) order by participant.id)
      from public.participants as participant
      where participant.organization_id = p_organization_id
        and participant.camp_id = p_camp_id
    ), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', attendance.id,
        'participant_id', attendance.participant_id,
        'starts_at', attendance.starts_at,
        'ends_at', attendance.ends_at
      ) order by attendance.participant_id, attendance.starts_at, attendance.id)
      from public.participant_attendance as attendance
      where attendance.organization_id = p_organization_id
        and attendance.camp_id = p_camp_id
    ), '[]'::jsonb),
    'dietary', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', need.id,
        'participant_id', need.participant_id,
        'status', need.review_status,
        'tags', coalesce(tags.labels, array[]::text[])
      ) order by need.id)
      from public.participant_dietary_needs as need
      left join lateral (
        select array_agg(tag.label order by lower(tag.label), tag.id) as labels
        from public.dietary_need_tags as link
        join public.dietary_tags as tag
          on tag.organization_id = link.organization_id
         and tag.camp_id = link.camp_id
         and tag.id = link.dietary_tag_id
        where link.organization_id = need.organization_id
          and link.camp_id = need.camp_id
          and link.dietary_need_id = need.id
      ) as tags on true
      where need.organization_id = p_organization_id
        and need.camp_id = p_camp_id
    ), '[]'::jsonb),
    'meals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', meal.id,
        'starts_at', meal.starts_at,
        'meal_type', meal.meal_type,
        'title', meal.title,
        'status', meal.status,
        'copy_id', meal.camp_recipe_copy_id,
        'version_key', copy.version_key,
        'snapshot', copy.frozen_snapshot,
        'reserves', coalesce(reserves.rows, '[]'::jsonb)
      ) order by meal.starts_at, meal.id)
      from public.meals as meal
      left join public.camp_recipe_copies as copy
        on copy.organization_id = meal.organization_id
       and copy.camp_id = meal.camp_id
       and copy.id = meal.camp_recipe_copy_id
      left join lateral (
        select jsonb_agg(jsonb_build_object(
          'label', reserve.dietary_label,
          'portions', reserve.portions
        ) order by lower(reserve.dietary_label), reserve.id) as rows
        from public.meal_reserves as reserve
        where reserve.organization_id = meal.organization_id
          and reserve.camp_id = meal.camp_id
          and reserve.meal_id = meal.id
      ) as reserves on true
      where meal.organization_id = p_organization_id
        and meal.camp_id = p_camp_id
    ), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex');
$$;

revoke all on function public.camp_input_digest(uuid, uuid)
  from public, anon, authenticated;

-- Deployed calculations made with the previous digest definition must be
-- recalculated before a supply list can be generated or completed.
update public.calculation_revisions
set status = 'stale'
where status = 'current';

create unique index calculation_revisions_one_current_idx
  on public.calculation_revisions (organization_id, camp_id)
  where status = 'current';

create function public.mark_camp_calculation_stale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_camp_id uuid;
begin
  if tg_table_name = 'camps' and tg_op = 'DELETE' then
    target_organization_id := old.organization_id;
    target_camp_id := old.id;
  elsif tg_table_name = 'camps' then
    target_organization_id := new.organization_id;
    target_camp_id := new.id;
  elsif tg_op = 'DELETE' then
    target_organization_id := old.organization_id;
    target_camp_id := old.camp_id;
  else
    target_organization_id := new.organization_id;
    target_camp_id := new.camp_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':' || target_camp_id::text,
    0
  ));

  update public.calculation_revisions
  set status = 'stale'
  where organization_id = target_organization_id
    and camp_id = target_camp_id
    and status = 'current';

  return coalesce(new, old);
end;
$$;

revoke all on function public.mark_camp_calculation_stale()
  from public, anon, authenticated;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'camps',
    'camp_groups',
    'participants',
    'participant_attendance',
    'dietary_tags',
    'participant_dietary_needs',
    'dietary_need_tags',
    'camp_recipe_copies',
    'meals',
    'meal_reserves'
  ]
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.mark_camp_calculation_stale()',
      target_table || '_mark_calculation_stale',
      target_table
    );
  end loop;
end;
$$;

alter function public.calculate_camp(uuid, uuid)
  rename to calculate_camp_legacy;
revoke all on function public.calculate_camp_legacy(uuid, uuid)
  from public, anon, authenticated;

create function public.calculate_camp(
  p_organization_id uuid,
  p_camp_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  revision_id uuid;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'Camp not found' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_camp_id::text,
    0
  ));

  revision_id := public.calculate_camp_legacy(p_organization_id, p_camp_id);

  update public.calculation_revisions
  set status = 'superseded'
  where organization_id = p_organization_id
    and camp_id = p_camp_id
    and id <> revision_id
    and status <> 'superseded';

  update public.calculation_revisions
  set input_digest = public.camp_input_digest(p_organization_id, p_camp_id)
  where id = revision_id
    and organization_id = p_organization_id
    and camp_id = p_camp_id;

  return revision_id;
end;
$$;

revoke all on function public.calculate_camp(uuid, uuid) from public, anon;
grant execute on function public.calculate_camp(uuid, uuid) to authenticated;

create or replace function public.get_camp_readiness(
  p_organization_id uuid,
  p_camp_id uuid
)
returns table (
  unresolved_dietary_needs bigint,
  meals_without_recipe bigint,
  calculation_stale boolean,
  can_finalize boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with counts as (
    select
      (select count(*) from public.participant_dietary_needs as need
        where need.organization_id = p_organization_id
          and need.camp_id = p_camp_id
          and need.review_status <> 'resolved') as unresolved_dietary_needs,
      (select count(*) from public.meals as meal
        where meal.organization_id = p_organization_id
          and meal.camp_id = p_camp_id
          and meal.camp_recipe_copy_id is null) as meals_without_recipe,
      not exists (
        select 1 from public.calculation_revisions as revision
        where revision.organization_id = p_organization_id
          and revision.camp_id = p_camp_id
          and revision.status = 'current'
          and revision.input_digest = public.camp_input_digest(
            p_organization_id,
            p_camp_id
          )
      ) as calculation_stale
  )
  select
    counts.unresolved_dietary_needs,
    counts.meals_without_recipe,
    counts.calculation_stale,
    counts.unresolved_dietary_needs = 0
      and counts.meals_without_recipe = 0
      and not counts.calculation_stale
  from counts
  where public.is_org_member(p_organization_id)
    and exists (
      select 1 from public.camps as camp
      where camp.organization_id = p_organization_id
        and camp.id = p_camp_id
    );
$$;

alter function public.generate_supply_lists(uuid, uuid)
  rename to generate_supply_lists_legacy;
revoke all on function public.generate_supply_lists_legacy(uuid, uuid)
  from public, anon, authenticated;

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
  current_digest text;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'Camp not found' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_camp_id::text,
    0
  ));

  current_digest := public.camp_input_digest(p_organization_id, p_camp_id);
  if not exists (
    select 1
    from public.calculation_revisions as revision
    where revision.organization_id = p_organization_id
      and revision.camp_id = p_camp_id
      and revision.status = 'current'
      and revision.input_digest = current_digest
  ) then
    raise exception 'A current calculation revision is required'
      using errcode = '22023';
  end if;

  return public.generate_supply_lists_legacy(p_organization_id, p_camp_id);
end;
$$;

revoke all on function public.generate_supply_lists(uuid, uuid) from public, anon;
grant execute on function public.generate_supply_lists(uuid, uuid) to authenticated;

alter function public.set_supply_list_status(
  uuid, bigint, public.supply_list_status
) rename to set_supply_list_status_legacy;
revoke all on function public.set_supply_list_status_legacy(
  uuid, bigint, public.supply_list_status
) from public, anon, authenticated;

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
begin
  select list.*
  into target_list
  from public.supply_lists as list
  where list.id = p_list_id;

  if not found or not public.is_org_member(target_list.organization_id) then
    raise exception 'Supply list not found' using errcode = '42501';
  end if;

  if p_status = 'complete' and not exists (
    select 1
    from public.calculation_revisions as revision
    where revision.id = target_list.calculation_revision_id
      and revision.status = 'current'
      and revision.input_digest = public.camp_input_digest(
        target_list.organization_id,
        target_list.camp_id
      )
  ) then
    raise exception 'Supply lists cannot be completed from a stale calculation'
      using errcode = '22023';
  end if;

  return public.set_supply_list_status_legacy(
    p_list_id,
    p_expected_version,
    p_status
  );
end;
$$;

revoke all on function public.set_supply_list_status(
  uuid, bigint, public.supply_list_status
) from public, anon;
grant execute on function public.set_supply_list_status(
  uuid, bigint, public.supply_list_status
) to authenticated;

-- The three original validated write functions ran as the caller. Make them
-- owner-executed before removing direct table privileges.
alter function public.import_participant_batch(
  uuid, uuid, text, text, text, jsonb, text[], integer, integer, jsonb
) security definer;
alter function public.update_participant_details(
  uuid, text, text, text, text, numeric, timestamptz, timestamptz
) security definer;
alter function public.review_dietary_need(uuid, text[]) security definer;

-- Browser roles may read tenant data through RLS but can only write through the
-- explicitly granted RPC surface above.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from authenticated, anon;
revoke usage, select, update
  on all sequences in schema public from authenticated, anon;
grant select on all tables in schema public to authenticated;

alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger
  on tables from authenticated, anon;
alter default privileges in schema public
  revoke usage, select, update on sequences from authenticated, anon;

-- The Edge Function uses the service role for this bounded invitation write and
-- compensating delete. No browser key receives these grants.
grant insert, delete on table public.organization_invitations to service_role;
-- The hosted bootstrap CLI uses these two reads only to make retries explicit
-- and fail closed when a project already contains a different tenant.
grant select on table public.organizations, public.organization_memberships
  to service_role;
