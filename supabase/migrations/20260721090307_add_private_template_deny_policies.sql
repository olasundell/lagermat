-- RLS is deny-by-default without policies, but explicit restrictive policies
-- make the private catalogue boundary auditable and keep hosted advisers from
-- treating the intentional denial as an incomplete configuration.

create policy recipe_templates_browser_deny
  on app_private.recipe_templates
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy recipe_ingredient_templates_browser_deny
  on app_private.recipe_ingredient_templates
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
