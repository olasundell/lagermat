# Scoutnet Project API contract

Lägermat treats Scoutnet as an optional server-side source alongside manual
registration and local XLSX/CSV import. This document locks the synthetic
development contract; it does not authorise real keys, real participant data or
production use.

## Locked official artefacts

The contract was refreshed from Scouterna's public npm packages on
2026-07-30:

| Artefact | Exact version | npm tarball SHA-1 |
| --- | --- | --- |
| [`@scouterna/scoutnet`](https://www.npmjs.com/package/@scouterna/scoutnet/v/0.3.26) | `0.3.26` | `4a3b517b6fb7ea2ca64fa768777d776d95b43ab2` |
| [`@scouterna/scoutnet-openapi`](https://www.npmjs.com/package/@scouterna/scoutnet-openapi/v/0.4.1) | `0.4.1` | `60b3e701bcbf5bbb52a965e72622c1a99f80ca54` |

Both packages are published from
[`Scouterna/scoutnet-api`](https://github.com/Scouterna/scoutnet-api).
Versions are exact in `package.json` and `pnpm-lock.yaml`; there is no caret
range. `scripts/verify-scoutnet-contract.mjs` also checks the installed schema
and fixture manifest in CI.

These are package/schema versions, not a claim that Scoutnet exposes a stable
server release number. The OpenAPI changelog says schema `0.3.9` was aligned
with Scoutnet `4.24.2`; subsequent schema releases added endpoints and member
fields. No public compatibility or deprecation policy was found, so a package
upgrade requires a deliberate contract review and fixture refresh.

## Read-only Project API surface

The locked OpenAPI document defines production base URL
`https://scoutnet.se/api` and HTTP Basic authentication. The project/resource
ID is the username and the corresponding endpoint key is the password. The
official client notes that endpoints have distinct access keys, so Lägermat
must keep separate participants and questions keys server-side.

Only two GET operations are in scope:

| Purpose | Path | Official operation |
| --- | --- | --- |
| Registration snapshot | `/project/get/participants` | `getProjectParticipants` |
| Forms and questions | `/project/get/questions` | `getProjectFormts` |

The `getProjectFormts` spelling is the published operation ID and is preserved
here even though it appears to be a typo. Questions may be requested with an
optional numeric `form_id`.

The participants response contains a keyed `participants` map, labels and
course labels. A participant can include registration state, primary
membership, group-registration membership and answers keyed by question ID.
Lägermat deliberately does not ingest `ssno`, email or `contact_info`.
When both membership structures contain data, the project-specific
`group_registration_info` wins; `primary_membership_info` is only the
fallback.

The questions response contains keyed forms, a selected form, keyed questions,
tabs, sections and messages. Question IDs — not translated labels — are the
stable join to participant answers. Automatic label matching is only a draft
suggestion. An administrator must explicitly confirm which synthetic/real
question IDs mean group, division, patrol, one or more special-diet answers,
and either arrival/departure pairs or selected attendance days before any
participant preview or apply step.

## Camp-bound connection boundary

The local implementation exposes one authenticated Edge Function,
`POST /functions/v1/scoutnet-connection`. It accepts only the configured exact
application `Origin`, has Supabase `verify_jwt = true`, verifies the persisted
Auth user once more and returns `Cache-Control: private, no-store`. Every
mutation additionally requires the verified JWT to have `aal2`.

The Supabase gateway may add its generic wildcard CORS header to a successful
function response. That header is not the authorization boundary: the handler
compares the immutable browser `Origin` before authentication, probing or RPC
access. A different or missing origin receives `403` before data access and no
allow-origin response from the handler. Direct handler tests additionally
prove the exact configured header without the gateway rewrite.

The request body selects one bounded action:

| Action | Purpose | Required assurance |
| --- | --- | --- |
| `status` | Read connection state without secrets or Vault IDs | Authenticated organization administrator |
| `question-catalogue` | Read the allow-listed catalogue, deterministic suggestions and current mapping | Authenticated organization administrator |
| `participant-snapshot` | Read one fully validated, allow-listed preview with pseudonymous references | Authenticated organization administrator |
| `connect` | Verify and store project ID plus two distinct endpoint keys | Active administrator and AAL2 |
| `rotate` | Verify and replace one/both endpoint keys or move project | Active administrator and AAL2 |
| `update-question-mapping` | Store only approved numeric question-ID mappings | Active administrator and AAL2 |
| `disconnect` | Delete connection metadata and both Vault secrets atomically | Active administrator and AAL2 |

`connect` and `rotate` verify supplied keys directly against the matching
official endpoint. The project ID and key exist only in the HTTP Basic
`Authorization` header; redirects are disabled, neither value is put in a URL,
and the response body is cancelled without being parsed or logged. A new
project ID requires both new endpoint keys so no key is silently tested against
the wrong project.

Private metadata lives in `app_private.scoutnet_connections`, outside the Data
API schemas, with forced RLS, an explicit restrictive browser deny policy and
no grants to `PUBLIC`, `anon`, `authenticated` or `service_role`. The two keys
are separate rows in Supabase Vault. Public-schema wrapper RPCs derive the
organization from the camp, recheck the supplied actor against an active
membership and expose execution only to `service_role`.

Supabase Vault itself deliberately grants the platform `service_role` direct
Vault access and restores those extension-owned grants when the local stack
starts. That role is therefore the server trust boundary, not a tenant role:
its key must never reach the browser. Application code uses only the
camp-scoped wrappers. `PUBLIC`, `anon` and `authenticated` are explicitly
denied direct Vault schema, table, view and mutation-function access.

Status responses contain only project ID, boolean key-presence markers,
bounded numeric question-ID mapping and lifecycle timestamps. Audit events
contain action, time, actor, camp and counts only. They never contain project
ID, endpoint keys, Vault IDs, question IDs, raw Scoutnet responses or
participant data. Disconnect deletes the metadata and both Vault rows in the
same database transaction.

The participant adapter parses the whole response before returning anything.
Its public DTO is a strict allow-list: HMAC source reference, display name,
registration state, mapped group/division/patrol, validated attendance
intervals with warnings, and mapped special-diet values. Raw Scoutnet member
numbers, endpoint keys, contact fields, identity numbers and unmapped answers
cannot cross the adapter boundary. References use HMAC-SHA-256 with
organisation, project and value domain separation plus a server-only
`SCOUTNET_SOURCE_REFERENCE_SECRET`; the browser never receives that secret or
the source values.

The source-reference secret is a stable production secret of at least 32
bytes. Local wrappers inject a clearly synthetic development value. Public
staging keeps Scoutnet disabled and deliberately has no such secret. The
private-production environment validator fails closed if the value is missing,
short, whitespace-padded or exposed through a `VITE_` variable.

The public staging demo renders this function disabled. The private-production
configuration can enable it, but no external deployment, real key or real
participant request is authorised by this implementation.

## Response quirks and fail-closed rules

The official client documents a Scoutnet quirk: an empty PHP object may be
serialised as `[]`. The participants OpenAPI schema additionally allows
`participants` to be an object, array or null. Lägermat therefore accepts:

- a keyed object as data;
- an empty array as an empty map; and
- null as an empty map.

A populated array, scalar, missing required top-level map, malformed JSON,
non-JSON error body or an otherwise unexpected shape is not a valid empty
snapshot. It must stop preview/apply and preserve the last accepted local
state.

Question mapping is also fail closed. Only numeric IDs from the currently
fetched catalogue are accepted, every ID may have only one role, at least one
special-diet question is required, and attendance must use exactly one mode:

- one or more complete arrival/departure pairs; or
- explicitly dated selected-day questions inside the camp dates.

Arrival/departure answers preserve their exact RFC 3339 instants. Selected
days become timezone-aware, half-open local-midnight intervals; adjacent days
are merged and non-contiguous days remain separate. Overlapping
arrival/departure intervals are invalid. A missing, incomplete or invalid
attendance answer deliberately falls back to the whole camp with an explicit
warning for reconciliation; it is never silently treated as a confirmed exact
period. An explicit selected-days mapping with no selected days returns no
attendance plus its own warning.

The public OpenAPI contract documents an empty-body `401` but does not document
rate limits, retry policy, pagination, snapshot completeness or change/version
notifications. The fixtures consequently include `429` with `Retry-After`,
unexpected `{}`, malformed JSON and HTML `503`; later transport code must
handle these without treating them as withdrawals.

## Synthetic fixture matrix

Reusable fixtures live in
`server/fixtures/scoutnet/v0.4.1/` and are explicitly classified
`synthetic-only`.

- Questions: object, empty array and null.
- Participants: object, empty array and null.
- Registration states: cancelled and unconfirmed as distinct cases.
- Organisation mapping: project-specific group-registration data preferred,
  including a fixture where it differs from primary membership; primary
  membership is the fallback.
- Attendance: two separate arrival/departure intervals.
- Special diet: synthetic free text keyed by a synthetic question ID.
- Transport: empty-body `401`, JSON `429`, unexpected empty object, malformed
  JSON and HTML `503`.

The fixtures contain invented IDs, names, groups and answers. They intentionally
contain no personal identity number, email address, telephone number or real
API key.

Run:

```sh
node scripts/verify-scoutnet-contract.mjs
./node_modules/.bin/vitest run \
  server/scoutnetContract.test.ts \
  server/scoutnetConnectionHandler.test.ts
bash scripts/supabase-local.sh db reset
bash scripts/supabase-local.sh test db
```

## Unresolved external contract

Before any real integration, Scouterna must confirm in writing:

1. that external server-side use of the Project API is permitted for Lägermat;
2. how participants/questions keys are issued, scoped, rotated and revoked;
3. rate limits and required backoff;
4. whether a response is a complete authoritative snapshot;
5. cancellation/unconfirmation semantics and retention expectations; and
6. compatibility, deprecation and change-notification policy.

Until then, only synthetic fixtures are executable scope.

The local acceptance sequence, secret boundary, failure behaviour, retention
limits and rollback procedure are specified in
[scoutnet-rollout.md](scoutnet-rollout.md).
