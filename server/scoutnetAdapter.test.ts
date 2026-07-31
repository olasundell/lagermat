import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildScoutnetParticipantSnapshot,
  buildScoutnetQuestionCatalogue,
  createScoutnetProjectFetcher,
  isCompleteScoutnetQuestionMapping,
  isScoutnetQuestionMapping,
  SCOUTNET_PROJECT_API_BASE_URL,
  SCOUTNET_PROJECT_PARTICIPANTS_PATH,
  ScoutnetProjectAdapterError,
  type ScoutnetProjectAdapterContext,
  type ScoutnetProjectFetcherOptions,
  validateScoutnetQuestionMappingAgainstCatalogue,
} from "../supabase/functions/scoutnet-connection/adapter.ts";

interface ResponseVariants {
  object: Record<string, unknown>;
  emptyArray: Record<string, unknown>;
  null: Record<string, unknown>;
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

const questionFixtures = readFixture<ResponseVariants>("questions.json");
const participantFixtures = readFixture<ResponseVariants>("participants.json");

const mapping = {
  division_question_id: "1301",
  special_diet_question_ids: ["1201"],
  attendance_intervals: [
    {
      starts_at_question_id: "1101",
      ends_at_question_id: "1102",
    },
    {
      starts_at_question_id: "1103",
      ends_at_question_id: "1104",
    },
  ],
};

const context: ScoutnetProjectAdapterContext = {
  organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
  projectId: "7701",
  startsOn: "2026-08-02",
  endsOn: "2026-08-05",
  timezone: "Europe/Stockholm",
  questionMapping: mapping,
  sourceReferenceSecret:
    "synthetic-source-reference-secret-with-more-than-32-bytes",
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("Scoutnet question catalogue and confirmed mapping", () => {
  it("returns only bounded question descriptors and deterministic suggestions", () => {
    const catalogue = buildScoutnetQuestionCatalogue(questionFixtures.object);

    expect(catalogue.questions).toHaveLength(6);
    expect(catalogue.questions[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^\d+$/),
      label: expect.any(String),
      description: expect.toSatisfy(
        (value: unknown) => value === null || typeof value === "string",
      ),
      type: expect.toSatisfy(
        (value: unknown) => value === null || typeof value === "string",
      ),
      choices: expect.any(Array),
    }));
    expect(JSON.stringify(catalogue)).not.toMatch(
      /endpoint_url|tab_id|section_id|default_value|messages/,
    );
    expect(catalogue.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        questionId: "1101",
        role: "attendance_start",
      }),
      expect.objectContaining({
        questionId: "1102",
        role: "attendance_end",
      }),
      expect.objectContaining({
        questionId: "1201",
        role: "special_diet",
      }),
      expect.objectContaining({
        questionId: "1301",
        role: "division",
      }),
    ]));
  });

  it.each([
    ["empty array", questionFixtures.emptyArray, 0],
    ["null", questionFixtures.null, 0],
  ])("accepts the documented %s map representation", (_label, raw, count) => {
    expect(buildScoutnetQuestionCatalogue(raw).questions).toHaveLength(count);
  });

  it("rejects missing maps, populated arrays and malformed records", () => {
    expect(() => buildScoutnetQuestionCatalogue({})).toThrow(
      ScoutnetProjectAdapterError,
    );
    expect(() => buildScoutnetQuestionCatalogue({
      questions: [{ question: "Unexpected" }],
    })).toThrow("must not be a populated array");
    expect(() => buildScoutnetQuestionCatalogue({
      questions: { "1001": { question: 42 } },
    })).toThrow("questions.1001.question is invalid");
  });

  it("requires a complete, unique mapping whose IDs exist in the catalogue", () => {
    const catalogue = buildScoutnetQuestionCatalogue(questionFixtures.object);

    expect(isScoutnetQuestionMapping(mapping)).toBe(true);
    expect(isCompleteScoutnetQuestionMapping(mapping)).toBe(true);
    expect(() =>
      validateScoutnetQuestionMappingAgainstCatalogue(mapping, catalogue, {
        startsOn: context.startsOn,
        endsOn: context.endsOn,
      })
    ).not.toThrow();
    expect(isCompleteScoutnetQuestionMapping({
      special_diet_question_ids: ["1201"],
    })).toBe(false);
    expect(isScoutnetQuestionMapping({
      special_diet_question_ids: ["1201", "1201"],
      attendance_intervals: mapping.attendance_intervals,
    })).toBe(false);
    expect(() =>
      validateScoutnetQuestionMappingAgainstCatalogue({
        special_diet_question_ids: ["9999"],
        attendance_intervals: mapping.attendance_intervals,
      }, catalogue)
    ).toThrow("unavailable question");
  });

  it("supports explicit selected-day mappings and rejects dates outside camp", () => {
    const catalogue = buildScoutnetQuestionCatalogue(questionFixtures.object);
    const dayMapping = {
      special_diet_question_ids: ["1201"],
      attendance_days: [
        { question_id: "1101", date: "2026-08-02" },
        { question_id: "1103", date: "2026-08-04" },
      ],
    };

    expect(isCompleteScoutnetQuestionMapping(dayMapping)).toBe(true);
    expect(() =>
      validateScoutnetQuestionMappingAgainstCatalogue(dayMapping, catalogue, {
        startsOn: "2026-08-02",
        endsOn: "2026-08-05",
      })
    ).not.toThrow();
    expect(() =>
      validateScoutnetQuestionMappingAgainstCatalogue({
        ...dayMapping,
        attendance_days: [
          { question_id: "1101", date: "2026-08-01" },
        ],
      }, catalogue, {
        startsOn: "2026-08-02",
        endsOn: "2026-08-05",
      })
    ).toThrow("outside the camp");
  });
});

describe("Scoutnet participant snapshot minimisation", () => {
  it("validates the complete fixture before returning an allow-listed preview", async () => {
    const raw = clone(participantFixtures.object);
    const participants = raw.participants as Record<
      string,
      Record<string, unknown>
    >;
    participants["990001"]!.ssno = "must-never-leave-the-adapter";
    participants["990001"]!.primary_email = "discarded@example.invalid";
    participants["990001"]!.contact_info = {
      phone: "must-never-leave-the-adapter",
    };
    participants["990001"]!.questions = {
      ...(participants["990001"]!.questions as Record<string, unknown>),
      "1999": "unmapped answer must be discarded",
    };

    const snapshot = await buildScoutnetParticipantSnapshot(
      raw,
      questionFixtures.object,
      context,
    );
    const serialised = JSON.stringify(snapshot);

    expect(snapshot.complete).toBe(true);
    expect(snapshot.participantCount).toBe(7);
    expect(snapshot.participants).toHaveLength(7);
    expect(snapshot.participants.every((participant) =>
      participant.sourceReference.startsWith("scoutnet:v1:")
    )).toBe(true);
    expect(serialised).not.toMatch(
      /99000[1-7]|member_no|ssno|primary_email|contact_info|1999|unmapped answer/,
    );
    expect(Object.keys(snapshot.participants[0]!).sort()).toEqual([
      "attendance",
      "attendanceWarnings",
      "displayName",
      "division",
      "group",
      "patrol",
      "registrationStatus",
      "sourceReference",
      "specialDiet",
    ]);
  });

  it("keeps cancellation and confirmation distinct and prefers group-registration data", async () => {
    const snapshot = await buildScoutnetParticipantSnapshot(
      participantFixtures.object,
      questionFixtures.object,
      context,
    );
    const cancelled = snapshot.participants.find((participant) =>
      participant.displayName.endsWith("Avbokad")
    );
    const unconfirmed = snapshot.participants.find((participant) =>
      participant.displayName.endsWith("Obekräftad")
    );
    const groupFallback = snapshot.participants.find((participant) =>
      participant.displayName.endsWith("Gruppfallback")
    );
    const groupPrecedence = snapshot.participants.find((participant) =>
      participant.displayName.endsWith("Gruppprioritet")
    );

    expect(cancelled?.registrationStatus).toBe("cancelled");
    expect(unconfirmed?.registrationStatus).toBe("unconfirmed");
    expect(groupFallback?.group.name).toBe("Syntetiska gästkåren");
    expect(groupFallback?.patrol.name).toBe("Gästpatrullen");
    expect(groupFallback?.group.reference).toMatch(/^scoutnet:v1:/);
    expect(groupPrecedence?.group.name).toBe("Syntetiska projektkåren");
    expect(groupPrecedence?.patrol.name).toBe("Projektpatrullen");
    expect(groupPrecedence?.group.name).not.toContain("Primärkåren");
  });

  it("preserves two non-contiguous intervals and only mapped special diet", async () => {
    const snapshot = await buildScoutnetParticipantSnapshot(
      participantFixtures.object,
      questionFixtures.object,
      context,
    );
    const multiple = snapshot.participants.find((participant) =>
      participant.displayName.endsWith("Tvåintervall")
    );
    const specialDiet = snapshot.participants.find((participant) =>
      participant.displayName.endsWith("Specialkost")
    );

    expect(multiple?.attendance).toEqual([
      {
        startsAt: "2026-08-02T06:00:00.000Z",
        endsAt: "2026-08-03T10:00:00.000Z",
      },
      {
        startsAt: "2026-08-04T06:00:00.000Z",
        endsAt: "2026-08-05T16:00:00.000Z",
      },
    ]);
    expect(multiple?.attendanceWarnings).toEqual([]);
    expect(specialDiet?.specialDiet).toEqual([
      "Syntetiskt testvärde: gluten och mjölkprotein",
    ]);
  });

  it("falls back to the whole camp with a warning when an attendance answer is incomplete", async () => {
    const raw = clone(participantFixtures.object);
    const participants = raw.participants as Record<
      string,
      Record<string, unknown>
    >;
    const answers = participants["990001"]!.questions as Record<
      string,
      unknown
    >;
    delete answers["1102"];

    const snapshot = await buildScoutnetParticipantSnapshot(
      raw,
      questionFixtures.object,
      context,
    );
    const participant = snapshot.participants.find((candidate) =>
      candidate.displayName.endsWith("Alfa")
    );

    expect(participant?.attendance).toEqual([
      {
        startsAt: "2026-08-01T22:00:00.000Z",
        endsAt: "2026-08-05T22:00:00.000Z",
      },
    ]);
    expect(participant?.attendanceWarnings).toEqual([
      "attendance_answer_incomplete",
    ]);
  });

  it("groups selected days but keeps non-contiguous days as separate ranges", async () => {
    const snapshot = await buildScoutnetParticipantSnapshot(
      participantFixtures.object,
      questionFixtures.object,
      {
        ...context,
        questionMapping: {
          special_diet_question_ids: ["1201"],
          attendance_days: [
            { question_id: "1101", date: "2026-08-02" },
            { question_id: "1103", date: "2026-08-04" },
          ],
        },
      },
    );
    const multiple = snapshot.participants.find((participant) =>
      participant.displayName.endsWith("Tvåintervall")
    );

    expect(multiple?.attendance).toEqual([
      {
        startsAt: "2026-08-01T22:00:00.000Z",
        endsAt: "2026-08-02T22:00:00.000Z",
      },
      {
        startsAt: "2026-08-03T22:00:00.000Z",
        endsAt: "2026-08-04T22:00:00.000Z",
      },
    ]);
  });

  it("creates stable tenant-scoped HMAC references without exposing raw IDs", async () => {
    const first = await buildScoutnetParticipantSnapshot(
      participantFixtures.object,
      questionFixtures.object,
      context,
    );
    const second = await buildScoutnetParticipantSnapshot(
      participantFixtures.object,
      questionFixtures.object,
      context,
    );
    const otherTenant = await buildScoutnetParticipantSnapshot(
      participantFixtures.object,
      questionFixtures.object,
      {
        ...context,
        organizationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2",
      },
    );

    expect(first.participants[0]?.sourceReference).toBe(
      second.participants[0]?.sourceReference,
    );
    expect(first.participants[0]?.sourceReference).not.toBe(
      otherTenant.participants[0]?.sourceReference,
    );
    expect(first.participants[0]?.sourceReference).not.toContain("990001");
  });

  it("rejects the whole snapshot when any participant has an unexpected shape", async () => {
    const raw = clone(participantFixtures.object);
    const participants = raw.participants as Record<
      string,
      Record<string, unknown>
    >;
    participants["990006"]!.questions = [{ answer: "unexpected" }];

    await expect(buildScoutnetParticipantSnapshot(
      raw,
      questionFixtures.object,
      context,
    )).rejects.toThrow("must not be a populated array");
  });

  it.each([
    ["empty array", participantFixtures.emptyArray],
    ["null", participantFixtures.null],
  ])("accepts a documented complete empty snapshot represented as %s", async (
    _label,
    raw,
  ) => {
    const snapshot = await buildScoutnetParticipantSnapshot(
      raw,
      questionFixtures.object,
      context,
    );
    expect(snapshot).toEqual({
      complete: true,
      participantCount: 0,
      participants: [],
    });
  });
});

describe("Scoutnet bounded server transport", () => {
  it("uses only the locked HTTPS path and the official Basic header", async () => {
    const fetcher = vi.fn<
      NonNullable<ScoutnetProjectFetcherOptions["fetch"]>
    >(async () => new Response(
      JSON.stringify({ participants: {} }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    ));
    const request = createScoutnetProjectFetcher({ fetch: fetcher });

    await request({
      projectId: "7701",
      endpoint: "participants",
      apiKey: "synthetic-participants-key",
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(
      `${SCOUTNET_PROJECT_API_BASE_URL}${SCOUTNET_PROJECT_PARTICIPANTS_PATH}`,
    );
    expect(String(url)).not.toContain("synthetic-participants-key");
    expect(init).toBeDefined();
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Basic ${btoa("7701:synthetic-participants-key")}`,
    );
  });

  it("classifies auth, rate limit and invalid body failures without parsing error payloads", async () => {
    const rejected = createScoutnetProjectFetcher({
      fetch: vi.fn(async () => new Response(
        "secret upstream error",
        { status: 401 },
      )),
    });
    const rateLimited = createScoutnetProjectFetcher({
      fetch: vi.fn(async () => new Response(
        "secret upstream error",
        { status: 429, headers: { "Retry-After": "60" } },
      )),
    });
    const invalid = createScoutnetProjectFetcher({
      fetch: vi.fn(async () => new Response(
        "<html>not json</html>",
        { status: 200, headers: { "Content-Type": "text/html" } },
      )),
    });
    const input = {
      projectId: "7701",
      endpoint: "participants" as const,
      apiKey: "synthetic-participants-key",
    };

    await expect(rejected(input)).rejects.toMatchObject({ kind: "rejected" });
    await expect(rateLimited(input)).rejects.toMatchObject({
      kind: "rate_limited",
      retryAfterSeconds: 60,
    });
    await expect(invalid(input)).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("rejects malformed and oversized successful JSON responses", async () => {
    const malformed = createScoutnetProjectFetcher({
      fetch: vi.fn(async () => new Response(
        "{",
        { status: 200, headers: { "Content-Type": "application/json" } },
      )),
    });
    const oversized = createScoutnetProjectFetcher({
      fetch: vi.fn(async () => new Response(
        JSON.stringify({ participants: { value: "too large" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )),
      maxResponseBytes: 10,
    });
    const input = {
      projectId: "7701",
      endpoint: "participants" as const,
      apiKey: "synthetic-participants-key",
    };

    await expect(malformed(input)).rejects.toMatchObject({
      kind: "invalid_response",
    });
    await expect(oversized(input)).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });
});
