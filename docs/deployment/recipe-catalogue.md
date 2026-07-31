# Hosted recipe catalogue

Production bootstrap installs the versioned catalogue from
`20260720230000_recipe_template_catalogue.sql` and applies the curated physical
measurement correction in
`20260730173725_enforce_recipe_measurement_units.sql`: 25 recipes and 238
ingredient components. Its aggregate catalogue digest is
`7ee4ba470ba34bd626bb9391746430a3ad8b6126c717e5485b939228f06725fd`.
The bootstrap audit event records that digest and both row counts.

The migration is generated deterministically from the locally held workbook by
`pnpm recipes:seed`. Generation refuses a different workbook SHA-256 or row
count. The workbook and generated development seed are ignored by Git and are
never loaded by hosted migrations.

The hosted output removes source rows, workbook metadata, development users and
organisations, source-import copy, and product brands. Legacy package hints are
curated into mass, volume, or count before bootstrap; guessed spare packages
and undefined pantry reminders are removed. Retail packaging is introduced
only by a selected supplier product. Browser roles have no access to the
`app_private` template schema.

Before the first production bootstrap, record two approvals in the release
evidence:

1. The data/content owner confirms that the organisation may use the recipe
   source for the pilot.
2. A designated food lead reviews amounts, units and dietary labels. The
   catalogue supports planning and does not replace individual allergy checks.

Any catalogue change requires a new migration, a new aggregate digest, updated
pgTAP expectations and a new pair of approvals. Never edit a migration that has
already reached a hosted environment.
