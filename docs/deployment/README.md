# Hosted deployment

Lägermat is deployed from one verified Git revision into two fixed, isolated hosted environments:

| Tier | Netlify | Supabase | Data |
| --- | --- | --- | --- |
| Local | Vite on loopback | Local CLI/Docker | Development seeds |
| Staging | One stable Netlify site | Separate Free project | Synthetic camp data plus temporary public ICA catalogue rows |
| Production | One custom-domain Netlify site | Pro project in North EU (Stockholm) | Approved pilot data |

No deploy preview is allowed to use either hosted database. Netlify receives only a Supabase publishable key. Supabase server credentials, database passwords, SMTP credentials and the Netlify token stay in protected GitHub environments.

## Repository automation

- `Verify` runs repository secret/hygiene checks, type checking, lint, unit tests, a hosted build inspection, a clean local database, database lint, pgTAP, generated-type drift detection, and desktop/mobile Playwright tests.
- `Deploy hosted` starts only after a successful `Verify` run for a push to `main`.
- The exact verified commit is deployed to staging first. Production depends on successful staging and pauses at the protected `production` GitHub environment.
- Supabase migrations are dry-run and then applied without `--include-seed`; Auth/SMTP configuration and Edge Functions follow. Netlify is deployed only after the backend is ready.
- The hosted build generates an exact-origin CSP and cache policy, rejects local/test configuration and scans for server credentials. Non-destructive HTTP smoke tests run after each deploy.

Provider setup is intentionally not automated from an untrusted workstation.
Follow [provisioning.md](provisioning.md), then use [release.md](release.md) for
each release and [operations.md](operations.md) for routine monitoring.
The synthetic public-demo data, temporary tenant-scoped ICA catalogue rows and
their exact 24-hour lifecycle are described in
[demo-fixture.md](demo-fixture.md). The strict staging/production mode,
Turnstile, email and static-Netlify boundary is specified in
[demo-environments.md](demo-environments.md). Production remains blocked until
[privacy-gate.md](privacy-gate.md) and the approvals in
[recipe-catalogue.md](recipe-catalogue.md) are signed off. Recovery is
described in [restore.md](restore.md).

The reviewed hosted database-adviser baseline is recorded in
[advisors.md](advisors.md); new security findings or unindexed foreign keys block
a release.

## Immutable boundaries

- Never add a service-role/secret key to `VITE_*`, Netlify, browser storage or a generated bundle.
- Never deploy `supabase/seed.sql` or `supabase/seed/**` to production.
- Never put real participant, dietary, supplier, price or stock data in the canonical demo fixture.
- Never persist real staging data beyond temporary public ICA catalogue rows
  isolated to an expiring demo organisation.
- Never point staging, branch builds or local tests at production Supabase.
- Never give production `DEMO_MODE=true`, a Turnstile key or anonymous Auth.
- Never deploy the public demo without the explicit empty Netlify Functions
  directory documented in [demo-environments.md](demo-environments.md).
- Never restore or roll back the production database merely to undo a frontend fault.
- Never enter real participant or dietary information before the privacy gate is approved.

Reference documentation: [Netlify Vite](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/), [Netlify file configuration](https://docs.netlify.com/build/configure-builds/file-based-configuration/), [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod), [Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations), and [Supabase backups](https://supabase.com/docs/guides/platform/backups).
