# Canonical hosted demo fixture

The Björkstad demo is a versioned, synthetic template. It is the only fixture
input permitted for the public staging demo. It contains no real participant,
dietary, supplier, price or stock data.

This boundary applies to the versioned fixture. An active staging demo may
temporarily fetch real product names, package data and prices from ICA's public
catalogue through the authenticated `ica-catalogue` Edge Function. Those
tenant-scoped runtime rows are not fixture input. They become inaccessible at
the exact 24-hour expiry and are deleted with the isolated demo organisation by
the next hourly cleanup.

The source of truth is:

- `supabase/fixtures/bjorkstad-v1.json` for the symbolic fixture graph;
- `20260730220001_canonical_demo_fixture_data.sql` for the generated,
  digest-bound database payload; and
- `20260730220000_canonical_demo_fixture.sql` for the private registry,
  transactional instantiator, expiry checks and cleanup job.

The generated data migration must not be edited by hand. Verify that it still
matches the source fixture with:

```bash
pnpm demo:fixture:check
```

To make an intentional fixture change, reset the local database to the last
accepted fixture, change only synthetic data, and then run:

```bash
node scripts/export-demo-fixture.mjs --from-database
node scripts/export-demo-fixture.mjs
pnpm demo:fixture:check
```

Review the JSON diff, generated migration, row counts and digest together. A
fixture version that has reached any hosted environment is immutable: create a
new version and migration instead of rewriting its history. The recipe
catalogue remains a separate versioned resource, but every fixture version
records the exact aggregate catalogue digest it was tested with.

## Provisioning boundary

`app_private.demo_fixture_versions` and `app_private.demo_instances` are denied
to browser roles. The public `provision_demo_instance` RPC accepts only an
anonymous user ID and is executable only by `service_role`. The staging Edge
Function at `POST /functions/v1/start-demo` derives that ID from a verified
JWT and then verifies the persisted Auth user is still anonymous. The browser
must never choose a user ID, organisation ID, camp ID, fixture payload or
expiry.

The endpoint accepts exactly:

```json
{
  "action": "start",
  "turnstileToken": "<single-use Turnstile token>"
}
```

`action` may be `start` or `reset`. The configured `APP_ORIGIN` must be an
origin without a path, and the raw request `Origin` must match it exactly.
`TURNSTILE_SECRET_KEY` is a server secret. It must not be prefixed with
`VITE_`, copied into Netlify client variables or committed. The Edge Function
validates the Turnstile hostname and the dedicated widget action
`start-demo`; failures are closed and no token, JWT or database error is
logged.

Cloudflare Turnstile tokens are single use. If Supabase Auth CAPTCHA is also
enabled for `signInAnonymously`, the client must obtain two distinct tokens:
one with the Auth widget action for the anonymous sign-in and a fresh one with
the `start-demo` action for this endpoint. Reusing the Auth token for
provisioning will correctly fail as a duplicate.

A successful response contains only:

```json
{
  "organizationId": "<server-created UUID>",
  "campId": "<server-created UUID>",
  "expiresAt": "<ISO timestamp>",
  "templateVersion": 1,
  "reused": false
}
```

The function is configured with JWT verification and runs the database RPC
through its service client only after exact-origin, persisted anonymous-user
and Turnstile checks. Browser roles have neither direct organisation/membership
insert privileges nor execute rights on the provisioning RPC.

Instantiation is one database transaction. It creates fresh UUIDs for the
organisation, camp and every tenant-owned row, shifts the camp dates relative
to the current Stockholm date, records the instance, and writes an audit
event. A digest mismatch or any failed insert rolls the whole instance back.
Repeated calls for the same live user return the same instance; an explicit
reset first deletes that user's prior demo graph.

`supabase/seed.sql` is local-only. It creates development identities and an
independent isolation tenant, then calls the same private instantiator for
Björkstad. Stable local UUIDs are retained only to keep existing local and
browser tests deterministic. The historical hand-written seed is kept at
`supabase/fixtures/legacy-local-seed-v0.sql` for comparison and is not executed.

## Exact expiry and cleanup

Every demo instance expires exactly 24 hours after creation. Membership and
admin checks reject the demo organisation as soon as that timestamp is reached,
even if the hourly cleanup has not run yet. The signed-in browser may read only
its own session status.

Supabase Cron runs `app_private.cleanup_expired_demo_instances()` at minute
zero every hour. Cleanup deletes the tenant graph in foreign-key-safe order,
then deletes the Auth user only after verifying that it is anonymous. It also
removes anonymous Auth orphans older than one hour, while preserving fresh
provisioning attempts and all non-anonymous accounts.

Client recovery must remove IndexedDB data and workspace-selection keys scoped
to the expired user before local sign-out. It then creates a different
anonymous identity and provisions a fresh instance. A failed provision abandons
the new local session; the server-side orphan sweep is the final safety net.

## Release evidence

Before enabling the public staging entry point, retain evidence for:

1. fixture and generated-migration drift checks;
2. pgTAP coverage of isolation, atomicity, idempotency, exact expiry, cleanup
   ordering and Cron registration;
3. client tests for user-scoped offline recovery; and
4. desktop and mobile browser acceptance using synthetic data.

The fixture lifecycle and Edge Function do not themselves expose a public
button or deploy anything. The staging-only client entry point, Auth CAPTCHA
configuration and hosted acceptance are separate release items. Their
fail-closed environment contract is documented in
[demo-environments.md](demo-environments.md).
