# Scoutnet reconciliation rollout

This runbook covers the optional Scoutnet participant reconciliation flow. It
does not authorise real credentials, real participant data, a hosted rollout or
production use. The current executable acceptance scope is local, authenticated
and entirely synthetic.

The data contract and the externally unresolved Scoutnet questions are defined
in [scoutnet-project-api.md](scoutnet-project-api.md).

## Current rollout state

| Environment | Source | Scoutnet function | Allowed now |
| --- | --- | --- | --- |
| Local | Deterministic repository fixture | Enabled only on loopback | Yes |
| Public staging demo | Synthetic demo data, no Scoutnet source | Disabled | No Scoutnet reconciliation |
| Private staging | Not provisioned for this flow | Disabled by default | Requires separate deploy and privacy approval |
| Production | No approved source | Disabled by default | Blocked |

`SCOUTNET_RECONCILIATION_MODE=fixture` is a localhost-only development gate.
The hosted environment renderer rejects the variable and removes it from
generated hosted Supabase configuration. It must not be copied into Netlify,
Supabase staging or a protected GitHub environment.

Any future hosted acceptance must proceed in this order:

1. verify the exact revision locally against the synthetic fixture;
2. obtain explicit approval to change the private staging configuration;
3. introduce and review a separate private-staging synthetic source that cannot
   be enabled in production and does not reuse the localhost fixture flag;
4. run the same preview, explicit-decision, apply and reload checks in private
   staging with invented people and diets;
5. obtain Scouterna's written API confirmation and the approved privacy,
   retention and operations gate; and only then
6. test a real key and real data in an expressly approved private environment.

No step implies permission for the next one.

## Local synthetic acceptance

Start from a disposable local database. This destroys local database contents,
so inspect the target and preserve anything important first.

```sh
pnpm supabase:start
pnpm supabase:reset
pnpm dev:no-login -- --port 5174
```

Serve `scoutnet-connection` with `APP_ORIGIN` set to the exact Vite origin. The
local wrappers provide the synthetic source-reference secret and set
`SCOUTNET_RECONCILIATION_MODE=fixture`; do not invent or paste a real key.

The acceptance path on `/deltagare` is:

1. confirm that manual registration and XLSX/CSV import remain visible;
2. open the Scoutnet section and confirm that the named project is explicitly
   shown as a local synthetic fixture;
3. select **Synka nu** — opening the page alone must not fetch participants;
4. inspect every new, changed, possible-duplicate and withdrawn row;
5. make an explicit decision for every row and apply;
6. reload and confirm that the accepted result persists;
7. inspect `/specialkost` and confirm that changed free text is reopened for
   human review rather than converted into medical tags automatically;
8. run **Synka nu** again and confirm that the same snapshot produces no
   duplicate participants or spurious changes; and
9. repeat the preview on a narrow mobile viewport and check that there is no
   horizontal overflow or browser-console error.

The baseline automated verification is:

```sh
pnpm supabase:reset
pnpm supabase:lint
pnpm supabase:test
pnpm test
pnpm check
pnpm scoutnet:contract:check
node scripts/verify-deployment-config.mjs --hosted
node scripts/verify-hosted-environment-boundaries.mjs
pnpm build
git diff --check
```

The database reset and browser acceptance must target the isolated local
worktree and local Supabase project, never a hosted project.

## Secrets and data boundary

- The browser sends only an authenticated action, camp identifier, reviewed
  decisions and preview digests. It never receives the service-role key,
  endpoint keys, Vault identifiers or the HMAC source-reference secret.
- A real connection would store the participants and questions endpoint keys
  as separate Supabase Vault secrets. The public status response exposes only
  key-presence booleans.
- The Edge route verifies the Supabase user, exact origin, active organisation
  administrator membership and the bounded request shape before calling a
  camp-scoped service-role RPC.
- Only the allow-listed display name, registration state, organisation labels,
  attendance, special-diet text and pseudonymous source reference may cross the
  adapter boundary. Identity numbers, contact details, unmapped answers and raw
  responses are rejected or discarded.
- Audit events contain action metadata and counts, never credentials, question
  IDs, source identifiers, names, diet text or raw responses.

## Failure, retry and concurrency behaviour

- A malformed, incomplete or unexpected upstream snapshot fails closed. It is
  never interpreted as an empty authoritative list and therefore cannot
  withdraw everyone.
- Preview is read-only. Apply rebuilds and revalidates the preview on the
  server, checks the state and preview digests, validates every decision and
  commits atomically.
- A stale preview returns a conflict and requires a fresh **Synka nu**. The
  client must not silently replay decisions against a different snapshot.
- Apply uses an idempotency key. Repeating the same accepted request returns the
  same outcome; reusing the key for different content is rejected.
- Authentication, authorisation, origin and role failures are not retried.
- Transport failures and `5xx` preserve the last accepted local state. A `429`
  is presented as rate limiting and must respect `Retry-After`; no automatic
  background polling, scheduled retry or webhook exists in version 1.
- The official API does not currently document limits, backoff, pagination or
  snapshot completeness. Real traffic stays blocked until Scouterna confirms
  those behaviours in writing.

## Retention and withdrawal

The function holds a raw synthetic/upstream response only long enough to parse
and validate one request. It does not persist or log the raw response.

Accepted local data consists of the minimised participant fields, active
attendance intervals, current diet-review text, superseded history and bounded
audit metadata. A Scoutnet cancellation or absence from an explicitly complete
snapshot changes the participant lifecycle to `withdrawn`; it does not hard
delete the person. Active-only calculations then exclude the participant,
attendance and diet tags while preserving a recoverable audit trail.

Disconnect removes connection metadata and both Vault secrets atomically. It
does not delete previously accepted participant history. A real-data retention
period, deletion procedure, data-subject process and responsibility split must
be approved in the privacy gate before a real pilot; the synthetic
implementation deliberately does not guess those policy decisions.

## Rollback and incident stop

For a local synthetic run, stop the Vite and Edge processes. If the disposable
state must be discarded, run `pnpm supabase:reset` only after confirming that
the target is the local Scoutmat Supabase project.

For a future hosted incident:

1. disable the Scoutnet Edge Function or remove its route while keeping the
   application and accepted local records available;
2. revoke the affected endpoint keys in Scoutnet and disconnect the camp
   connection so both Vault secrets are removed;
3. preserve audit metadata and capture the exact deployed revision;
4. correct database behaviour with a reviewed forward migration; do not run a
   destructive database rollback merely to undo a frontend or function fault;
5. restore a database backup only under the general incident/restore runbook
   and after assessing newer participant and planning changes; and
6. rerun synthetic acceptance before considering re-enablement.

The current local implementation has not changed any hosted configuration and
has not deployed or contacted Scoutnet.
