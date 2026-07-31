import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAuthorizationHeader } from "@scouterna/scoutnet";
import { describe, expect, it } from "vitest";
import {
  normaliseScoutnetMap,
  parseScoutnetJson,
  readRequiredScoutnetMap,
  SCOUTNET_API_BASE_URL,
  SCOUTNET_CLIENT_VERSION,
  SCOUTNET_OPENAPI_VERSION,
  SCOUTNET_PARTICIPANTS_PATH,
  SCOUTNET_QUESTIONS_PATH,
  ScoutnetContractError,
  type ScoutnetParticipantsResponse,
  type ScoutnetQuestionsResponse,
} from "./scoutnetContract";

interface Manifest {
  dataClassification: string;
  contract: {
    clientVersion: string;
    openApiVersion: string;
    baseUrl: string;
    endpoints: {
      participants: string;
      questions: string;
    };
  };
  questionCases: string[];
  participantCases: string[];
  participantScenarios: Record<string, string>;
  httpCases: string[];
}

interface ResponseVariants {
  object: Record<string, unknown>;
  emptyArray: Record<string, unknown>;
  null: Record<string, unknown>;
}

interface HttpFixture {
  id: string;
  endpoint: string;
  status: number;
  contentType: string | null;
  retryAfter: string | null;
  rawBody: string;
}

const fixtureRoot = resolve(
  process.cwd(),
  "server/fixtures/scoutnet/v0.4.1",
);

function readFixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(resolve(fixtureRoot, name), "utf8"),
  ) as T;
}

const manifest = readFixture<Manifest>("manifest.json");
const questions = readFixture<ResponseVariants>("questions.json");
const participants = readFixture<ResponseVariants>("participants.json");
const httpResponses = readFixture<HttpFixture[]>("http-responses.json");

function participant(id: string): Record<string, unknown> {
  const participantMap = readRequiredScoutnetMap(
    participants.object,
    "participants",
  );
  return normaliseScoutnetMap(participantMap[id], `participants.${id}`);
}

describe("Scoutnet Project API contract lock", () => {
  it("pins the official client, OpenAPI version, base URL and two read endpoints", () => {
    expect(manifest.dataClassification).toBe("synthetic-only");
    expect(manifest.contract).toMatchObject({
      clientVersion: SCOUTNET_CLIENT_VERSION,
      openApiVersion: SCOUTNET_OPENAPI_VERSION,
      baseUrl: SCOUTNET_API_BASE_URL,
      endpoints: {
        participants: SCOUTNET_PARTICIPANTS_PATH,
        questions: SCOUTNET_QUESTIONS_PATH,
      },
    });
  });

  it("uses the official resource-ID-as-username Basic Auth contract", () => {
    expect(
      createAuthorizationHeader({
        resourceId: "7701",
        key: "synthetic-endpoint-key",
      }),
    ).toBe(`Basic ${Buffer.from("7701:synthetic-endpoint-key").toString("base64")}`);
  });

  it("keeps the official response types available to downstream adapters", () => {
    const typedParticipants =
      participants.object as ScoutnetParticipantsResponse;
    const typedQuestions = questions.object as ScoutnetQuestionsResponse;

    expect(typedParticipants.participants).toBeDefined();
    expect(typedQuestions.questions).toBeDefined();
  });
});

describe("Scoutnet map quirks", () => {
  it.each([
    ["questions object", questions.object.questions, 6],
    ["questions empty array", questions.emptyArray.questions, 0],
    ["questions null", questions.null.questions, 0],
    ["participants object", participants.object.participants, 7],
    ["participants empty array", participants.emptyArray.participants, 0],
    ["participants null", participants.null.participants, 0],
  ])("normalises %s without inventing records", (_label, value, count) => {
    expect(Object.keys(normaliseScoutnetMap(value, "fixture")).length).toBe(
      count,
    );
  });

  it("rejects populated arrays and scalar values", () => {
    expect(() => normaliseScoutnetMap([{}], "participants")).toThrow(
      ScoutnetContractError,
    );
    expect(() => normaliseScoutnetMap("not-a-map", "questions")).toThrow(
      ScoutnetContractError,
    );
  });

  it("does not accept an unexpected empty object as a complete snapshot", () => {
    expect(() => readRequiredScoutnetMap({}, "participants")).toThrow(
      "missing the required participants field",
    );
  });
});

describe("synthetic participant scenarios", () => {
  it("covers cancelled and unconfirmed registrations separately", () => {
    const cancelled = participant(
      manifest.participantScenarios.cancelled ?? "",
    );
    const unconfirmed = participant(
      manifest.participantScenarios.unconfirmed ?? "",
    );

    expect(cancelled).toMatchObject({ cancelled: true, confirmed: true });
    expect(unconfirmed).toMatchObject({ cancelled: false, confirmed: false });
  });

  it("covers group-registration fallback when primary membership is empty", () => {
    const fallback = participant(
      manifest.participantScenarios.groupFallback ?? "",
    );

    expect(fallback.primary_membership_info).toEqual([]);
    expect(fallback.group_registration_info).toMatchObject({
      group_name: "Syntetiska gästkåren",
      patrol_name: "Gästpatrullen",
    });
  });

  it("covers group-registration precedence when both memberships exist", () => {
    const precedence = participant(
      manifest.participantScenarios.groupPrecedence ?? "",
    );

    expect(precedence.primary_membership_info).toMatchObject({
      group_name: "Primärkåren som inte ska användas",
    });
    expect(precedence.group_registration_info).toMatchObject({
      group_name: "Syntetiska projektkåren",
      patrol_name: "Projektpatrullen",
    });
  });

  it("covers two independent attendance intervals", () => {
    const multiple = participant(
      manifest.participantScenarios.multipleAttendanceIntervals ?? "",
    );
    const answers = normaliseScoutnetMap(
      multiple.questions,
      "participant.questions",
    );

    expect(["1101", "1102", "1103", "1104"].map((id) => answers[id]))
      .toEqual([
        "2026-08-02T08:00:00+02:00",
        "2026-08-03T12:00:00+02:00",
        "2026-08-04T08:00:00+02:00",
        "2026-08-05T18:00:00+02:00",
      ]);
  });

  it("covers synthetic special-diet free text without fixture contact data", () => {
    const specialDiet = participant(
      manifest.participantScenarios.specialDiet ?? "",
    );
    const answers = normaliseScoutnetMap(
      specialDiet.questions,
      "participant.questions",
    );
    const serialised = JSON.stringify(participants);

    expect(answers["1201"]).toBe(
      "Syntetiskt testvärde: gluten och mjölkprotein",
    );
    expect(serialised).not.toMatch(
      /"(?:ssno|primary_email|contact_info)"\s*:/,
    );
    expect(serialised).not.toMatch(/\b\d{8}[-+]\d{4}\b/);
    expect(serialised).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  });
});

describe("synthetic transport failures", () => {
  it("covers every required failure fixture", () => {
    expect(httpResponses.map(({ id }) => id)).toEqual(manifest.httpCases);
    expect(httpResponses.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "unauthorised-empty-body", status: 401 },
      { id: "rate-limited-json", status: 429 },
      { id: "unexpected-empty-object", status: 200 },
      { id: "malformed-json", status: 200 },
      { id: "server-error-html", status: 503 },
    ]);
  });

  it("keeps rate-limit retry metadata separate from the JSON body", () => {
    const rateLimit = httpResponses.find(
      ({ id }) => id === "rate-limited-json",
    );
    expect(rateLimit?.retryAfter).toBe("60");
    expect(parseScoutnetJson(rateLimit?.rawBody ?? "")).toEqual({
      error: "synthetic_rate_limit",
    });
  });

  it.each(["unauthorised-empty-body", "malformed-json", "server-error-html"])(
    "fails closed when parsing %s as JSON",
    (id) => {
      const response = httpResponses.find((item) => item.id === id);
      expect(() => parseScoutnetJson(response?.rawBody ?? "")).toThrow(
        ScoutnetContractError,
      );
    },
  );
});
