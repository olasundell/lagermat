create extension if not exists pgcrypto with schema extensions;

create type public.organization_role as enum ('admin', 'planner');
create type public.membership_status as enum ('active', 'suspended');
create type public.camp_status as enum ('draft', 'active', 'archived');
create type public.group_kind as enum ('division', 'patrol', 'meal_group');
create type public.dietary_review_status as enum ('unreviewed', 'reviewed', 'resolved');
create type public.import_status as enum ('draft', 'validated', 'imported', 'rejected');
create type public.recipe_status as enum ('draft', 'published', 'retired');
create type public.ingredient_mode as enum ('weighted_portion', 'head', 'fixed_once_per_camp');
create type public.dietary_rule as enum ('standard', 'exclude', 'only');
create type public.meal_status as enum ('draft', 'ready', 'blocked');
create type public.calculation_status as enum ('current', 'stale', 'superseded');
create type public.supply_list_kind as enum ('purchase', 'distribution', 'delivery');
create type public.supply_list_status as enum ('draft', 'active', 'complete');

create table public.organizations (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, created_by)
);

create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null default 'planner',
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.organization_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(trim(email)) and position('@' in email) > 1),
  role public.organization_role not null default 'planner',
  token_hash text not null unique check (length(token_hash) >= 32),
  invited_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (accepted_at is null or accepted_at >= created_at)
);

create table public.camps (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 160),
  starts_on date not null,
  ends_on date not null,
  timezone text not null default 'Europe/Stockholm',
  status public.camp_status not null default 'draft',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (organization_id, id)
);

create table public.camp_groups (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  parent_group_id uuid,
  kind public.group_kind not null,
  name text not null check (length(trim(name)) between 1 and 120),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, camp_id, id),
  constraint camp_groups_camp_fk foreign key (organization_id, camp_id)
    references public.camps (organization_id, id) on delete cascade,
  constraint camp_groups_parent_fk foreign key (organization_id, camp_id, parent_group_id)
    references public.camp_groups (organization_id, camp_id, id) on delete cascade
);

create table public.participants (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  display_name text not null check (length(trim(display_name)) between 1 and 160),
  division_id uuid,
  patrol_id uuid,
  meal_group_id uuid,
  food_factor numeric(8,4) not null default 1 check (food_factor between 0 and 10),
  source_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, camp_id, id),
  constraint participants_camp_fk foreign key (organization_id, camp_id)
    references public.camps (organization_id, id) on delete cascade,
  constraint participants_division_fk foreign key (organization_id, camp_id, division_id)
    references public.camp_groups (organization_id, camp_id, id) on delete set null,
  constraint participants_patrol_fk foreign key (organization_id, camp_id, patrol_id)
    references public.camp_groups (organization_id, camp_id, id) on delete set null,
  constraint participants_meal_group_fk foreign key (organization_id, camp_id, meal_group_id)
    references public.camp_groups (organization_id, camp_id, id) on delete set null
);

create table public.participant_attendance (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  participant_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  constraint participant_attendance_participant_fk foreign key (organization_id, camp_id, participant_id)
    references public.participants (organization_id, camp_id, id) on delete cascade
);

create table public.dietary_tags (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  label text not null check (length(trim(label)) between 1 and 80),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, camp_id, id),
  unique (organization_id, camp_id, label),
  constraint dietary_tags_camp_fk foreign key (organization_id, camp_id)
    references public.camps (organization_id, id) on delete cascade
);

create table public.participant_dietary_needs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  participant_id uuid not null,
  raw_food_note text,
  review_status public.dietary_review_status not null default 'unreviewed',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, camp_id, id),
  check ((reviewed_at is null) = (reviewed_by is null)),
  constraint participant_dietary_needs_participant_fk foreign key (organization_id, camp_id, participant_id)
    references public.participants (organization_id, camp_id, id) on delete cascade
);

create table public.dietary_need_tags (
  organization_id uuid not null,
  camp_id uuid not null,
  dietary_need_id uuid not null,
  dietary_tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, camp_id, dietary_need_id, dietary_tag_id),
  constraint dietary_need_tags_need_fk foreign key (organization_id, camp_id, dietary_need_id)
    references public.participant_dietary_needs (organization_id, camp_id, id) on delete cascade,
  constraint dietary_need_tags_tag_fk foreign key (organization_id, camp_id, dietary_tag_id)
    references public.dietary_tags (organization_id, camp_id, id) on delete cascade
);

create table public.import_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  source_filename text not null,
  source_kind text not null check (source_kind in ('xlsx', 'csv')),
  column_mapping jsonb not null default '{}'::jsonb,
  validation_summary jsonb not null default '{}'::jsonb,
  status public.import_status not null default 'draft',
  imported_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint import_batches_camp_fk foreign key (organization_id, camp_id)
    references public.camps (organization_id, id) on delete cascade
);

create table public.recipes (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 180),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.recipe_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  recipe_id uuid not null,
  version_number integer not null check (version_number > 0),
  status public.recipe_status not null default 'draft',
  instructions text,
  portion_size numeric(16,6) check (portion_size is null or portion_size > 0),
  content_digest text not null check (length(content_digest) >= 32),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, recipe_id, version_number),
  constraint recipe_versions_recipe_fk foreign key (organization_id, recipe_id)
    references public.recipes (organization_id, id) on delete cascade
);

create table public.recipe_ingredients (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  recipe_version_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 160),
  unit text not null check (length(trim(unit)) between 1 and 30),
  amount numeric(20,6) not null check (amount >= 0),
  mode public.ingredient_mode not null,
  dietary_rule public.dietary_rule not null default 'standard',
  dietary_tag_label text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint recipe_ingredients_version_fk foreign key (organization_id, recipe_version_id)
    references public.recipe_versions (organization_id, id) on delete cascade
);

create table public.camp_recipe_copies (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  source_recipe_version_id uuid not null,
  name text not null,
  version_key text not null,
  frozen_snapshot jsonb not null,
  copied_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, camp_id, id),
  unique (organization_id, camp_id, version_key),
  constraint camp_recipe_copies_camp_fk foreign key (organization_id, camp_id)
    references public.camps (organization_id, id) on delete cascade,
  constraint camp_recipe_copies_version_fk foreign key (organization_id, source_recipe_version_id)
    references public.recipe_versions (organization_id, id) on delete restrict
);

create table public.meals (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  camp_recipe_copy_id uuid,
  starts_at timestamptz not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'evening', 'other')),
  title text not null,
  status public.meal_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, camp_id, id),
  constraint meals_camp_fk foreign key (organization_id, camp_id)
    references public.camps (organization_id, id) on delete cascade,
  constraint meals_recipe_copy_fk foreign key (organization_id, camp_id, camp_recipe_copy_id)
    references public.camp_recipe_copies (organization_id, camp_id, id) on delete restrict
);

create table public.meal_reserves (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  meal_id uuid not null,
  dietary_label text not null,
  portions integer not null check (portions >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meal_reserves_meal_fk foreign key (organization_id, camp_id, meal_id)
    references public.meals (organization_id, camp_id, id) on delete cascade
);

create table public.calculation_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  status public.calculation_status not null default 'current',
  input_digest text not null check (length(input_digest) >= 32),
  problem_summary jsonb not null default '{}'::jsonb,
  calculated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, camp_id, id),
  unique (organization_id, camp_id, revision_number),
  constraint calculation_revisions_camp_fk foreign key (organization_id, camp_id)
    references public.camps (organization_id, id) on delete cascade
);

create table public.calculation_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  calculation_revision_id uuid not null,
  meal_id uuid not null,
  ingredient_name text not null,
  exact_amount numeric(20,6) not null check (exact_amount >= 0),
  unit text not null,
  trace jsonb not null,
  created_at timestamptz not null default now(),
  constraint calculation_lines_revision_fk foreign key (organization_id, camp_id, calculation_revision_id)
    references public.calculation_revisions (organization_id, camp_id, id) on delete cascade,
  constraint calculation_lines_meal_fk foreign key (organization_id, camp_id, meal_id)
    references public.meals (organization_id, camp_id, id) on delete cascade
);

create table public.supply_lists (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  calculation_revision_id uuid not null,
  meal_group_id uuid,
  kind public.supply_list_kind not null,
  status public.supply_list_status not null default 'draft',
  title text not null,
  range_start timestamptz,
  range_end timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, camp_id, id),
  check (range_end is null or range_start is null or range_end > range_start),
  constraint supply_lists_revision_fk foreign key (organization_id, camp_id, calculation_revision_id)
    references public.calculation_revisions (organization_id, camp_id, id) on delete restrict,
  constraint supply_lists_meal_group_fk foreign key (organization_id, camp_id, meal_group_id)
    references public.camp_groups (organization_id, camp_id, id) on delete set null
);

create table public.supply_list_items (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  camp_id uuid not null,
  supply_list_id uuid not null,
  category text not null,
  item_name text not null,
  required_amount numeric(20,6) not null check (required_amount >= 0),
  required_unit text not null,
  ordered_amount numeric(20,6) check (ordered_amount is null or ordered_amount >= 0),
  ordered_unit text,
  package_note text,
  comment text,
  completed boolean not null default false,
  row_version bigint not null default 1 check (row_version > 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supply_list_items_list_fk foreign key (organization_id, camp_id, supply_list_id)
    references public.supply_lists (organization_id, camp_id, id) on delete cascade
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index organization_memberships_user_idx on public.organization_memberships (user_id, organization_id) where status = 'active';
create index organization_invitations_org_email_idx on public.organization_invitations (organization_id, email);
create index camps_org_idx on public.camps (organization_id);
create index camp_groups_org_camp_idx on public.camp_groups (organization_id, camp_id);
create index participants_org_camp_idx on public.participants (organization_id, camp_id);
create index participant_attendance_org_participant_idx on public.participant_attendance (organization_id, participant_id);
create index participant_dietary_needs_org_participant_idx on public.participant_dietary_needs (organization_id, participant_id);
create index import_batches_org_camp_idx on public.import_batches (organization_id, camp_id);
create index recipes_org_idx on public.recipes (organization_id);
create index recipe_versions_org_recipe_idx on public.recipe_versions (organization_id, recipe_id);
create index recipe_ingredients_org_version_idx on public.recipe_ingredients (organization_id, recipe_version_id);
create index meals_org_camp_starts_idx on public.meals (organization_id, camp_id, starts_at);
create index calculation_revisions_org_camp_idx on public.calculation_revisions (organization_id, camp_id);
create index calculation_lines_org_revision_idx on public.calculation_lines (organization_id, calculation_revision_id);
create index supply_lists_org_camp_idx on public.supply_lists (organization_id, camp_id);
create index supply_list_items_org_list_idx on public.supply_list_items (organization_id, supply_list_id);
create index audit_events_org_created_idx on public.audit_events (organization_id, created_at desc);

create function public.is_org_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
    );
$$;

create function public.is_org_admin(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and membership.role = 'admin'
    );
$$;

create function public.add_organization_creator_as_admin()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (new.id, new.created_by, 'admin', 'active');
  return new;
end;
$$;

create trigger organizations_add_creator after insert on public.organizations
for each row execute function public.add_organization_creator_as_admin();

create function public.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger organization_memberships_set_updated_at before update on public.organization_memberships for each row execute function public.set_updated_at();
create trigger camps_set_updated_at before update on public.camps for each row execute function public.set_updated_at();
create trigger camp_groups_set_updated_at before update on public.camp_groups for each row execute function public.set_updated_at();
create trigger participants_set_updated_at before update on public.participants for each row execute function public.set_updated_at();
create trigger participant_attendance_set_updated_at before update on public.participant_attendance for each row execute function public.set_updated_at();
create trigger dietary_tags_set_updated_at before update on public.dietary_tags for each row execute function public.set_updated_at();
create trigger participant_dietary_needs_set_updated_at before update on public.participant_dietary_needs for each row execute function public.set_updated_at();
create trigger recipes_set_updated_at before update on public.recipes for each row execute function public.set_updated_at();
create trigger meals_set_updated_at before update on public.meals for each row execute function public.set_updated_at();
create trigger meal_reserves_set_updated_at before update on public.meal_reserves for each row execute function public.set_updated_at();
create trigger supply_lists_set_updated_at before update on public.supply_lists for each row execute function public.set_updated_at();
create trigger supply_list_items_set_updated_at before update on public.supply_list_items for each row execute function public.set_updated_at();

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.camps enable row level security;
alter table public.camp_groups enable row level security;
alter table public.participants enable row level security;
alter table public.participant_attendance enable row level security;
alter table public.dietary_tags enable row level security;
alter table public.participant_dietary_needs enable row level security;
alter table public.dietary_need_tags enable row level security;
alter table public.import_batches enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_versions enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.camp_recipe_copies enable row level security;
alter table public.meals enable row level security;
alter table public.meal_reserves enable row level security;
alter table public.calculation_revisions enable row level security;
alter table public.calculation_lines enable row level security;
alter table public.supply_lists enable row level security;
alter table public.supply_list_items enable row level security;
alter table public.audit_events enable row level security;

create policy organizations_select on public.organizations for select to authenticated using (public.is_org_member(id));
create policy organizations_insert on public.organizations for insert to authenticated
  with check ((select auth.uid()) is not null and created_by = (select auth.uid()));
create policy organizations_update on public.organizations for update to authenticated
  using (public.is_org_admin(id)) with check (public.is_org_admin(id));
create policy organizations_delete on public.organizations for delete to authenticated using (public.is_org_admin(id));

create policy memberships_select on public.organization_memberships for select to authenticated
  using (public.is_org_member(organization_id));
create policy memberships_insert on public.organization_memberships for insert to authenticated
  with check (public.is_org_admin(organization_id));
create policy memberships_update on public.organization_memberships for update to authenticated
  using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy memberships_delete on public.organization_memberships for delete to authenticated
  using (public.is_org_admin(organization_id));

create policy invitations_admin_access on public.organization_invitations for all to authenticated
  using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

do $$
declare target_table text;
begin
  foreach target_table in array array[
    'camps', 'camp_groups', 'participants', 'participant_attendance',
    'dietary_tags', 'participant_dietary_needs', 'dietary_need_tags', 'import_batches',
    'recipes', 'recipe_versions', 'recipe_ingredients', 'camp_recipe_copies',
    'meals', 'meal_reserves', 'calculation_revisions', 'calculation_lines',
    'supply_lists', 'supply_list_items'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id))',
      target_table || '_member_access',
      target_table
    );
  end loop;
end;
$$;

create policy audit_events_select on public.audit_events for select to authenticated
  using (public.is_org_admin(organization_id));
create policy audit_events_insert on public.audit_events for insert to authenticated
  with check (public.is_org_member(organization_id) and actor_user_id = (select auth.uid()));

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.is_org_admin(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;
revoke all on function public.add_organization_creator_as_admin() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
