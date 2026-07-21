# Backup and restore runbook

Production uses Supabase Pro daily backups with seven-day retention. PITR is deferred until the approved recovery-point objective requires it. Record the pilot's recovery-point and recovery-time objectives here before launch:

- Approved RPO: ____________________
- Approved RTO: ____________________
- Owner and approval date: ____________________

## Routine checks

- A release approver confirms a visible, successful recent backup before every production deployment.
- An operator checks backup status, database capacity and failed-job alerts weekly.
- Access to backup/restore controls requires provider MFA and is limited to named operators.
- No database export containing pilot data may be stored unencrypted or in the repository, CI artefacts, Netlify or ordinary cloud drives.

## Quarterly drill

The normal quarterly drill uses the synthetic staging dataset and an isolated disposable target. It must not interrupt or copy real production data.

1. Record the source revision, migration head, operator, start time and expected fixture counts.
2. Create an isolated temporary restore target in the approved region and access boundary.
3. Restore the latest staging backup or an encrypted, freshly generated staging logical backup using the current Supabase procedure.
4. Run database lint, pgTAP, generated-type comparison and the non-destructive hosted smoke test against the restored target.
5. Verify authentication is invitation-only, cross-organisation RLS is enforced, direct browser DML is denied, and the expected synthetic camps/recipes exist.
6. Record achieved RPO/RTO, discrepancies and corrective work.
7. Destroy the disposable target and securely delete exports after evidence has been retained without personal data.

At least annually, review the production recovery procedure with Supabase's current dashboard/documentation and the data controller. Do not trigger a production restore merely as a drill.

## Production recovery

1. Declare the incident, stop releases and decide whether writes must be disabled.
2. Preserve workflow, database, Auth and Edge Function logs. Record the suspected loss window and last known good revision.
3. Notify the data controller; follow the approved breach process if confidentiality or integrity may be affected.
4. Select the recovery point with the service owner and confirm the loss implied by the approved RPO.
5. Follow the current [Supabase restore procedure](https://supabase.com/docs/guides/platform/backups) in a controlled maintenance window. A second operator verifies the project and recovery point before confirmation.
6. Reapply only versioned migrations that are newer than the restored point. Deploy only a frontend compatible with that schema.
7. Run RLS/role tests, calculation golden fixtures, invitation/auth tests and application smoke tests before reopening writes.
8. Reconcile any provider console changes into code and complete an incident review.

Never use a production restore to correct a presentation-only fault, and never assume a Netlify rollback reverses database state.
