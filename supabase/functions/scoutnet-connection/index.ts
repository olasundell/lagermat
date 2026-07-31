import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  createScoutnetConnectionHandler,
  createScoutnetCredentialProbe,
  ScoutnetAuthorisationError,
  ScoutnetConnectionRequestError,
  ScoutnetReconciliationConflictError,
  scoutnetConnectionTransportGuard,
  type AuthenticatedScoutnetUser,
  type ScoutnetAdapterServerContext,
  type ScoutnetConnectionStatus,
  type ScoutnetReconciliationApplyResult,
} from "./handler.ts";
import {
  createScoutnetProjectFetcher,
  isScoutnetQuestionMapping,
  ScoutnetProjectAdapterError,
} from "./adapter.ts";
import type { ScoutnetReconciliationContext } from "./reconciliation.ts";
import {
  localSyntheticReconciliationSnapshot,
} from "./synthetic-reconciliation-fixture.ts";

interface RpcError {
  code?: string;
}

function assuranceLevelFromVerifiedJwt(
  accessToken: string,
): string | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const claims = JSON.parse(atob(base64)) as { aal?: unknown };
    return typeof claims.aal === "string" ? claims.aal : null;
  } catch {
    return null;
  }
}

function rpcFailure(
  error: RpcError,
  reconciliation = false,
): Error {
  if (error.code === "42501") return new ScoutnetAuthorisationError();
  if (
    reconciliation
    && (error.code === "23505" || error.code === "40001")
  ) {
    return new ScoutnetReconciliationConflictError();
  }
  if (error.code === "22023" || error.code === "23505") {
    return new ScoutnetConnectionRequestError();
  }
  return new Error("Scoutnet connection RPC failed");
}

function rpcStatus(data: unknown, error: RpcError | null): ScoutnetConnectionStatus {
  if (error) throw rpcFailure(error);
  return data as ScoutnetConnectionStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rpcAdapterContext(
  data: unknown,
  error: RpcError | null,
  expectedCampId: string,
): ScoutnetAdapterServerContext {
  if (error) throw rpcFailure(error);
  const rows = Array.isArray(data) ? data : [];
  const row = rows.length === 1 ? rows[0] : null;
  if (
    !isRecord(row)
    || typeof row.organization_id !== "string"
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
      row.organization_id,
    )
    || row.camp_id !== expectedCampId
    || typeof row.project_id !== "string"
    || !/^[0-9]{1,32}$/.test(row.project_id)
    || typeof row.participants_api_key !== "string"
    || typeof row.questions_api_key !== "string"
    || !isScoutnetQuestionMapping(row.question_mapping)
    || typeof row.starts_on !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.starts_on)
    || typeof row.ends_on !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.ends_on)
    || row.starts_on > row.ends_on
    || typeof row.timezone !== "string"
    || row.timezone.length === 0
    || row.timezone.length > 100
  ) {
    throw new Error("Scoutnet adapter context RPC failed");
  }
  return {
    organizationId: row.organization_id,
    projectId: row.project_id,
    participantsApiKey: row.participants_api_key,
    questionsApiKey: row.questions_api_key,
    questionMapping: row.question_mapping,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    timezone: row.timezone,
  };
}

function rpcReconciliationContext(
  data: unknown,
  error: RpcError | null,
  expectedCampId: string,
): ScoutnetReconciliationContext {
  if (error) throw rpcFailure(error);
  if (
    !isRecord(data)
    || data.campId !== expectedCampId
    || typeof data.stateDigest !== "string"
    || !/^[0-9a-f]{64}$/.test(data.stateDigest)
    || !Array.isArray(data.participants)
    || data.participants.length > 5_000
  ) {
    throw new Error("Scoutnet reconciliation context RPC failed");
  }
  return data as unknown as ScoutnetReconciliationContext;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value)
    && typeof value === "number"
    && value >= 0
    && value <= 5_000;
}

function rpcReconciliationResult(
  data: unknown,
  error: RpcError | null,
  expectedCampId: string,
): ScoutnetReconciliationApplyResult {
  if (error) throw rpcFailure(error, true);
  if (
    !isRecord(data)
    || data.campId !== expectedCampId
    || typeof data.stateDigest !== "string"
    || !/^[0-9a-f]{64}$/.test(data.stateDigest)
    || typeof data.appliedAt !== "string"
    || !Number.isFinite(Date.parse(data.appliedAt))
    || !nonNegativeInteger(data.snapshotParticipantCount)
    || !isRecord(data.counts)
    || !nonNegativeInteger(data.counts.created)
    || !nonNegativeInteger(data.counts.linked)
    || !nonNegativeInteger(data.counts.updated)
    || !nonNegativeInteger(data.counts.reactivated)
    || !nonNegativeInteger(data.counts.withdrawn)
    || !nonNegativeInteger(data.counts.skipped)
  ) {
    throw new Error("Scoutnet reconciliation apply RPC failed");
  }
  return {
    campId: data.campId,
    stateDigest: data.stateDigest,
    appliedAt: data.appliedAt,
    snapshotParticipantCount: data.snapshotParticipantCount,
    counts: {
      created: data.counts.created,
      linked: data.counts.linked,
      updated: data.counts.updated,
      reactivated: data.counts.reactivated,
      withdrawn: data.counts.withdrawn,
      skipped: data.counts.skipped,
    },
  };
}

function localReconciliationFixtureEnabled(): boolean {
  if (Deno.env.get("SCOUTNET_RECONCILIATION_MODE") !== "fixture") {
    return false;
  }
  try {
    const appOrigin = new URL(Deno.env.get("APP_ORIGIN") ?? "");
    return appOrigin.protocol === "http:"
      && (
        appOrigin.hostname === "127.0.0.1"
        || appOrigin.hostname === "localhost"
      );
  } catch {
    return false;
  }
}

const authenticatedFetch = withSupabase(
  { auth: "user" },
  async (request, context) => {
    const probeCredential = createScoutnetCredentialProbe();
    const fetchProjectResource = createScoutnetProjectFetcher();
    const handler = createScoutnetConnectionHandler({
      getEnvironment: () => ({
        appOrigin: Deno.env.get("APP_ORIGIN"),
      }),
      authenticate: async (
        accessToken,
      ): Promise<AuthenticatedScoutnetUser | null> => {
        // getUser verifies the token against Supabase Auth before the already
        // gateway-verified JWT claim is decoded for its AAL value.
        const { data, error } = await context.supabaseAdmin.auth.getUser(
          accessToken,
        );
        if (error || !data.user) return null;
        return {
          id: data.user.id,
          assuranceLevel: assuranceLevelFromVerifiedJwt(accessToken),
        };
      },
      getStatus: async (actorUserId, campId) => {
        const { data, error } = await context.supabaseAdmin.rpc(
          "get_scoutnet_connection_status",
          {
            p_actor_user_id: actorUserId,
            p_camp_id: campId,
          },
        );
        return rpcStatus(data, error);
      },
      getAdapterContext: async (actorUserId, campId) => {
        const { data, error } = await context.supabaseAdmin.rpc(
          "get_scoutnet_connection_credentials",
          {
            p_actor_user_id: actorUserId,
            p_camp_id: campId,
          },
        );
        return rpcAdapterContext(data, error, campId);
      },
      getReconciliationContext: async (actorUserId, campId) => {
        const { data, error } = await context.supabaseAdmin.rpc(
          "get_scoutnet_reconciliation_context",
          {
            p_actor_user_id: actorUserId,
            p_camp_id: campId,
          },
        );
        return rpcReconciliationContext(data, error, campId);
      },
      getReconciliationSnapshot: async () => {
        if (!localReconciliationFixtureEnabled()) {
          throw new ScoutnetProjectAdapterError(
            "invalid_context",
            "Live reconciliation snapshots are not enabled",
          );
        }
        return localSyntheticReconciliationSnapshot();
      },
      getSourceReferenceSecret: () =>
        Deno.env.get("SCOUTNET_SOURCE_REFERENCE_SECRET"),
      fetchProjectResource,
      probeCredential,
      connect: async (input) => {
        const { data, error } = await context.supabaseAdmin.rpc(
          "connect_scoutnet_project",
          {
            p_actor_user_id: input.actorUserId,
            p_actor_aal: input.assuranceLevel,
            p_camp_id: input.campId,
            p_project_id: input.projectId,
            p_participants_api_key: input.participantsApiKey,
            p_questions_api_key: input.questionsApiKey,
          },
        );
        return rpcStatus(data, error);
      },
      rotate: async (input) => {
        const { data, error } = await context.supabaseAdmin.rpc(
          "rotate_scoutnet_connection",
          {
            p_actor_user_id: input.actorUserId,
            p_actor_aal: input.assuranceLevel,
            p_camp_id: input.campId,
            p_project_id: input.projectId ?? null,
            p_participants_api_key: input.participantsApiKey ?? null,
            p_questions_api_key: input.questionsApiKey ?? null,
          },
        );
        return rpcStatus(data, error);
      },
      updateQuestionMapping: async (input) => {
        const { data, error } = await context.supabaseAdmin.rpc(
          "update_scoutnet_question_mapping",
          {
            p_actor_user_id: input.actorUserId,
            p_actor_aal: input.assuranceLevel,
            p_camp_id: input.campId,
            p_question_mapping: input.questionMapping,
          },
        );
        return rpcStatus(data, error);
      },
      disconnect: async (input) => {
        const { data, error } = await context.supabaseAdmin.rpc(
          "disconnect_scoutnet_project",
          {
            p_actor_user_id: input.actorUserId,
            p_actor_aal: input.assuranceLevel,
            p_camp_id: input.campId,
          },
        );
        return rpcStatus(data, error);
      },
      applyReconciliation: async (input) => {
        const { data, error } = await context.supabaseAdmin.rpc(
          "apply_scoutnet_reconciliation",
          {
            p_actor_user_id: input.actorUserId,
            p_camp_id: input.campId,
            p_snapshot: input.snapshot,
            p_decisions: input.decisions,
            p_expected_state_digest: input.expectedStateDigest,
            p_idempotency_key: input.idempotencyKey,
          },
        );
        return rpcReconciliationResult(data, error, input.campId);
      },
    });

    return handler(request);
  },
);

export default {
  fetch: async (request: Request): Promise<Response> => {
    const transportResponse = scoutnetConnectionTransportGuard(
      request,
      Deno.env.get("APP_ORIGIN"),
    );
    if (transportResponse) return transportResponse;
    return authenticatedFetch(request);
  },
};
