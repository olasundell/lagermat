# Demo environment boundary

The public demo is an explicitly staging-only mode. Production remains the
private, invitation-based application. A missing, malformed or contradictory
mode must stop the build or config-generation step; it must never fall back to
an anonymous public application.

## Enforced contract

| Setting | Staging | Production |
| --- | --- | --- |
| `DEMO_MODE` | `true` | `false` |
| `VITE_DEMO_MODE` | `true` | `false` |
| `VITE_TURNSTILE_SITE_KEY` | Required public site key | Must be absent |
| `TURNSTILE_SECRET_KEY` | Required protected server secret | Must be absent |
| Anonymous Supabase Auth | Enabled | Disabled |
| Email Auth provider | Disabled | Enabled |
| SMTP/Resend | Must be absent | Required |
| `invite-member` | Disabled by config and server gate | Enabled |
| `start-demo` | Enabled and server-gated | Disabled by config and server gate |
| `ica-catalogue` | Enabled, authenticated and exact-origin gated | Disabled by config and server gate |
| Camp and participant data | Canonical synthetic fixture only | No demo seed |
| Supplier data | Temporary real ICA public-catalogue results, isolated to the demo organisation | Approved production data only |
| Netlify domain | Fixed `netlify.app` staging URL | Separately approved private origin |

`scripts/hosted-environment.mjs` is the single renderer and validator for this
contract. `scripts/verify-hosted-environment-boundaries.mjs` exercises both
positive configurations and the fail-closed cases in CI. The staging CSP adds
only `https://challenges.cloudflare.com` to `script-src`, `frame-src` and
`connect-src`; production retains `frame-src 'none'` and no Turnstile origin.

The generated staging Supabase configuration disables both the email provider
and custom SMTP. It enables anonymous sign-in behind Turnstile and uses the
server secret only through `env(TURNSTILE_SECRET_KEY)`. The production
configuration does the inverse and removes the Turnstile secret reference.
The demo and ICA Edge Functions also check server-side `DEMO_MODE`, so stale
function deployments fail closed. `ica-catalogue` is enabled only in the
rendered staging configuration. Its platform-neutral shared code is included
in both self-contained Supabase build workdirs so older CLI bundlers can
resolve the complete source graph, but the production renderer sets the
function itself to `enabled = false`.

The demo's camps, participants, attendance and dietary data remain synthetic.
An authenticated planner action may fetch real product names, package data and
prices from ICA's public catalogue. Those rows are stored only inside the
caller's isolated demo organisation, become inaccessible when the instance
expires after 24 hours and are physically removed by the next hourly cleanup.
They are runtime supplier data, not part of the canonical fixture.

The demo login page contains no email form or invitation path. Production
contains no demo action. This is a build-time boundary backed by a separate
server-side boundary; neither trusts the other.

## Static Netlify boundary

The demo backend consists of the authenticated Supabase Edge Functions
`start-demo` and, in staging only, `ica-catalogue`. Neither adds a Netlify
Function or gives Netlify a Supabase server secret.

The repository also contains two supplier-only Netlify Functions added after
the demo architecture was approved. They remain useful for local supplier
development, but they must not hitchhike into the public demo. Hosted ICA
search uses the separate Supabase Edge Function instead.
Netlify CLI resolves the configured function directory even when `--dir=dist`
is provided. `scripts/build-netlify.mjs` therefore creates an explicitly empty
`.tmp/netlify-static-functions` directory. A future approved demo deployment
must use all three flags:

```text
--dir=dist --functions=.tmp/netlify-static-functions --no-build
```

The protected deploy workflow now maps the environment-scoped `DEMO_MODE` to
both the server and client build, maps the staging-only Turnstile site key and
secret to their separate public/protected contexts, and sets the generated
Edge Function environment through a temporary mode-0600 file that is removed
immediately after use. Netlify receives the already verified static artefact
with the explicit empty `--functions` directory and `--no-build`.

Before setting the allowed Edge Function secret, the workflow removes the
mode-forbidden counterpart: Scoutnet's source-reference secret from staging or
Turnstile's secret from production. A failed removal stops the release, so a
stale secret cannot silently cross the staging/production boundary.

The workflow remains fail-closed when any environment value is absent or
contradictory. Staging must not define SMTP or the Scoutnet HMAC secret;
production must not define Turnstile values and still requires its private
SMTP and Scoutnet configuration.

## Provider status, verified 2026-08-04

This is a time-labelled snapshot, not standing deployment approval. It was
assembled from the Netlify and Supabase provider APIs, GitHub Actions metadata
and non-destructive public HTTP checks between 12:28 and 12:46 UTC.

| Surface | Verified state |
| --- | --- |
| Source revision | `origin/main` and the deployed artefact identify `c4f64600ff91261a492423c16da6ac444b13f7d1`. GitHub Verify run `30906238514` passed on that revision. |
| Protected release | Deploy hosted run `30906612675`, staging job `91983063332`, completed successfully. Its production job was still waiting for approval with no steps run; production was not changed. |
| Netlify staging | `https://lagermat-staging.netlify.app`, site `295e743b-3276-4a4f-9171-c7b51cafece6`, serves ready deploy `6a71d2ab2ad71328179f3429`, published 2026-08-04 11:53:16 UTC and titled with the exact source revision. Netlify reports no Functions and no Edge Functions. |
| Supabase staging | Project `datiqfdwpalnuttfkthf` in `eu-north-1` is `ACTIVE_HEALTHY` on Postgres 17.6. Migrations are applied through `20260731114649_ica_catalogue_publish_authority.sql`. `start-demo` version 9 and `ica-catalogue` version 3 are active and JWT-verifying. |
| Public boundary | `/auth/callback` returns 200 with CSP limited to the exact Supabase project and Turnstile origins. `start-demo` returns 204 with the exact staging origin and 403 without an allow-origin header for an unapproved origin. |
| Protected configuration | The GitHub staging environment contains the expected protected names `NETLIFY_AUTH_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PUBLISHABLE_KEY` and `TURNSTILE_SECRET_KEY`. Its variable names include `APP_ORIGIN`, `DEMO_MODE`, `NETLIFY_SITE_ID`, `SUPABASE_PROJECT_REF` and `TURNSTILE_SITE_KEY`. No SMTP or Scoutnet secret is present. Values were not read or recorded. |

The successful staging job also records that protected configuration
validation, migration dry-run and apply, Auth configuration, secret staging,
Edge Function deployment, static build inspection and hosted smoke all passed
on the same revision. Public HTTP checks cannot reveal secret values and must
not be presented as proof that a secret value is correct.

## Lifecycle, capacity and recovery

Each anonymous user can have at most one active entry in the private demo
instance registry. `start` reuses that entry and `reset` replaces only that
user's organisation and camp. Each instance expires exactly 24 hours after it
is created. The active provider Cron job `lagermat-demo-cleanup-hourly` runs at
`0 * * * *`; at 12:00 UTC on 2026-08-04 its latest run had succeeded. Cleanup
deletes expired demo organisations and their tenant graph before removing the
corresponding anonymous Auth users, including eligible orphans. See
[`demo-fixture.md`](./demo-fixture.md) for the data contract and
[`operations.md`](./operations.md) for monitoring and incident thresholds.

Supabase documents a default IP-based anonymous-sign-in rate limit of 30
requests per hour. This snapshot did not read the project's configured rate,
so the provider setting must be checked before any traffic increase. The
application additionally bounds request bodies and enforces one active
instance per anonymous user. There is no separate application-level global
concurrent-demo quota. Provider capacity and Auth rates must not be inferred
from a successful smoke test.

If a client sees an expired or missing instance, it must discard the old
workspace selection and return to the demo start flow. It must never revive or
extend the old tenant. A compatible frontend-only fault can be rolled back to
an earlier verified Netlify deploy; database changes remain forward-only and
must use a compensating migration. The complete release and rollback order is
in [`release.md`](./release.md).

## Browser acceptance and Turnstile

The guided introduction has a separate, canonical local demo profile. It uses
Cloudflare's published always-pass test credentials only on loopback, starts a
separate Supabase project on ports `55320`–`55329`, and runs both desktop and
mobile Chromium. The same sequence runs in the `Demo guide browser integration`
CI job:

```bash
pnpm demo:e2e:start

PLAYWRIGHT_DEMO_MODE=true \
VITE_DEMO_MODE=true \
VITE_SUPABASE_URL=http://127.0.0.1:55321 \
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0 \
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
pnpm test:e2e:demo

pnpm demo:e2e:stop
```

The generated profile lives under ignored `.tmp/demo-e2e-profile`, carries a
tool-owned marker before it can be replaced or removed, and never changes the
ordinary private local stack. Its fixed Turnstile response is accepted only
when the published test keys, Cloudflare's testing marker and a loopback app
hostname all agree. Hosted staging continues to require real, distinct tokens
with the configured action and hostname.

The fixed public staging site retains its real, hostname-restricted Turnstile
keys. Do not replace them with Cloudflare test keys or add a privileged
provisioning bypass. Cloudflare documents that Playwright and similar automated
browsers can be classified as bots; a valid hosted two-context run therefore
requires a person to complete the real `anonymous-sign-in` and `start-demo`
widgets in each fresh context. Tokens, cookies, traces and storage-state files
must not be retained as evidence.

An attempted Chrome DevTools run on 2026-08-04 opened two correctly named,
isolated browser contexts, but the real widgets rejected the automated browser
with Cloudflare error `600010` before either demo was provisioned. That is a
failed run, not isolation evidence. Do not hide automation signals or weaken
Turnstile to make it pass; repeat the acceptance run in a visible standard
browser with a person completing each challenge.

Run the guarded, interactive acceptance spec with a visible browser and the
Playwright Inspector. It is skipped during ordinary local and CI runs:

```bash
HOSTED_DEMO_INTERACTIVE=true \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=https://lagermat-staging.netlify.app \
pnpm exec playwright test e2e/hosted-demo-isolation.spec.ts \
  --project=desktop-chromium --workers=1 --headed --reporter=line
```

The run must use two genuinely separate Playwright browser contexts and prove:

1. different anonymous users receive different organisation and camp IDs;
2. reload in the same context reuses its existing instance without another
   `start-demo` request;
3. reset replaces only that context's organisation and camp;
4. the other context remains unchanged and cross-tenant reads return no rows;
5. both returned expiry timestamps are approximately 24 hours after creation;
   and
6. exact expiry denial and hourly deletion remain covered by the database
   acceptance test unless a later, naturally delayed hosted check observes the
   boundary without changing provider time or data.

Before any later publication, re-read provider state, rerun the non-destructive
hosted smoke, confirm the fixed identifiers above, and obtain fresh explicit
approval. Never infer approval for production, a custom domain, analytics or
real participant and dietary data from this staging snapshot.
