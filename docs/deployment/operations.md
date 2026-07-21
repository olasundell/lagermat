# Pilot operations

The pilot has no analytics. Operational monitoring is limited to service health, security events and capacity; it must not introduce behavioural tracking or copy dietary/participant data into alert payloads.

## Alerts

Route alerts to at least two named operators and test the route quarterly.

- GitHub: failed `Verify` or `Deploy hosted` runs and production environment approvals that remain pending unexpectedly.
- Netlify: failed deploys, certificate/domain failures and unusual bandwidth or request-volume changes.
- Supabase Auth: repeated failed sign-ins, invitation abuse, unexpected new identities and administrator MFA/AAL2 failures.
- Supabase Edge Functions: elevated error/latency rates for invitations and any authentication failures caused by origin/CORS validation.
- Supabase database: storage, CPU, memory, connection and backup thresholds. Review Security and Performance Advisor findings after schema releases.

Alerts must identify the tier, release SHA and technical correlation identifier. Do not include participant names, email addresses, invitation values, dietary notes or access tokens.

## Routine cadence

| Cadence | Check |
| --- | --- |
| Each release | Verified SHA, staging result, production backup, deploy/smoke result |
| Weekly | Backup freshness, provider incidents, failed jobs, Auth/function anomalies and database capacity |
| Monthly | Provider/GitHub membership, token age, suspended users and unresolved security/performance findings |
| Quarterly | Alert route test, synthetic restore drill, access review and dependency/action-pin review |

Record checks in the approved operations log. A green dashboard is not evidence of a completed restore drill or application smoke test.

## Incident triage

1. Establish whether the issue affects availability, integrity or confidentiality and which tier is involved.
2. Stop the release pipeline; disable writes only when needed to prevent further damage.
3. Preserve provider and workflow logs without copying sensitive records into tickets or chat.
4. Escalate possible personal-data exposure to the data controller immediately.
5. Use [release.md](release.md) for safe forward fixes and [restore.md](restore.md) only for database recovery.
6. Reconcile every emergency console change into versioned configuration and rotate exposed credentials.
