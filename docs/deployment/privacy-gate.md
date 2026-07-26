# Real-data privacy gate

This checklist is an engineering launch gate, not legal advice. The data controller must approve it before any real participant or dietary information enters production. Dietary notes can reveal health or religious information and therefore need explicit governance and technical minimisation.

## Accountability

- [ ] Data controller, contact and accountable owner are recorded.
- [ ] Lawful basis and any additional condition for sensitive data are documented by the controller.
- [ ] Supabase, Netlify, Resend and any other processor/sub-processor have approved agreements and transfer assessments.
- [ ] The privacy notice names the purposes, fields, recipients, retention, user rights and contact route.
- [ ] The application is confirmed as a private pilot; no analytics, advertising pixels or public sign-up are enabled.

## Data minimisation and access

- [ ] Only name, camp grouping, attendance, food factor and necessary food-related dietary information are persisted.
- [ ] Personal identity numbers, general medical declarations, contact details and free-text data unrelated to food are rejected before persistence.
- [ ] Administrators use TOTP; planners use individual magic links; shared accounts are prohibited.
- [ ] Role/RLS tests prove tenant isolation, suspended-user denial and non-bypassable workflow writes.
- [ ] Provider and GitHub access is least-privilege, individually assigned, MFA-protected and reviewed on a recorded schedule.

## Lifecycle and rights

- [ ] A concrete retention period and deletion trigger for participants, invitations, audit data and camps are approved and implemented.
- [ ] Administrators have a tested procedure for access, correction, restriction, export and deletion requests.
- [ ] Offline browser data is covered: sign-out handles queued writes and clears user-scoped IndexedDB data.
- [ ] Backup retention and deletion limitations are explained in the privacy notice and operator runbook.
- [ ] A tested incident route covers containment, evidence preservation, controller escalation and regulatory/data-subject assessment.

## Launch evidence

- [ ] Production custom domain, TLS, exact Auth redirects, exact CORS and exact CSP origins are verified.
- [ ] Resend sender domain, SPF, DKIM and DMARC are verified; message tracking is disabled.
- [ ] Supabase Pro backup status and [restore drill](restore.md) ownership are recorded.
- [ ] The first administrator, privacy owner and operations owner completed the production smoke test.

Approval:

- Data controller/name: ____________________
- Decision/date: ____________________
- Retention schedule reference: ____________________
- Privacy notice version: ____________________
- Processor agreement references: ____________________
- Exceptions and expiry: ____________________

## Engineering evidence matrix

The original checkboxes above remain the launch authority. Repository evidence can prove that a control exists, but it cannot supply the controller, legal, provider or production decision needed to tick a launch checkbox.

| Control | Repository evidence | Still required outside the repository |
| --- | --- | --- |
| Private pilot and no behavioural analytics | Public sign-up is disabled in `supabase/config.toml`; `operations.md` prohibits behavioural tracking; CI runs `scripts/verify-privacy-controls.mjs`. | Controller confirmation that the deployed services and provider consoles match the pilot policy. |
| Data minimisation | Import and manual-entry server validation, database privilege tests and the allow-listed import payload are covered by pgTAP and browser tests. | Controller approval of purposes, fields, lawful basis and sensitive-data condition. |
| Tenant and administrator protection | RLS/privilege tests cover tenant separation; camp creation and participant export/deletion enforce AAL2 in PostgreSQL. | Named-account and provider/GitHub access review, including recorded MFA evidence. |
| Participant rights workflow | [Participant data-subject requests](data-subject-requests.md), `privacy_request_controls.test.sql` and browser tests cover access/export, correction, restriction-by-removal and deletion. | Approved identity verification, case system, response deadline, disclosure route and privacy-owner sign-off. |
| Offline sign-out | User-scoped IndexedDB clearing is implemented and the browser test covers pending-write warning, cancellation, deletion and cross-user preservation. | Production smoke-test sign-off by the named administrator and operations owner. |
| Retention and backups | Participant deletion is transactional and leaves a bounded non-identifying audit event; [restore.md](restore.md) describes the intended backup tier. | Approved retention periods and triggers, provider backup confirmation, privacy-notice wording and restore-drill owner. |
| Incident handling | [release.md](release.md), [operations.md](operations.md) and [restore.md](restore.md) define the engineering route. | A recorded drill and the controller's regulatory/data-subject assessment procedure. |
| Production delivery | Deployment scripts statically constrain origins, redirects and headers, with staged smoke commands. | Live domain/TLS/CORS/CSP evidence, Resend DNS/tracking evidence and named production smoke-test approval. |
