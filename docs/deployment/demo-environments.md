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
| Data | Canonical synthetic fixture only | No demo seed |
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
Both Edge Functions also check server-side `DEMO_MODE`, so stale function
deployments fail closed.

The demo login page contains no email form or invitation path. Production
contains no demo action. This is a build-time boundary backed by a separate
server-side boundary; neither trusts the other.

## Static Netlify boundary

The demo backend is the authenticated Supabase Edge Function `start-demo`.
It adds no Netlify Function.

The repository also contains two supplier-only Netlify Functions added after
the demo architecture was approved. They remain useful for local ICA catalogue
and semantic-matching work, but they must not hitchhike into the public demo.
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

## Provider inventory and constrained action, 2026-07-31

The connected staging providers were inspected before publication:

- `lagermat-staging` exists at
  `https://lagermat-staging.netlify.app`, site ID
  `295e743b-3276-4a4f-9171-c7b51cafece6`.
- Its current deploy is `6a5f2f0efe9d520139001592`, published
  2026-07-21. Netlify reports no Functions and no Edge Functions in that
  deploy.
- `lagermat-production` exists with site ID
  `0337a6f7-0d86-4eab-a791-fd5d8a1c07d3`.
- Neither site currently exposes project-level Netlify environment variables
  through the connected context.
- Supabase staging is project `datiqfdwpalnuttfkthf` in `eu-north-1`. It was
  inactive and was restored; the provider now reports `ACTIVE_HEALTHY`.
- The restored project still has migrations only through
  `20260721090307_add_private_template_deny_policies.sql`, and its only deployed
  Edge Function is `invite-member` version 2. No database migration, Auth
  configuration, secret, Edge Function or Netlify artefact was published in
  this pass.

Publication remains fail-closed because a real Turnstile widget restricted to
`lagermat-staging.netlify.app` and its separate site/secret keys are not
available in the authorised provider contexts. Cloudflare's public test keys
must not be used for the public demo. Configure the real site key as the
staging variable `TURNSTILE_SITE_KEY` and the secret as the protected staging
secret `TURNSTILE_SECRET_KEY` before resuming the backend-first deploy.

This inventory is time-sensitive and not deployment approval. Before any
publication, re-read both sites and verify:

1. the fixed staging URL and site ID;
2. the intended staging Supabase project reference and publishable key;
3. a Turnstile widget restricted to the exact staging hostname, with site key
   and secret stored in their correct public/protected locations;
4. anonymous Auth and email-provider state after config push;
5. zero Netlify Functions in the resulting deploy;
6. no production, custom-domain, analytics or real-data changes; and
7. fresh explicit user approval for the external staging deployment.

The Supabase staging project restore is the only provider mutation recorded in
this pass. Netlify staging and all production providers remain unchanged.
