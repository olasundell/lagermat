-- Defence in depth for non-API deployment data and covering indexes for every
-- foreign key. The private tables remain inaccessible to browser roles, while
-- the owner-executed bootstrap function can still clone the catalogue.

alter table app_private.recipe_templates enable row level security;
alter table app_private.recipe_ingredient_templates enable row level security;

revoke all on table
  app_private.recipe_templates,
  app_private.recipe_ingredient_templates
from public, anon, authenticated;

alter default privileges in schema app_private
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema app_private
  revoke all on sequences from public, anon, authenticated;

-- Reading the JWT assurance claim needs no owner privileges. Keeping this
-- function as an invoker function removes an unnecessary SECURITY DEFINER
-- entry point while preserving its use in policies and administrator RPCs.
alter function public.current_authentication_assurance_level() security invoker;

create index audit_events_actor_user_id_fkey_idx
  on public.audit_events (actor_user_id);
create index calculation_lines_copy_fk_idx
  on public.calculation_lines (organization_id, camp_id, camp_recipe_copy_id);
create index calculation_lines_meal_fk_idx
  on public.calculation_lines (organization_id, camp_id, meal_id);
create index calculation_revisions_calculated_by_fkey_idx
  on public.calculation_revisions (calculated_by);
create index camp_groups_parent_fk_idx
  on public.camp_groups (organization_id, camp_id, parent_group_id);
create index camp_recipe_copies_copied_by_fkey_idx
  on public.camp_recipe_copies (copied_by);
create index camp_recipe_copies_version_fk_idx
  on public.camp_recipe_copies (organization_id, source_recipe_version_id);
create index camps_created_by_fkey_idx
  on public.camps (created_by);
create index dietary_need_tags_tag_fk_idx
  on public.dietary_need_tags (organization_id, camp_id, dietary_tag_id);
create index import_batches_imported_by_fkey_idx
  on public.import_batches (imported_by);
create index meal_reserves_meal_fk_idx
  on public.meal_reserves (organization_id, camp_id, meal_id);
create index meals_recipe_copy_fk_idx
  on public.meals (organization_id, camp_id, camp_recipe_copy_id);
create index organization_invitations_accepted_by_fkey_idx
  on public.organization_invitations (accepted_by);
create index organization_invitations_invited_by_fkey_idx
  on public.organization_invitations (invited_by);
create index organization_memberships_user_id_fkey_idx
  on public.organization_memberships (user_id);
create index organizations_created_by_fkey_idx
  on public.organizations (created_by);
create index participant_attendance_participant_fk_idx
  on public.participant_attendance (organization_id, camp_id, participant_id);
create index participant_dietary_needs_participant_fk_idx
  on public.participant_dietary_needs (organization_id, camp_id, participant_id);
create index participant_dietary_needs_reviewed_by_fkey_idx
  on public.participant_dietary_needs (reviewed_by);
create index participants_division_fk_idx
  on public.participants (organization_id, camp_id, division_id);
create index participants_meal_group_fk_idx
  on public.participants (organization_id, camp_id, meal_group_id);
create index participants_patrol_fk_idx
  on public.participants (organization_id, camp_id, patrol_id);
create index recipe_versions_created_by_fkey_idx
  on public.recipe_versions (created_by);
create index recipes_created_by_fkey_idx
  on public.recipes (created_by);
create index supply_item_mutations_actor_user_id_fkey_idx
  on public.supply_item_mutations (actor_user_id);
create index supply_item_mutations_item_id_fkey_idx
  on public.supply_item_mutations (item_id);
create index supply_list_items_list_fk_idx
  on public.supply_list_items (organization_id, camp_id, supply_list_id);
create index supply_list_items_updated_by_fkey_idx
  on public.supply_list_items (updated_by);
create index supply_lists_meal_group_fk_idx
  on public.supply_lists (organization_id, camp_id, meal_group_id);
create index supply_lists_revision_fk_idx
  on public.supply_lists (organization_id, camp_id, calculation_revision_id);
