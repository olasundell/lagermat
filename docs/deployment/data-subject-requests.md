# Participant data-subject requests

This runbook covers participant data held in Lägermat. It does not decide identity-verification standards, response deadlines, lawful basis or who may approve disclosure; the data controller must record those decisions before real data is used.

Only an organisation administrator with an AAL2 session may perform the export or deletion operations below. Work in the participant's organisation and camp, verify the request using the controller's approved process, and record the case reference in the approved case system. Do not put identity documents, contact details or request correspondence in Lägermat.

## Access and portability

1. Find the participant under **Deltagare** and open **Integritetsärende för _namn_**.
2. Select **Exportera personuppgifter**. If prompted, open **Team**, complete two-step verification and return to the participant.
3. Open the downloaded `lagermat-personuppgifter-<participant-id>.json` locally. Confirm that the organisation, camp and participant match the verified request.
4. The export includes participant and group fields, attendance, dietary information, import source and participant audit events. Transfer it only through the controller's approved route.
5. Record the case reference, verification method, operator, export time, delivery route and completion decision in the approved case system. Do not attach the JSON to source control, chat, issue trackers or Lägermat.

The database writes a bounded `participant_privacy_exported` audit event. The event proves that an export occurred but is not a substitute for the controller's case record.

## Correction

1. Verify the requested correction and locate the participant.
2. Use **Redigera _namn_** in the participant list to correct the name, groups, portion factor or attendance.
3. Handle dietary corrections in **Specialkost**, preserving the normal review workflow.
4. Re-open the participant and export the data when evidence of the corrected state is required.
5. Record the fields corrected, operator, time and case reference in the approved case system. Never copy the old dietary or identity data into the case note unless the controller's process specifically requires it.

## Restriction

Lägermat has no hidden restricted-data archive. To prevent restricted data from remaining in active meal planning:

1. Export the participant data using the access procedure.
2. Confirm where the controller's approved restricted case copy will be stored and who may access it.
3. Use the deletion procedure below to remove the participant from active planning.
4. Store only the approved case copy and case metadata in the approved case system. Do not re-import the participant while the restriction applies.
5. Record the restriction scope, start, review trigger and decision owner outside Lägermat.

If no approved case system or restriction decision exists, stop. Do not improvise a local file archive.

## Deletion

1. Complete an export first when the controller's process requires a disclosure or case copy.
2. Open **Integritetsärende för _namn_** and select **Radera deltagaren**.
3. Check the name and confirm the irreversible action. The database removes the participant, attendance, dietary needs and dietary tag links in one transaction.
4. Refresh **Deltagare**, **Specialkost** and the overview. Confirm that the person is absent and recalculate any stale meal calculation before using generated quantities.
5. Record the case reference, operator, time, verification, affected camp and completion decision in the approved case system.

Deletion retains a non-identifying `participant_privacy_deleted` audit event with the camp and deleted row counts. It does not retain the participant id, display name or dietary text. Hosted backup retention and the point at which deleted records age out of backups must be explained in the approved privacy notice and restore runbook.

## Technical acceptance evidence

- `supabase/tests/database/privacy_request_controls.test.sql` proves role, tenant, AAL2, export, cascade deletion and bounded-audit behaviour.
- `e2e/camp-creation.spec.ts` proves the administrator can enrol TOTP, export a newly entered participant and delete the participant through the user interface.
- `e2e/app-shell.spec.ts` proves sign-out warns about queued writes, honours cancellation, clears only the signed-in user's IndexedDB records and preserves another user's records.
- `scripts/verify-privacy-controls.mjs` keeps these controls, this runbook and the unresolved external approval boundary visible in CI.

The technical checks do not approve a real-data launch. Complete every owner and provider decision in [privacy-gate.md](privacy-gate.md) separately.
