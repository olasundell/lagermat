import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createScoutnetConnectionHandler,
  createScoutnetCredentialProbe,
  isScoutnetQuestionMapping,
  SCOUTNET_CONNECTION_API_BASE_URL,
  SCOUTNET_CONNECTION_PARTICIPANTS_PATH,
  SCOUTNET_CONNECTION_QUESTIONS_PATH,
  ScoutnetAuthorisationError,
  ScoutnetCredentialProbeError,
  type AuthenticatedScoutnetUser,
  type ScoutnetAdapterServerContext,
  type ScoutnetConnectionHandlerDependencies,
  type ScoutnetConnectionStatus,
  type ScoutnetReconciliationApplyResult,
} from "../supabase/functions/scoutnet-connection/handler.ts";
import {
  ScoutnetProjectFetchError,
  type ScoutnetParticipantSnapshot,
} from "../supabase/functions/scoutnet-connection/adapter.ts";
import type {
  ScoutnetReconciliationContext,
} from "../supabase/functions/scoutnet-connection/reconciliation.ts";
import {
  SCOUTNET_API_BASE_URL,
  SCOUTNET_PARTICIPANTS_PATH,
  SCOUTNET_QUESTIONS_PATH,
} from "./scoutnetContract.ts";

const appOrigin = "http://127.0.0.1:5174";
const userId = "11111111-1111-1111-1111-111111111111";
const campId = "caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const accessToken = "header.payload.signature";
const participantsApiKey = "synthetic-participants-key";
const questionsApiKey = "synthetic-questions-key";
const sourceReferenceSecret =
  "synthetic-source-reference-secret-with-more-than-32-bytes";

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        `server/fixtures/scoutnet/v0.4.1/${name}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, Record<string, unknown>>["object"];
}

const questionFixture = fixture("questions").object as Record<string, unknown>;
const participantFixture = fixture("participants").object as Record<
  string,
  unknown
>;

const aal2User: AuthenticatedScoutnetUser = {
  id: userId,
  assuranceLevel: "aal2",
};

const connectedStatus: ScoutnetConnectionStatus = {
  campId,
  connected: true,
  projectId: "7701",
  hasParticipantsApiKey: true,
  hasQuestionsApiKey: true,
  questionMapping: {},
  connectedAt: "2026-07-30T20:00:00.000Z",
  credentialsRotatedAt: null,
  questionMappingUpdatedAt: null,
  lastSuccessfulSyncAt: null,
  lastSuccessfulSyncParticipantCount: null,
};

const disconnectedStatus: ScoutnetConnectionStatus = {
  campId,
  connected: false,
  projectId: null,
  hasParticipantsApiKey: false,
  hasQuestionsApiKey: false,
  questionMapping: {},
  connectedAt: null,
  credentialsRotatedAt: null,
  questionMappingUpdatedAt: null,
  lastSuccessfulSyncAt: null,
  lastSuccessfulSyncParticipantCount: null,
};

const adapterContext: ScoutnetAdapterServerContext = {
  organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
  projectId: "7701",
  participantsApiKey,
  questionsApiKey,
  startsOn: "2026-08-02",
  endsOn: "2026-08-05",
  timezone: "Europe/Stockholm",
  questionMapping: {
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
  },
};

const reconciliationSnapshot: ScoutnetParticipantSnapshot = {
  complete: true,
  participantCount: 1,
  participants: [{
    sourceReference: `scoutnet:v1:${"a".repeat(43)}`,
    displayName: "Syntetisk avstämningsperson",
    registrationStatus: "confirmed",
    group: {
      reference: `scoutnet:v1:${"g".repeat(43)}`,
      name: "Syntetläger",
    },
    division: {
      reference: `scoutnet:v1:${"d".repeat(43)}`,
      name: "Syntetdivision",
    },
    patrol: {
      reference: `scoutnet:v1:${"p".repeat(43)}`,
      name: "Syntetpatrull",
    },
    attendance: [{
      startsAt: "2026-08-02T06:00:00.000Z",
      endsAt: "2026-08-05T18:00:00.000Z",
    }],
    attendanceWarnings: [],
    specialDiet: ["Syntetisk kostuppgift"],
  }],
};

const reconciliationContext: ScoutnetReconciliationContext = {
  campId,
  stateDigest: "b".repeat(64),
  participants: [],
};

const reconciliationResult: ScoutnetReconciliationApplyResult = {
  campId,
  stateDigest: "c".repeat(64),
  appliedAt: "2026-07-31T10:00:00.000Z",
  snapshotParticipantCount: 1,
  counts: {
    created: 1,
    linked: 0,
    updated: 0,
    reactivated: 0,
    withdrawn: 0,
    skipped: 0,
  },
};

interface RequestOptions {
  method?: string;
  origin?: string | null;
  authorization?: string | null;
  contentType?: string | null;
  body?: unknown;
  rawBody?: string;
  headers?: HeadersInit;
}

function connectionRequest(options: RequestOptions = {}): Request {
  const method = options.method ?? "POST";
  const headers = new Headers(options.headers);
  if (options.origin !== null) {
    headers.set("Origin", options.origin ?? appOrigin);
  }
  if (options.authorization !== null) {
    headers.set(
      "Authorization",
      options.authorization ?? `Bearer ${accessToken}`,
    );
  }
  if (options.contentType !== null) {
    headers.set("Content-Type", options.contentType ?? "application/json");
  }

  const mayHaveBody = method !== "GET" && method !== "HEAD";
  return new Request(`${appOrigin}/functions/v1/scoutnet-connection`, {
    method,
    headers,
    body: mayHaveBody
      ? options.rawBody
        ?? JSON.stringify(
          options.body ?? { action: "status", campId },
        )
      : undefined,
  });
}

function subject(
  overrides: Partial<ScoutnetConnectionHandlerDependencies> & {
    user?: AuthenticatedScoutnetUser | null;
  } = {},
) {
  const authenticate = overrides.authenticate
    ?? vi.fn(async () => overrides.user === undefined ? aal2User : overrides.user);
  const getStatus = overrides.getStatus
    ?? vi.fn(async () => connectedStatus);
  const getAdapterContext = overrides.getAdapterContext
    ?? vi.fn(async () => adapterContext);
  const getReconciliationContext = overrides.getReconciliationContext
    ?? vi.fn(async () => reconciliationContext);
  const getReconciliationSnapshot = overrides.getReconciliationSnapshot
    ?? vi.fn(async () => reconciliationSnapshot);
  const getSourceReferenceSecret = overrides.getSourceReferenceSecret
    ?? (() => sourceReferenceSecret);
  const fetchProjectResource = overrides.fetchProjectResource
    ?? vi.fn(async ({ endpoint }) =>
      endpoint === "questions" ? questionFixture : participantFixture
    );
  const probeCredential = overrides.probeCredential
    ?? vi.fn(async () => undefined);
  const connect = overrides.connect
    ?? vi.fn(async () => connectedStatus);
  const rotate = overrides.rotate
    ?? vi.fn(async () => ({
      ...connectedStatus,
      credentialsRotatedAt: "2026-07-30T20:05:00.000Z",
    }));
  const updateQuestionMapping = overrides.updateQuestionMapping
    ?? vi.fn(async (input) => ({
      ...connectedStatus,
      questionMapping: input.questionMapping,
      questionMappingUpdatedAt: "2026-07-30T20:06:00.000Z",
    }));
  const disconnect = overrides.disconnect
    ?? vi.fn(async () => disconnectedStatus);
  const applyReconciliation = overrides.applyReconciliation
    ?? vi.fn(async () => reconciliationResult);

  const handler = createScoutnetConnectionHandler({
    getEnvironment: overrides.getEnvironment
      ?? (() => ({ appOrigin })),
    authenticate,
    getStatus,
    getAdapterContext,
    getReconciliationContext,
    getReconciliationSnapshot,
    getSourceReferenceSecret,
    fetchProjectResource,
    probeCredential,
    connect,
    rotate,
    updateQuestionMapping,
    disconnect,
    applyReconciliation,
  });
  return {
    handler,
    authenticate,
    getStatus,
    getAdapterContext,
    getReconciliationContext,
    getReconciliationSnapshot,
    fetchProjectResource,
    probeCredential,
    connect,
    rotate,
    updateQuestionMapping,
    disconnect,
    applyReconciliation,
  };
}

async function errorCode(response: Response): Promise<string> {
  const body = await response.json() as { error: { code: string } };
  return body.error.code;
}

describe("Scoutnet connection transport boundary", () => {
  it("uses the exact locked official origin and paths", () => {
    expect(SCOUTNET_CONNECTION_API_BASE_URL).toBe(SCOUTNET_API_BASE_URL);
    expect(SCOUTNET_CONNECTION_PARTICIPANTS_PATH).toBe(
      SCOUTNET_PARTICIPANTS_PATH,
    );
    expect(SCOUTNET_CONNECTION_QUESTIONS_PATH).toBe(
      SCOUTNET_QUESTIONS_PATH,
    );
  });

  it("accepts only the configured exact Origin and never emits a wildcard", async () => {
    const connection = subject();
    const missing = await connection.handler(
      connectionRequest({ origin: null }),
    );
    const wrong = await connection.handler(
      connectionRequest({ origin: "https://attacker.invalid" }),
    );

    expect(missing.status).toBe(403);
    expect(wrong.status).toBe(403);
    expect(missing.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(wrong.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(wrong.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    expect(connection.authenticate).not.toHaveBeenCalled();
  });

  it("answers the allowed preflight without authentication", async () => {
    const connection = subject();
    const response = await connection.handler(connectionRequest({
      method: "OPTIONS",
      authorization: null,
      contentType: null,
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(appOrigin);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(connection.authenticate).not.toHaveBeenCalled();
  });

  it("requires a bounded Bearer session and strict JSON body", async () => {
    const connection = subject();
    const noSession = await connection.handler(connectionRequest({
      authorization: null,
    }));
    const extraField = await connection.handler(connectionRequest({
      body: { action: "status", campId, apiKey: "must-not-be-accepted" },
    }));
    const oversized = await connection.handler(connectionRequest({
      headers: { "Content-Length": "2000001" },
    }));

    expect(noSession.status).toBe(401);
    expect(await errorCode(noSession)).toBe("authentication_required");
    expect(extraField.status).toBe(400);
    expect(oversized.status).toBe(400);
    expect(connection.authenticate).not.toHaveBeenCalled();
  });

  it("permits an authenticated AAL1 status read but gates every mutation at AAL2", async () => {
    const connection = subject({
      user: { ...aal2User, assuranceLevel: "aal1" },
    });

    const status = await connection.handler(connectionRequest());
    const mutation = await connection.handler(connectionRequest({
      body: {
        action: "connect",
        campId,
        projectId: "7701",
        participantsApiKey,
        questionsApiKey,
      },
    }));

    expect(status.status).toBe(200);
    expect(mutation.status).toBe(403);
    expect(await errorCode(mutation)).toBe("aal2_required");
    expect(connection.probeCredential).not.toHaveBeenCalled();
    expect(connection.connect).not.toHaveBeenCalled();
  });
});

describe("Scoutnet minimised Project API reads", () => {
  it("lets an authenticated admin inspect only the bounded question catalogue", async () => {
    const connection = subject({
      user: { ...aal2User, assuranceLevel: "aal1" },
    });
    const response = await connection.handler(connectionRequest({
      body: { action: "question-catalogue", campId },
    }));
    const body = await response.json();
    const serialised = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(connection.getStatus).toHaveBeenCalledWith(userId, campId);
    expect(connection.getAdapterContext).toHaveBeenCalledWith(userId, campId);
    expect(connection.fetchProjectResource).toHaveBeenCalledOnce();
    expect(connection.fetchProjectResource).toHaveBeenCalledWith({
      projectId: "7701",
      endpoint: "questions",
      apiKey: questionsApiKey,
    });
    expect(body).toEqual(expect.objectContaining({
      campId,
      questions: expect.any(Array),
      suggestions: expect.any(Array),
      mappingValid: true,
    }));
    expect(serialised).not.toMatch(
      /forms|tabs|sections|messages|endpoint_url|synthetic-questions-key/,
    );
  });

  it("requires an explicit admin check before loading or returning a participant snapshot", async () => {
    const connection = subject({
      user: { ...aal2User, assuranceLevel: "aal1" },
    });
    const response = await connection.handler(connectionRequest({
      body: { action: "participant-snapshot", campId },
    }));
    const body = await response.json();
    const serialised = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(connection.getStatus).toHaveBeenCalledWith(userId, campId);
    expect(
      vi.mocked(connection.getStatus).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(connection.getAdapterContext).mock.invocationCallOrder[0]!,
    );
    expect(body).toMatchObject({
      campId,
      complete: true,
      participantCount: 7,
    });
    expect(serialised).not.toMatch(
      /99000[1-7]|member_no|ssno|primary_email|contact_info/,
    );
  });

  it("does not fetch any Scoutnet resource when the actor is not an admin", async () => {
    const connection = subject({
      getStatus: vi.fn(async () => {
        throw new ScoutnetAuthorisationError();
      }),
    });
    const response = await connection.handler(connectionRequest({
      body: { action: "participant-snapshot", campId },
    }));

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("forbidden");
    expect(connection.getAdapterContext).not.toHaveBeenCalled();
    expect(connection.fetchProjectResource).not.toHaveBeenCalled();
  });

  it("validates saved mapping before fetching the participant endpoint", async () => {
    const connection = subject({
      getAdapterContext: vi.fn(async () => ({
        ...adapterContext,
        questionMapping: {},
      })),
    });
    const response = await connection.handler(connectionRequest({
      body: { action: "participant-snapshot", campId },
    }));

    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("question_mapping_required");
    expect(connection.fetchProjectResource).toHaveBeenCalledOnce();
    expect(connection.fetchProjectResource).toHaveBeenCalledWith({
      projectId: "7701",
      endpoint: "questions",
      apiKey: questionsApiKey,
    });
  });

  it("keeps bounded retry metadata while discarding upstream error bodies", async () => {
    const connection = subject({
      fetchProjectResource: vi.fn(async () => {
        throw new ScoutnetProjectFetchError("rate_limited", 60);
      }),
    });
    const response = await connection.handler(connectionRequest({
      body: { action: "question-catalogue", campId },
    }));
    const serialised = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(JSON.parse(serialised).error.code).toBe(
      "scoutnet_rate_limited",
    );
    expect(serialised).not.toContain("synthetic");
  });
});

describe("Scoutnet local reconciliation route", () => {
  it("returns a rebuilt minimised diff after the admin and local-state checks", async () => {
    const connection = subject({
      user: { ...aal2User, assuranceLevel: "aal1" },
    });
    const response = await connection.handler(connectionRequest({
      body: { action: "reconciliation-preview", campId },
    }));
    const body = await response.json();
    const serialised = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      campId,
      complete: true,
      snapshotSource: "local_fixture",
      snapshotParticipantCount: 1,
      stateDigest: "b".repeat(64),
      previewDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      counts: { new: 1 },
      rows: [{
        sourceReference: reconciliationSnapshot.participants[0]!
          .sourceReference,
        category: "new",
        proposedAction: "create",
      }],
    });
    expect(
      vi.mocked(connection.getStatus).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(
        connection.getReconciliationContext,
      ).mock.invocationCallOrder[0]!,
    );
    expect(
      vi.mocked(
        connection.getReconciliationContext,
      ).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(
        connection.getReconciliationSnapshot,
      ).mock.invocationCallOrder[0]!,
    );
    expect(connection.fetchProjectResource).not.toHaveBeenCalled();
    expect(serialised).not.toContain("Syntetisk kostuppgift");
    expect(serialised).not.toMatch(/"participants"|"snapshot"/);
  });

  it("allows an authenticated AAL1 administrator to apply a reviewed diff", async () => {
    const connection = subject({
      user: { ...aal2User, assuranceLevel: "aal1" },
    });
    const previewResponse = await connection.handler(connectionRequest({
      body: { action: "reconciliation-preview", campId },
    }));
    const preview = await previewResponse.json() as {
      stateDigest: string;
      previewDigest: string;
    };
    const response = await connection.handler(connectionRequest({
      body: {
        action: "reconciliation-apply",
        campId,
        stateDigest: preview.stateDigest,
        previewDigest: preview.previewDigest,
        idempotencyKey: "86000000-0000-0000-0000-000000000001",
        decisions: [{
          sourceReference:
            reconciliationSnapshot.participants[0]!.sourceReference,
          action: "apply",
        }],
      },
    }));

    expect(response.status).toBe(200);
    expect(connection.applyReconciliation).toHaveBeenCalledOnce();
  });

  it("rebuilds the preview and sends only the server fixture to the service RPC", async () => {
    const connection = subject();
    const previewResponse = await connection.handler(connectionRequest({
      body: { action: "reconciliation-preview", campId },
    }));
    const preview = await previewResponse.json() as {
      stateDigest: string;
      previewDigest: string;
    };
    const decisions = [{
      sourceReference:
        reconciliationSnapshot.participants[0]!.sourceReference,
      action: "apply" as const,
    }];

    const response = await connection.handler(connectionRequest({
      body: {
        action: "reconciliation-apply",
        campId,
        stateDigest: preview.stateDigest,
        previewDigest: preview.previewDigest,
        idempotencyKey: "86000000-0000-0000-0000-000000000002",
        decisions,
      },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(reconciliationResult);
    expect(connection.applyReconciliation).toHaveBeenCalledWith({
      actorUserId: userId,
      campId,
      snapshot: reconciliationSnapshot,
      decisions,
      expectedStateDigest: "b".repeat(64),
      idempotencyKey: "86000000-0000-0000-0000-000000000002",
    });
    expect(connection.fetchProjectResource).not.toHaveBeenCalled();
  });

  it("rejects stale local state before loading a fixture or applying anything", async () => {
    const connection = subject({
      getReconciliationContext: vi.fn(async () => ({
        ...reconciliationContext,
        stateDigest: "c".repeat(64),
      })),
    });
    const response = await connection.handler(connectionRequest({
      body: {
        action: "reconciliation-apply",
        campId,
        stateDigest: "b".repeat(64),
        previewDigest: "d".repeat(64),
        idempotencyKey: "86000000-0000-0000-0000-000000000003",
        decisions: [{
          sourceReference:
            reconciliationSnapshot.participants[0]!.sourceReference,
          action: "apply",
        }],
      },
    }));

    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("reconciliation_stale");
    expect(connection.getReconciliationSnapshot).not.toHaveBeenCalled();
    expect(connection.applyReconciliation).not.toHaveBeenCalled();
  });

  it("rejects a client-invented link target after rebuilding the diff", async () => {
    const connection = subject();
    const previewResponse = await connection.handler(connectionRequest({
      body: { action: "reconciliation-preview", campId },
    }));
    const preview = await previewResponse.json() as {
      stateDigest: string;
      previewDigest: string;
    };
    const response = await connection.handler(connectionRequest({
      body: {
        action: "reconciliation-apply",
        campId,
        stateDigest: preview.stateDigest,
        previewDigest: preview.previewDigest,
        idempotencyKey: "86000000-0000-0000-0000-000000000004",
        decisions: [{
          sourceReference:
            reconciliationSnapshot.participants[0]!.sourceReference,
          action: "link",
          participantId: "81000000-0000-0000-0000-000000000001",
        }],
      },
    }));

    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("reconciliation_stale");
    expect(connection.applyReconciliation).not.toHaveBeenCalled();
  });
});

describe("Scoutnet connection mutation flow", () => {
  it("verifies both distinct endpoint keys before storing a connection", async () => {
    const connection = subject();
    const response = await connection.handler(connectionRequest({
      body: {
        action: "connect",
        campId,
        projectId: "7701",
        participantsApiKey,
        questionsApiKey,
      },
    }));
    const serialised = await response.text();

    expect(response.status).toBe(200);
    expect(connection.probeCredential).toHaveBeenCalledTimes(2);
    expect(connection.probeCredential).toHaveBeenCalledWith({
      projectId: "7701",
      endpoint: "participants",
      apiKey: participantsApiKey,
    });
    expect(connection.probeCredential).toHaveBeenCalledWith({
      projectId: "7701",
      endpoint: "questions",
      apiKey: questionsApiKey,
    });
    expect(connection.connect).toHaveBeenCalledWith({
      actorUserId: userId,
      assuranceLevel: "aal2",
      campId,
      projectId: "7701",
      participantsApiKey,
      questionsApiKey,
    });
    expect(serialised).not.toContain(participantsApiKey);
    expect(serialised).not.toContain(questionsApiKey);
    expect(serialised).not.toMatch(
      /"(?:participants|questions)(?:SecretId|ApiKey)":/i,
    );
  });

  it("never persists credentials rejected by Scoutnet or reflects them in errors", async () => {
    const connection = subject({
      probeCredential: vi.fn(async ({ endpoint }) => {
        if (endpoint === "questions") {
          throw new ScoutnetCredentialProbeError("rejected");
        }
      }),
    });

    const response = await connection.handler(connectionRequest({
      body: {
        action: "connect",
        campId,
        projectId: "7701",
        participantsApiKey,
        questionsApiKey,
      },
    }));
    const serialised = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(serialised).error.code).toBe("credentials_rejected");
    expect(serialised).not.toContain(participantsApiKey);
    expect(serialised).not.toContain(questionsApiKey);
    expect(connection.connect).not.toHaveBeenCalled();
  });

  it("rotates one endpoint key against the existing project without retrieving the other key", async () => {
    const connection = subject();
    const replacement = "synthetic-participants-rotated";
    const response = await connection.handler(connectionRequest({
      body: {
        action: "rotate",
        campId,
        participantsApiKey: replacement,
      },
    }));

    expect(response.status).toBe(200);
    expect(connection.getStatus).toHaveBeenCalledWith(userId, campId);
    expect(connection.probeCredential).toHaveBeenCalledOnce();
    expect(connection.probeCredential).toHaveBeenCalledWith({
      projectId: "7701",
      endpoint: "participants",
      apiKey: replacement,
    });
    expect(connection.rotate).toHaveBeenCalledWith({
      actorUserId: userId,
      assuranceLevel: "aal2",
      campId,
      participantsApiKey: replacement,
    });
  });

  it("requires both endpoint keys when moving to a different project ID", async () => {
    const connection = subject();
    const response = await connection.handler(connectionRequest({
      body: {
        action: "rotate",
        campId,
        projectId: "8802",
        participantsApiKey: "synthetic-participants-new-project",
      },
    }));

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_request");
    expect(connection.probeCredential).not.toHaveBeenCalled();
    expect(connection.rotate).not.toHaveBeenCalled();
  });

  it("accepts only bounded question-ID mappings and sends no mapping data to audit-facing responses", async () => {
    const validMapping = {
      division_question_id: "1301",
      special_diet_question_id: "1201",
      attendance_intervals: [{
        starts_at_question_id: "1101",
        ends_at_question_id: "1102",
      }],
    };
    expect(isScoutnetQuestionMapping(validMapping)).toBe(true);
    expect(isScoutnetQuestionMapping({
      special_diet_question_id: "contains free text",
    })).toBe(false);
    expect(isScoutnetQuestionMapping({
      arbitrary_field: "1201",
    })).toBe(false);

    const connection = subject();
    const response = await connection.handler(connectionRequest({
      body: {
        action: "update-question-mapping",
        campId,
        questionMapping: validMapping,
      },
    }));

    expect(response.status).toBe(200);
    expect(connection.updateQuestionMapping).toHaveBeenCalledWith({
      actorUserId: userId,
      assuranceLevel: "aal2",
      campId,
      questionMapping: validMapping,
    });
  });

  it("rejects a stale question ID before persisting the confirmed mapping", async () => {
    const connection = subject();
    const response = await connection.handler(connectionRequest({
      body: {
        action: "update-question-mapping",
        campId,
        questionMapping: {
          special_diet_question_ids: ["9999"],
          attendance_intervals: [{
            starts_at_question_id: "1101",
            ends_at_question_id: "1102",
          }],
        },
      },
    }));

    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("question_mapping_required");
    expect(connection.updateQuestionMapping).not.toHaveBeenCalled();
  });

  it("disconnects through the AAL2/admin-mediated dependency and returns no identifiers for secrets", async () => {
    const connection = subject();
    const response = await connection.handler(connectionRequest({
      body: { action: "disconnect", campId },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(connection.disconnect).toHaveBeenCalledWith({
      actorUserId: userId,
      assuranceLevel: "aal2",
      campId,
    });
    expect(body).toEqual(disconnectedStatus);
    expect(JSON.stringify(body)).not.toMatch(/secret/i);
  });

  it("rebuilds the public status contract instead of forwarding extra backend fields", async () => {
    const connection = subject({
      getStatus: vi.fn(async () => ({
        ...connectedStatus,
        participantsApiKey,
        participantsSecretId: "must-not-leak",
      } as ScoutnetConnectionStatus)),
    });

    const response = await connection.handler(connectionRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(connectedStatus);
    expect(JSON.stringify(body)).not.toContain(participantsApiKey);
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
  });
});

describe("Scoutnet Basic Auth credential probe", () => {
  it("puts the project and endpoint key only in the Basic header on the locked HTTPS URL", async () => {
    const fetcher = vi.fn(
      async (
        _input: RequestInfo | URL,
        _init?: RequestInit,
      ) => {
        void _input;
        void _init;
        return new Response(
          JSON.stringify({ participants: {} }),
          { status: 200 },
        );
      },
    );
    const probe = createScoutnetCredentialProbe({ fetch: fetcher });

    await probe({
      projectId: "7701",
      endpoint: "participants",
      apiKey: participantsApiKey,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(
      `${SCOUTNET_API_BASE_URL}${SCOUTNET_PARTICIPANTS_PATH}`,
    );
    expect(String(url)).not.toContain(participantsApiKey);
    expect(init?.redirect).toBe("error");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe(
      `Basic ${btoa(`7701:${participantsApiKey}`)}`,
    );
  });

  it("classifies rejected credentials separately from retryable upstream failure", async () => {
    const rejected = createScoutnetCredentialProbe({
      fetch: vi.fn(async () => new Response(null, { status: 401 })),
    });
    const unavailable = createScoutnetCredentialProbe({
      fetch: vi.fn(async () => new Response(null, { status: 429 })),
    });

    await expect(rejected({
      projectId: "7701",
      endpoint: "questions",
      apiKey: questionsApiKey,
    })).rejects.toMatchObject({ kind: "rejected" });
    await expect(unavailable({
      projectId: "7701",
      endpoint: "questions",
      apiKey: questionsApiKey,
    })).rejects.toMatchObject({ kind: "unavailable" });
  });
});
