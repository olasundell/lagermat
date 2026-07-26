import { readFile } from "node:fs/promises";

const [
  supabaseConfig,
  migration,
  privacyGate,
  requestRunbook,
  authContext,
  offlineDatabase,
  browserAcceptance,
  operations
] = await Promise.all([
  readFile("supabase/config.toml", "utf8"),
  readFile("supabase/migrations/20260726092008_privacy_request_controls.sql", "utf8"),
  readFile("docs/deployment/privacy-gate.md", "utf8"),
  readFile("docs/deployment/data-subject-requests.md", "utf8"),
  readFile("src/features/auth/AuthContext.tsx", "utf8"),
  readFile("src/lib/offlineDb.ts", "utf8"),
  readFile("e2e/app-shell.spec.ts", "utf8"),
  readFile("docs/deployment/operations.md", "utf8")
]);

const assertions = [
  [
    /\[auth\][\s\S]*?\nenable_signup = false\b/.test(supabaseConfig),
    "Publik registrering måste vara avstängd i Auth."
  ],
  [
    /no analytics/i.test(operations)
      && /must not introduce behavioural tracking/i.test(operations),
    "Driftrunbooken måste förbjuda beteendespårning."
  ],
  [
    migration.includes("export_participant_privacy_data")
      && migration.includes("delete_participant_for_privacy")
      && migration.match(/current_authentication_assurance_level\(\) <> 'aal2'/g)?.length >= 3,
    "Camp- och deltagarintegritetsåtgärder måste kräva AAL2 i databasen."
  ],
  [
    migration.includes("set search_path = ''")
      && migration.includes("revoke all on function public.export_participant_privacy_data(uuid)")
      && migration.includes("grant execute on function public.delete_participant_for_privacy(uuid)"),
    "Integritetsfunktionerna måste ha härdad search_path och uttryckliga funktionsrättigheter."
  ],
  [
    migration.includes("'participant_privacy_deleted'")
      && migration.includes("'deleted-participant'")
      && migration.includes("'deleted_attendance_count'")
      && migration.includes("'deleted_dietary_need_count'"),
    "Raderingshändelsen måste vara begränsad och icke-identifierande."
  ],
  [
    authContext.includes("countPendingMutations(userId)")
      && authContext.includes("window.confirm(")
      && authContext.includes("clearOfflineDataForUser(userId)"),
    "Utloggning måste varna för köade ändringar och rensa användarspecifik offline-data."
  ],
  [
    offlineDatabase.includes("mutation.userId === userId")
      && offlineDatabase.includes("snapshot.userId === userId")
      && offlineDatabase.includes('.where("userId").equals(userId)'),
    "IndexedDB-rensning måste avgränsas till den utloggade användaren."
  ],
  [
    browserAcceptance.includes("andra användarens offline-data")
      && browserAcceptance.includes("inte synkroniserats")
      && browserAcceptance.includes("lagermat-local-v1"),
    "Browseracceptansen måste bevisa varning, avbryt och användaravgränsad rensning."
  ],
  [
    requestRunbook.includes("## Access and portability")
      && requestRunbook.includes("## Correction")
      && requestRunbook.includes("## Restriction")
      && requestRunbook.includes("## Deletion"),
    "Runbooken måste täcka tillgång, rättelse, begränsning och radering."
  ],
  [
    privacyGate.includes("## Engineering evidence matrix")
      && privacyGate.includes("Still required outside the repository")
      && !/\[[xX]\]/.test(privacyGate),
    "Ingen extern integritets- eller lanseringskontroll får markeras godkänd av CI."
  ]
];

const failures = assertions
  .filter(([passed]) => !passed)
  .map(([, message]) => message);

if (failures.length > 0) {
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log("Tekniska integritetskontroller och den externa beslutsgränsen är statiskt verifierade.");
