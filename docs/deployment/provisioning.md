# One-time provisioning

Provisioning changes external accounts and billing. Perform it with an owner present and record the final identifiers in the password manager, not in Git.

## 1. Public GitHub repository

1. Create the public repository and add the local repository as its remote only after explicit Git approval. Treat every committed file and workflow log as public.
2. Protect `main`: require pull requests, dismiss stale approvals, block force pushes/deletion, and require `Verify / GitHub workflow lint`, `Verify / Application and hosted bundle` and `Verify / Database and browser integration`.
3. Allow GitHub Actions read-only repository access by default.
4. Create `staging` and `production` environments. Add a required human reviewer on `production`; when a second operator is available, require that reviewer and prevent self-review. The review confirms the backup, privacy gate and release notes before secrets are released to the job.
5. Enable GitHub secret scanning, push protection and Dependabot alerts for the public repository.

Each GitHub environment needs these values:

| Kind | Name | Meaning |
| --- | --- | --- |
| Variable | `APP_ORIGIN` | Exact origin, without trailing slash |
| Variable | `DEMO_MODE` | Exactly `true` in staging and `false` in production |
| Variable | `AUTH_EMAIL_MAX_FREQUENCY` | Set to `1m` for hosted abuse protection |
| Variable | `NETLIFY_SITE_ID` | Fixed site for this tier |
| Variable | `SUPABASE_PROJECT_REF` | Exact 20-character project reference |
| Variable | `SMTP_HOST` | Resend SMTP host |
| Variable | `SMTP_PORT` | TLS-capable SMTP port |
| Variable | `SMTP_FROM_ADDRESS` | Verified sender on the auth subdomain |
| Variable | `SMTP_FROM_NAME` | Human-readable sender name |
| Secret | `NETLIFY_AUTH_TOKEN` | Least-privilege deployment token |
| Secret | `SUPABASE_ACCESS_TOKEN` | Token restricted to the intended organisation |
| Secret | `SUPABASE_DB_PASSWORD` | Project database password |
| Secret | `SUPABASE_PUBLISHABLE_KEY` | Browser-safe key; protected here to avoid drift |
| Secret | `SMTP_USER` | Resend SMTP user |
| Secret | `SMTP_PASS` | Resend SMTP/API credential |
| Secret | `SCOUTNET_SOURCE_REFERENCE_SECRET` | Stable production-only HMAC secret for opaque Scoutnet source references |

Staging additionally needs the public variable `TURNSTILE_SITE_KEY` and the
protected secret `TURNSTILE_SECRET_KEY`. It must not receive any SMTP variable
or secret, including `SCOUTNET_SOURCE_REFERENCE_SECRET`. Production requires
the SMTP and Scoutnet values above and must not receive either Turnstile value.
`VITE_DEMO_MODE` is derived from the protected environment's `DEMO_MODE`; it is
not a third independent switch.

The exact generated configuration and the currently known provider inventory
are in [demo-environments.md](demo-environments.md). The deploy workflow maps
these protected environment values and publishes Netlify with an explicit
empty Functions directory; its fail-closed validation must pass before any
provider mutation.

Use separate provider tokens where practical. Rotate them after personnel or ownership changes and at the interval recorded in the operations log.

## 2. Supabase projects

1. Create a staging project containing no personal data. Enable anonymous Auth
   only through the generated staging configuration; disable the email provider
   and do not configure SMTP.
2. Create a production Pro project in North EU (Stockholm). Confirm the region before creation because it is a data-location and latency decision.
3. Add only named operators, require MFA on every account, enable SSL enforcement, and restrict direct database access to approved operator/CI addresses where operationally possible.
4. Confirm public sign-up is disabled and redirects contain only the tier's exact `APP_ORIGIN` and `${APP_ORIGIN}/auth/callback`.
5. Do not paste server keys into GitHub variables, Netlify or local Vite files. Supabase supplies runtime server credentials to Edge Functions.
6. Confirm production daily backups are active and visible. Record the first successful backup before admitting pilot data.

The workflow pushes the versioned Supabase configuration. It deliberately never includes development seeds.

## 3. Resend and DNS

1. Allocate an authentication sender subdomain, for example `auth.<base-domain>`.
2. Verify the domain in Resend and publish the supplied SPF and DKIM records. Add an explicit DMARC policy agreed by the domain owner.
3. Disable open/click tracking for authentication messages.
4. Put separate staging and production credentials in their respective GitHub environments.
5. Send invitation and magic-link tests to approved test mailboxes before the first pilot user is invited.

## 4. Netlify sites

1. Create two empty sites: stable staging and production. Do not create ad-hoc deploy previews.
2. Do not give Netlify any Supabase database or server secret. Builds and deploys are performed by GitHub Actions.
3. Assign the production custom domain and HTTPS certificate; set the exact origin as production `APP_ORIGIN`.
4. Keep automatic Git publishing disabled so the staged workflow remains the only release path.
5. Give the deployment token access only to these two sites and the intended team.
6. Keep the staging demo on its fixed `netlify.app` URL. Do not add a custom
   domain, analytics or Netlify Functions.

## 5. First release

Complete the privacy gate and the two [recipe-catalogue approvals](recipe-catalogue.md), run the normal staged release, then invoke the privileged hosted bootstrap command once for each project. Staging uses test identities and synthetic camp data. Production uses the approved first administrator and creates no fake users or camps.

Run it from a trusted operator terminal. Supply the environment-specific secret key through the process environment, never as a command-line argument or in shell history:

```bash
read -rsp "Supabase secret key: " SUPABASE_SECRET_KEY
printf "\n"
export SUPABASE_SECRET_KEY
export SUPABASE_URL="https://PROJECT_REF.supabase.co"
export APP_ORIGIN="https://mat.example.se"

pnpm bootstrap:hosted -- \
  --environment production \
  --admin-email admin@example.se \
  --organisation-name "Example scout group" \
  --camp-name "Summer camp" \
  --starts-on 2027-07-01 \
  --ends-on 2027-07-08

unset SUPABASE_SECRET_KEY
```

Production requires typing `production` at the interactive confirmation. Re-running the exact bootstrap reports the existing organisation; any conflicting organisation or administrator fails closed.

After bootstrap, prove an administrator invitation, TOTP enrolment, a planner magic link and sign-out/cache clearing before real data is entered.
