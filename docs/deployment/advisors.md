# Supabase adviser baseline

Run the hosted security and performance advisers after every database migration.
The release is blocked by any new security finding or any unindexed application
foreign key.

## Accepted security notices

The browser write boundary deliberately exposes 18 `SECURITY DEFINER` functions
to `authenticated`. Supabase therefore reports
`authenticated_security_definer_function_executable` for these RPCs:

- `accept_organization_invitation`
- `apply_supply_item_mutation`
- `calculate_camp`
- `change_member_role`
- `freeze_recipe_version`
- `generate_supply_lists`
- `get_camp_readiness`
- `import_participant_batch`
- `is_org_admin`
- `is_org_member`
- `list_organization_members`
- `move_delivery_item`
- `review_dietary_need`
- `save_meal`
- `set_supply_list_status`
- `switch_meal_recipe_version`
- `update_participant_details`
- `update_supply_item`

These notices are expected only while the functions retain an empty search path,
explicit browser grants, tenant and role checks, input validation and pgTAP
coverage. A new function in this adviser category requires security review before
release. See the [Supabase linter guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Performance notices

Fresh staging reports indexes as unused because it has no workload. Do not remove
them on that evidence. Reassess unused indexes only from production query and
index statistics after the pilot has representative traffic. The unindexed
foreign-key adviser count must remain zero.
