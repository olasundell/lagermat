import { readFile } from "node:fs/promises";

const CLIENT_VERSION = "0.3.26";
const OPENAPI_VERSION = "0.4.1";
const fixtureRoot = "server/fixtures/scoutnet/v0.4.1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const [
  applicationPackage,
  installedClient,
  installedOpenApi,
  lockfile,
  openApiSchema,
  participantsSchema,
  questionsSchema,
  clientReadme,
  connectionImportMap,
  connectionHandler,
  connectionAdapter,
  connectionFunction,
  manifest,
  questions,
  participants,
  httpResponses
] = await Promise.all([
  json("package.json"),
  json("node_modules/@scouterna/scoutnet/package.json"),
  json("node_modules/@scouterna/scoutnet-openapi/package.json"),
  readFile("pnpm-lock.yaml", "utf8"),
  readFile(
    "node_modules/@scouterna/scoutnet-openapi/schema/scoutnet.yaml",
    "utf8"
  ),
  readFile(
    "node_modules/@scouterna/scoutnet-openapi/schema/paths/project_get_participants.yaml",
    "utf8"
  ),
  readFile(
    "node_modules/@scouterna/scoutnet-openapi/schema/paths/project_questions.yaml",
    "utf8"
  ),
  readFile("node_modules/@scouterna/scoutnet/README.md", "utf8"),
  json("supabase/functions/scoutnet-connection/deno.json"),
  readFile(
    "supabase/functions/scoutnet-connection/handler.ts",
    "utf8"
  ),
  readFile(
    "supabase/functions/scoutnet-connection/adapter.ts",
    "utf8"
  ),
  readFile(
    "supabase/functions/scoutnet-connection/index.ts",
    "utf8"
  ),
  json(`${fixtureRoot}/manifest.json`),
  json(`${fixtureRoot}/questions.json`),
  json(`${fixtureRoot}/participants.json`),
  json(`${fixtureRoot}/http-responses.json`)
]);

assert(
  applicationPackage.dependencies?.["@scouterna/scoutnet"] === CLIENT_VERSION,
  "Den officiella Scoutnet-klienten måste vara exakt versionslåst."
);
assert(
  applicationPackage.devDependencies?.["@scouterna/scoutnet-openapi"]
    === OPENAPI_VERSION,
  "Scoutnets OpenAPI-paket måste vara exakt versionslåst."
);
assert(
  installedClient.version === CLIENT_VERSION
    && installedOpenApi.version === OPENAPI_VERSION,
  "Installerad Scoutnet-klient eller OpenAPI-version avviker."
);
assert(
  connectionImportMap.imports?.["@scouterna/scoutnet"]
    === `npm:@scouterna/scoutnet@${CLIENT_VERSION}`,
  "Scoutnet Edge Function måste använda exakt samma låsta klientversion."
);
for (const required of [
  'SCOUTNET_PROJECT_API_BASE_URL = "https://scoutnet.se/api"',
  '"/project/get/participants"',
  '"/project/get/questions"',
  "createAuthorizationHeader",
  'redirect: "error"'
]) {
  assert(
    connectionAdapter.includes(required),
    `Scoutnet-adaptern saknar det låsta transportkontraktet: ${required}`
  );
}
assert(
  connectionHandler.includes('"question-catalogue"')
    && connectionHandler.includes('"participant-snapshot"')
    && connectionHandler.includes("validateScoutnetQuestionMappingAgainstCatalogue"),
  "Scoutnet-handlern måste avgränsa katalog, snapshot och bekräftad frågemappning."
);
assert(
  connectionAdapter.includes("crypto.subtle")
    && connectionAdapter.includes('"HMAC"')
    && connectionAdapter.includes('"SHA-256"')
    && connectionAdapter.includes("scoutnet:v1:")
    && connectionFunction.includes("SCOUTNET_SOURCE_REFERENCE_SECRET"),
  "Scoutnet-adaptern måste skapa serverhemliga HMAC-referenser."
);
assert(
  !connectionAdapter.includes("console.")
    && !connectionHandler.includes("console.")
    && !connectionFunction.includes("console."),
  "Scoutnet-adaptern får inte logga nycklar, råsvar eller deltagardata."
);
assert(
  lockfile.includes(`'@scouterna/scoutnet@${CLIENT_VERSION}':`)
    && lockfile.includes(`'@scouterna/scoutnet-openapi@${OPENAPI_VERSION}':`)
    && lockfile.includes(`specifier: ${CLIENT_VERSION}`)
    && lockfile.includes(`specifier: ${OPENAPI_VERSION}`),
  "pnpm-låsfilen saknar de exakta Scoutnet-versionerna."
);

for (const required of [
  `version: ${OPENAPI_VERSION}`,
  "url: https://scoutnet.se/api",
  "type: http",
  "scheme: basic",
  "/project/get/participants:",
  "/project/get/questions:"
]) {
  assert(
    openApiSchema.includes(required),
    `Det installerade OpenAPI-schemat saknar: ${required}`
  );
}
assert(
  participantsSchema.includes("operationId: getProjectParticipants")
    && participantsSchema.includes("- object")
    && participantsSchema.includes("- array")
    && participantsSchema.includes("- 'null'"),
  "Participants-kontraktet saknar de dokumenterade objektsvarianterna."
);
assert(
  questionsSchema.includes("operationId: getProjectFormts")
    && questionsSchema.includes("name: form_id")
    && questionsSchema.includes("questions:"),
  "Questions-kontraktet avviker från den låsta operationen."
);
assert(
  /empty array instead of an\s+object/.test(clientReadme),
  "Den officiella klientens dokumenterade tom-map-quirk saknas."
);

assert(manifest.dataClassification === "synthetic-only", "Fixtures måste vara uttryckligen syntetiska.");
assert(
  manifest.contract.clientVersion === CLIENT_VERSION
    && manifest.contract.openApiVersion === OPENAPI_VERSION
    && manifest.contract.baseUrl === "https://scoutnet.se/api",
  "Fixturemanifestet matchar inte det låsta officiella kontraktet."
);
assert(
  JSON.stringify(manifest.questionCases) === JSON.stringify([
    "object",
    "emptyArray",
    "null"
  ])
    && JSON.stringify(manifest.participantCases) === JSON.stringify([
      "object",
      "emptyArray",
      "null"
    ]),
  "Fixturemanifestet saknar object/array/null-varianter."
);

assert(
  Object.keys(questions.object.questions ?? {}).length === 6
    && Array.isArray(questions.emptyArray.questions)
    && questions.emptyArray.questions.length === 0
    && questions.null.questions === null,
  "Questions-fixturen täcker inte de tre svarssätten."
);
assert(
  Object.keys(participants.object.participants ?? {}).length === 7
    && Array.isArray(participants.emptyArray.participants)
    && participants.emptyArray.participants.length === 0
    && participants.null.participants === null,
  "Participants-fixturen täcker inte de tre svarssätten."
);

const participantMap = participants.object.participants;
for (const [scenario, participantId] of Object.entries(
  manifest.participantScenarios
)) {
  assert(
    participantMap?.[participantId],
    `Participants-fixturen saknar scenariot ${scenario}.`
  );
}
assert(
  participantMap[manifest.participantScenarios.cancelled].cancelled === true,
  "Avbokad deltagare saknas."
);
assert(
  participantMap[manifest.participantScenarios.unconfirmed].confirmed === false,
  "Obekräftad deltagare saknas."
);
assert(
  Array.isArray(
    participantMap[manifest.participantScenarios.groupFallback]
      .primary_membership_info
  ),
  "Gruppfallback utan primärt medlemskap saknas."
);
assert(
  participantMap[manifest.participantScenarios.groupPrecedence]
    .primary_membership_info.group_name
    !== participantMap[manifest.participantScenarios.groupPrecedence]
      .group_registration_info.group_name,
  "Fixture för prioritering av group_registration_info saknas."
);
assert(
  ["1101", "1102", "1103", "1104"].every((questionId) =>
    participantMap[manifest.participantScenarios.multipleAttendanceIntervals]
      .questions[questionId]
  ),
  "Två närvarointervall saknas."
);
assert(
  participantMap[manifest.participantScenarios.specialDiet].questions["1201"],
  "Syntetisk specialkost saknas."
);

assert(
  JSON.stringify(httpResponses.map(({ id }) => id))
    === JSON.stringify(manifest.httpCases),
  "HTTP-fixturerna matchar inte manifestet."
);
assert(
  httpResponses.some(({ status, rawBody }) => status === 401 && rawBody === "")
    && httpResponses.some(({ status, retryAfter }) =>
      status === 429 && retryAfter === "60"
    )
    && httpResponses.some(({ status, rawBody }) =>
      status === 200 && rawBody === "{}"
    )
    && httpResponses.some(({ status, rawBody }) =>
      status === 200 && rawBody === '{"participants":'
    ),
  "HTTP-fixturerna saknar fel, 429, oväntat tomt eller trasigt svar."
);

const fixtureContents = JSON.stringify({
  manifest,
  questions,
  participants,
  httpResponses
});
assert(
  !/"(?:ssno|primary_email|contact_info)"\s*:/.test(fixtureContents)
    && !/\b\d{8}[-+]\d{4}\b/.test(fixtureContents)
    && !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(fixtureContents),
  "Scoutnet-fixturerna får inte innehålla kontaktdata eller personnummer."
);

console.log(
  `Scoutnet-kontrakt verifierat: klient ${CLIENT_VERSION}, `
  + `OpenAPI ${OPENAPI_VERSION}, 3+3 svarssätt och 5 transportfel.`
);
