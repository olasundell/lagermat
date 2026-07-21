# Hosted recipe catalogue

Production bootstrap installs the versioned catalogue from
`20260720230000_recipe_template_catalogue.sql`: 25 recipes and 245 ingredient
components. Its aggregate catalogue digest is
`9b1463da23eab396f3b8ae3946f7374be8698464b226bc145e6a433b1c204068`.
The bootstrap audit event records that digest and both row counts.

The migration is generated deterministically from the locally held workbook by
`pnpm recipes:seed`. Generation refuses a different workbook SHA-256 or row
count. The workbook and generated development seed are ignored by Git and are
never loaded by hosted migrations.

The hosted output removes source rows, workbook metadata, development users and
organizations, source-import copy, and product brands. Ingredient modes,
amounts, dietary rules and useful preparation comments are retained. Browser
roles have no access to the `app_private` template schema.

Before the first production bootstrap, record two approvals in the release
evidence:

1. The data/content owner confirms that the organisation may use the recipe
   source for the pilot.
2. A designated food lead reviews amounts, units and dietary labels. The
   catalogue supports planning and does not replace individual allergy checks.

Any catalogue change requires a new migration, a new aggregate digest, updated
pgTAP expectations and a new pair of approvals. Never edit a migration that has
already reached a hosted environment.
