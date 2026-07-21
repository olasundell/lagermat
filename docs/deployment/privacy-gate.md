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
