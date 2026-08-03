# Release runbook

## Before merge

- Confirm migrations are expand/contract compatible with the previously cached PWA and do not require a destructive rollback.
- Confirm the generated database types are committed with their migration and all `Verify` jobs pass freshly.
- Confirm staging contains synthetic data only and production configuration contains no development seed.
- For the first real-data release, attach the approved [privacy gate](privacy-gate.md) and [recipe-catalogue approvals](recipe-catalogue.md).

## Automated sequence

1. Merge the reviewed revision to protected `main`.
2. `Verify` rebuilds and tests the exact commit.
3. `Deploy hosted` dry-runs and applies Supabase staging migrations, pushes Auth/SMTP configuration, sets the exact Edge Function origin and deploys all versioned functions.
4. For staging, the generated configuration enables anonymous
   Turnstile-protected Auth, disables email/SMTP and gates invitations. The
   same commit is built and inspected in demo mode.
5. The fixed Netlify staging site is uploaded only as a static artefact with
   `--dir=dist --functions=.tmp/netlify-static-functions --no-build`.
   Non-destructive smoke tests check the SPA fallback, mode-specific CSP,
   security/cache headers, hashed assets, Auth provider state and zero
   functions.
6. The production job waits for the `production` environment reviewer. The reviewer confirms a visible recent backup, provider status, approved privacy state and the staging result.
7. Production is built with both demo switches false, no Turnstile values,
   anonymous Auth off and private email/SMTP on.

The protected deploy workflow implements this environment split and validates
all provider values before mutation. Do not “fix forward” by supplying missing
values interactively: correct the protected environment configuration and
rerun the exact verified revision instead.

The workflow must never be edited to pass `--include-seed`. If a migration dry-run is unexpected, reject the production approval and fix it in a new commit.

## Human smoke test

Use dedicated pilot test identities and do not create dietary or participant fixtures in production.

- Sign in as an administrator, enrol/verify TOTP, and confirm protected administration requires AAL2.
- Invite a planner and complete the magic-link flow from the exact production domain.
- Confirm a wrong-email, expired or reused invitation is rejected.
- Open a direct application route on desktop and mobile and install the PWA.
- Make a harmless, reversible planner change in the designated pilot camp; confirm calculation staleness and audit behaviour, then restore the approved value through the application.
- Confirm sign-out resolves queued offline changes and clears user-scoped cached data.

Record the release SHA, workflow URLs, smoke-test operator and result in the operations log.

## Failure and rollback

- **Before a migration is applied:** stop; no state changed. Fix the migration and release a new commit.
- **After a compatible migration but before Netlify:** leave the additive schema in place, fix forward, and rerun the same verified release. Do not deploy an older frontend that is not compatible.
- **Frontend-only regression:** use Netlify rollback only when the target frontend is compatible with the current database. Follow immediately with a normal verified release.
- **Database correctness or data-loss incident:** disable writes if needed, preserve logs, notify the data controller, and follow [restore.md](restore.md). Never improvise a reverse migration on production.

Provider console changes made during an incident must be documented and reconciled back into versioned configuration.
