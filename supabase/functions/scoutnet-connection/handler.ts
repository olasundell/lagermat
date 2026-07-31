import { createAuthorizationHeader } from "@scouterna/scoutnet";
import {
  buildScoutnetParticipantSnapshot,
  buildScoutnetQuestionCatalogue,
  isScoutnetQuestionMapping,
  SCOUTNET_PROJECT_API_BASE_URL,
  SCOUTNET_PROJECT_PARTICIPANTS_PATH,
  SCOUTNET_PROJECT_QUESTIONS_PATH,
  ScoutnetProjectAdapterError,
  ScoutnetProjectFetchError,
  type ScoutnetProjectAdapterContext,
  type ScoutnetProjectFetchInput,
  type ScoutnetParticipantSnapshot,
  type ScoutnetQuestionMapping,
  validateScoutnetQuestionMappingAgainstCatalogue,
} from "./adapter.ts";
import {
  buildScoutnetReconciliationPreview,
  scoutnetReconciliationPreviewDigest,
  ScoutnetReconciliationError,
  type ScoutnetReconciliationContext,
  type ScoutnetReconciliationPreview,
} from "./reconciliation.ts";

export { isScoutnetQuestionMapping } from "./adapter.ts";
export type { ScoutnetQuestionMapping } from "./adapter.ts";

const REQUEST_BODY_LIMIT = 2_000_000;
const ACCESS_TOKEN_LIMIT = 8_192;
const API_KEY_LIMIT = 4_096;
const DEFAULT_TIMEOUT_MS = 8_000;

export const SCOUTNET_CONNECTION_API_BASE_URL = SCOUTNET_PROJECT_API_BASE_URL;
export const SCOUTNET_CONNECTION_PARTICIPANTS_PATH =
  SCOUTNET_PROJECT_PARTICIPANTS_PATH;
export const SCOUTNET_CONNECTION_QUESTIONS_PATH =
  SCOUTNET_PROJECT_QUESTIONS_PATH;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ScoutnetConnectionAction =
  | "status"
  | "question-catalogue"
  | "participant-snapshot"
  | "reconciliation-preview"
  | "reconciliation-apply"
  | "connect"
  | "rotate"
  | "update-question-mapping"
  | "disconnect";

export type ScoutnetCredentialEndpoint = "participants" | "questions";

export interface ScoutnetConnectionEnvironment {
  appOrigin?: string;
}

export interface AuthenticatedScoutnetUser {
  id: string;
  assuranceLevel: string | null;
}

export interface ScoutnetConnectionStatus {
  campId: string;
  connected: boolean;
  projectId: string | null;
  hasParticipantsApiKey: boolean;
  hasQuestionsApiKey: boolean;
  questionMapping: ScoutnetQuestionMapping;
  connectedAt: string | null;
  credentialsRotatedAt: string | null;
  questionMappingUpdatedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastSuccessfulSyncParticipantCount: number | null;
}

export interface ScoutnetAdapterServerContext
  extends Omit<ScoutnetProjectAdapterContext, "sourceReferenceSecret"> {
  participantsApiKey: string;
  questionsApiKey: string;
}

export interface ScoutnetCredentialProbeInput {
  projectId: string;
  endpoint: ScoutnetCredentialEndpoint;
  apiKey: string;
}

export interface ConnectScoutnetInput {
  actorUserId: string;
  assuranceLevel: "aal2";
  campId: string;
  projectId: string;
  participantsApiKey: string;
  questionsApiKey: string;
}

export interface RotateScoutnetInput {
  actorUserId: string;
  assuranceLevel: "aal2";
  campId: string;
  projectId?: string;
  participantsApiKey?: string;
  questionsApiKey?: string;
}

export interface UpdateScoutnetQuestionMappingInput {
  actorUserId: string;
  assuranceLevel: "aal2";
  campId: string;
  questionMapping: ScoutnetQuestionMapping;
}

export interface DisconnectScoutnetInput {
  actorUserId: string;
  assuranceLevel: "aal2";
  campId: string;
}

export type ScoutnetReconciliationDecision =
  | {
    sourceReference: string;
    action: "apply" | "skip";
  }
  | {
    sourceReference: string;
    action: "link";
    participantId: string;
  };

export interface ApplyScoutnetReconciliationInput {
  actorUserId: string;
  campId: string;
  snapshot: ScoutnetParticipantSnapshot;
  decisions: ScoutnetReconciliationDecision[];
  expectedStateDigest: string;
  idempotencyKey: string;
}

export interface ScoutnetReconciliationApplyResult {
  campId: string;
  stateDigest: string;
  appliedAt: string;
  snapshotParticipantCount: number;
  counts: {
    created: number;
    linked: number;
    updated: number;
    reactivated: number;
    withdrawn: number;
    skipped: number;
  };
}

export interface ScoutnetConnectionHandlerDependencies {
  getEnvironment(): ScoutnetConnectionEnvironment;
  authenticate(accessToken: string): Promise<AuthenticatedScoutnetUser | null>;
  getStatus(
    actorUserId: string,
    campId: string,
  ): Promise<ScoutnetConnectionStatus>;
  getAdapterContext(
    actorUserId: string,
    campId: string,
  ): Promise<ScoutnetAdapterServerContext>;
  getReconciliationContext(
    actorUserId: string,
    campId: string,
  ): Promise<ScoutnetReconciliationContext>;
  getReconciliationSnapshot(
    campId: string,
  ): Promise<ScoutnetParticipantSnapshot>;
  getSourceReferenceSecret(): string | undefined;
  fetchProjectResource(input: ScoutnetProjectFetchInput): Promise<unknown>;
  probeCredential(input: ScoutnetCredentialProbeInput): Promise<void>;
  connect(input: ConnectScoutnetInput): Promise<ScoutnetConnectionStatus>;
  rotate(input: RotateScoutnetInput): Promise<ScoutnetConnectionStatus>;
  updateQuestionMapping(
    input: UpdateScoutnetQuestionMappingInput,
  ): Promise<ScoutnetConnectionStatus>;
  disconnect(
    input: DisconnectScoutnetInput,
  ): Promise<ScoutnetConnectionStatus>;
  applyReconciliation(
    input: ApplyScoutnetReconciliationInput,
  ): Promise<ScoutnetReconciliationApplyResult>;
}

export interface ScoutnetCredentialProbeOptions {
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
}

interface StatusRequest {
  action: "status";
  campId: string;
}

interface ConnectRequest {
  action: "connect";
  campId: string;
  projectId: string;
  participantsApiKey: string;
  questionsApiKey: string;
}

interface QuestionCatalogueRequest {
  action: "question-catalogue";
  campId: string;
}

interface ParticipantSnapshotRequest {
  action: "participant-snapshot";
  campId: string;
}

interface ReconciliationPreviewRequest {
  action: "reconciliation-preview";
  campId: string;
}

interface ReconciliationApplyRequest {
  action: "reconciliation-apply";
  campId: string;
  stateDigest: string;
  previewDigest: string;
  idempotencyKey: string;
  decisions: ScoutnetReconciliationDecision[];
}

interface RotateRequest {
  action: "rotate";
  campId: string;
  projectId?: string;
  participantsApiKey?: string;
  questionsApiKey?: string;
}

interface UpdateQuestionMappingRequest {
  action: "update-question-mapping";
  campId: string;
  questionMapping: ScoutnetQuestionMapping;
}

interface DisconnectRequest {
  action: "disconnect";
  campId: string;
}

type ScoutnetConnectionRequest =
  | StatusRequest
  | QuestionCatalogueRequest
  | ParticipantSnapshotRequest
  | ReconciliationPreviewRequest
  | ReconciliationApplyRequest
  | ConnectRequest
  | RotateRequest
  | UpdateQuestionMappingRequest
  | DisconnectRequest;

type ErrorCode =
  | "server_misconfigured"
  | "origin_forbidden"
  | "method_not_allowed"
  | "authentication_required"
  | "aal2_required"
  | "invalid_request"
  | "forbidden"
  | "credentials_rejected"
  | "question_mapping_required"
  | "reconciliation_stale"
  | "scoutnet_rate_limited"
  | "scoutnet_response_invalid"
  | "scoutnet_unavailable"
  | "connection_failed";

class RequestBodyError extends Error {}

export class ScoutnetAuthorisationError extends Error {
  constructor() {
    super("Scoutnet authorization failed");
    this.name = "ScoutnetAuthorisationError";
  }
}

export class ScoutnetConnectionRequestError extends Error {
  constructor() {
    super("Scoutnet connection request was rejected");
    this.name = "ScoutnetConnectionRequestError";
  }
}

export class ScoutnetReconciliationConflictError extends Error {
  constructor() {
    super("Scoutnet reconciliation preview is stale");
    this.name = "ScoutnetReconciliationConflictError";
  }
}

export class ScoutnetCredentialProbeError extends Error {
  readonly kind: "rejected" | "unavailable";

  constructor(kind: "rejected" | "unavailable") {
    super(
      kind === "rejected"
        ? "Scoutnet rejected an endpoint credential"
        : "Scoutnet credential verification is unavailable",
    );
    this.name = "ScoutnetCredentialProbeError";
    this.kind = kind;
  }
}

function normaliseAppOrigin(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 2_048) return null;

  try {
    const parsed = new URL(candidate);
    const local = parsed.hostname === "127.0.0.1"
      || parsed.hostname === "localhost";
    if (
      parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || parsed.pathname !== "/"
      || (local ? parsed.protocol !== "http:" : parsed.protocol !== "https:")
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function corsHeaders(appOrigin: string): HeadersInit {
  return {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": appOrigin,
    "Cache-Control": "private, no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function errorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  retryable: boolean,
  appOrigin?: string,
  additionalHeaders: HeadersInit = {},
): Response {
  return new Response(
    JSON.stringify({ error: { code, message, retryable } }),
    {
      status,
      headers: {
        ...(appOrigin
          ? corsHeaders(appOrigin)
          : {
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          }),
        "Content-Type": "application/json; charset=utf-8",
        ...additionalHeaders,
      },
    },
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function validProjectId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{1,32}$/.test(value);
}

function validApiKey(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length < 8
    || value.length > API_KEY_LIMIT
    || value.trim() !== value
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validSourceReference(value: unknown): value is string {
  return typeof value === "string"
    && /^scoutnet:v1:[A-Za-z0-9_-]{43}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reconciliationDecisions(
  value: unknown,
): ScoutnetReconciliationDecision[] | null {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > 5_000
  ) {
    return null;
  }

  const decisions: ScoutnetReconciliationDecision[] = [];
  const sourceReferences = new Set<string>();
  const linkedParticipants = new Set<string>();
  for (const candidate of value) {
    if (
      !isRecord(candidate)
      || !validSourceReference(candidate.sourceReference)
      || sourceReferences.has(candidate.sourceReference)
    ) {
      return null;
    }
    sourceReferences.add(candidate.sourceReference);

    if (
      (candidate.action === "apply" || candidate.action === "skip")
      && exactKeys(candidate, ["sourceReference", "action"])
    ) {
      decisions.push({
        sourceReference: candidate.sourceReference,
        action: candidate.action,
      });
      continue;
    }
    if (
      candidate.action === "link"
      && exactKeys(
        candidate,
        ["sourceReference", "action", "participantId"],
      )
      && isUuid(candidate.participantId)
      && !linkedParticipants.has(candidate.participantId)
    ) {
      linkedParticipants.add(candidate.participantId);
      decisions.push({
        sourceReference: candidate.sourceReference,
        action: "link",
        participantId: candidate.participantId,
      });
      continue;
    }
    return null;
  }
  return decisions;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function validTimestamp(value: unknown): value is string | null {
  return value === null
    || (
      typeof value === "string"
      && value.length <= 64
      && Number.isFinite(Date.parse(value))
    );
}

function validParticipantCount(value: unknown): value is number | null {
  return value === null
    || (
      typeof value === "number"
      && Number.isInteger(value)
      && value >= 1
      && value <= 5_000
    );
}

function publicStatus(value: unknown): ScoutnetConnectionStatus | null {
  if (!isRecord(value)) return null;
  if (
    !isUuid(value.campId)
    || typeof value.connected !== "boolean"
    || !(value.projectId === null || validProjectId(value.projectId))
    || typeof value.hasParticipantsApiKey !== "boolean"
    || typeof value.hasQuestionsApiKey !== "boolean"
    || !isScoutnetQuestionMapping(value.questionMapping)
    || !validTimestamp(value.connectedAt)
    || !validTimestamp(value.credentialsRotatedAt)
    || !validTimestamp(value.questionMappingUpdatedAt)
    || !validTimestamp(value.lastSuccessfulSyncAt)
    || !validParticipantCount(value.lastSuccessfulSyncParticipantCount)
  ) {
    return null;
  }
  if (value.connected
    ? (
      value.projectId === null
      || !value.hasParticipantsApiKey
      || !value.hasQuestionsApiKey
    )
    : (
      value.projectId !== null
      || value.hasParticipantsApiKey
      || value.hasQuestionsApiKey
      || value.lastSuccessfulSyncAt !== null
      || value.lastSuccessfulSyncParticipantCount !== null
    )) {
    return null;
  }
  if (
    (value.lastSuccessfulSyncAt === null)
      !== (value.lastSuccessfulSyncParticipantCount === null)
  ) {
    return null;
  }

  return {
    campId: value.campId,
    connected: value.connected,
    projectId: value.projectId,
    hasParticipantsApiKey: value.hasParticipantsApiKey,
    hasQuestionsApiKey: value.hasQuestionsApiKey,
    questionMapping: value.questionMapping,
    connectedAt: value.connectedAt,
    credentialsRotatedAt: value.credentialsRotatedAt,
    questionMappingUpdatedAt: value.questionMappingUpdatedAt,
    lastSuccessfulSyncAt: value.lastSuccessfulSyncAt,
    lastSuccessfulSyncParticipantCount:
      value.lastSuccessfulSyncParticipantCount,
  };
}

function successResponse(
  value: unknown,
  appOrigin: string,
): Response {
  const status = publicStatus(value);
  if (!status) {
    return errorResponse(
      "connection_failed",
      "Scoutnet-anslutningen gav ett ogiltigt serversvar.",
      500,
      false,
      appOrigin,
    );
  }

  return new Response(JSON.stringify(status), {
    status: 200,
    headers: {
      ...corsHeaders(appOrigin),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function jsonSuccessResponse(
  value: unknown,
  appOrigin: string,
): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      ...corsHeaders(appOrigin),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function scoutnetConnectionTransportGuard(
  request: Request,
  rawAppOrigin: string | undefined,
): Response | null {
  const appOrigin = normaliseAppOrigin(rawAppOrigin);
  if (!appOrigin) {
    return errorResponse(
      "server_misconfigured",
      "Serverkonfigurationen för Scoutnet är ofullständig.",
      500,
      false,
    );
  }
  if (request.headers.get("Origin") !== appOrigin) {
    return errorResponse(
      "origin_forbidden",
      "Anropet kommer från en otillåten webbplats.",
      403,
      false,
    );
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(appOrigin),
    });
  }
  if (request.method !== "POST") {
    return errorResponse(
      "method_not_allowed",
      "Metoden stöds inte.",
      405,
      false,
      appOrigin,
      { "Allow": "POST, OPTIONS" },
    );
  }
  return null;
}

function accessToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization || authorization.length > ACCESS_TOKEN_LIMIT + 7) {
    return null;
  }
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
  return match?.[1] && match[1].length <= ACCESS_TOKEN_LIMIT
    ? match[1]
    : null;
}

function declaredBodyTooLarge(headers: Headers): boolean {
  const contentLength = headers.get("Content-Length");
  return Boolean(
    contentLength
    && (!/^\d+$/.test(contentLength)
      || Number(contentLength) > REQUEST_BODY_LIMIT),
  );
}

async function readBoundedBody(request: Request): Promise<string> {
  if (declaredBodyTooLarge(request.headers)) {
    throw new RequestBodyError("Body is too large");
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > REQUEST_BODY_LIMIT) {
        await reader.cancel("body too large");
        throw new RequestBodyError("Body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestBodyError("Body is not valid UTF-8");
  }
}

function parseRequestBody(value: unknown): ScoutnetConnectionRequest {
  if (!isRecord(value) || typeof value.action !== "string") {
    throw new RequestBodyError("Body must be an action object");
  }
  if (!isUuid(value.campId)) {
    throw new RequestBodyError("Camp ID is invalid");
  }

  if (
    value.action === "status"
    && exactKeys(value, ["action", "campId"])
  ) {
    return { action: "status", campId: value.campId };
  }
  if (
    value.action === "question-catalogue"
    && exactKeys(value, ["action", "campId"])
  ) {
    return { action: "question-catalogue", campId: value.campId };
  }
  if (
    value.action === "participant-snapshot"
    && exactKeys(value, ["action", "campId"])
  ) {
    return { action: "participant-snapshot", campId: value.campId };
  }
  if (
    value.action === "reconciliation-preview"
    && exactKeys(value, ["action", "campId"])
  ) {
    return { action: "reconciliation-preview", campId: value.campId };
  }
  if (
    value.action === "reconciliation-apply"
    && exactKeys(value, [
      "action",
      "campId",
      "stateDigest",
      "previewDigest",
      "idempotencyKey",
      "decisions",
    ])
    && validDigest(value.stateDigest)
    && validDigest(value.previewDigest)
    && isUuid(value.idempotencyKey)
  ) {
    const decisions = reconciliationDecisions(value.decisions);
    if (!decisions) {
      throw new RequestBodyError("Reconciliation decisions are invalid");
    }
    return {
      action: "reconciliation-apply",
      campId: value.campId,
      stateDigest: value.stateDigest,
      previewDigest: value.previewDigest,
      idempotencyKey: value.idempotencyKey,
      decisions,
    };
  }
  if (
    value.action === "disconnect"
    && exactKeys(value, ["action", "campId"])
  ) {
    return { action: "disconnect", campId: value.campId };
  }
  if (
    value.action === "connect"
    && exactKeys(value, [
      "action",
      "campId",
      "projectId",
      "participantsApiKey",
      "questionsApiKey",
    ])
    && validProjectId(value.projectId)
    && validApiKey(value.participantsApiKey)
    && validApiKey(value.questionsApiKey)
    && value.participantsApiKey !== value.questionsApiKey
  ) {
    return {
      action: "connect",
      campId: value.campId,
      projectId: value.projectId,
      participantsApiKey: value.participantsApiKey,
      questionsApiKey: value.questionsApiKey,
    };
  }
  if (
    value.action === "rotate"
    && exactKeys(
      value,
      ["action", "campId"],
      ["projectId", "participantsApiKey", "questionsApiKey"],
    )
  ) {
    const projectId = value.projectId;
    const participantsApiKey = value.participantsApiKey;
    const questionsApiKey = value.questionsApiKey;
    if (
      (projectId !== undefined && !validProjectId(projectId))
      || (
        participantsApiKey !== undefined
        && !validApiKey(participantsApiKey)
      )
      || (
        questionsApiKey !== undefined
        && !validApiKey(questionsApiKey)
      )
      || (
        participantsApiKey !== undefined
        && questionsApiKey !== undefined
        && participantsApiKey === questionsApiKey
      )
      || (
        projectId === undefined
        && participantsApiKey === undefined
        && questionsApiKey === undefined
      )
    ) {
      throw new RequestBodyError("Rotation input is invalid");
    }
    return {
      action: "rotate",
      campId: value.campId,
      ...(projectId !== undefined ? { projectId } : {}),
      ...(participantsApiKey !== undefined ? { participantsApiKey } : {}),
      ...(questionsApiKey !== undefined ? { questionsApiKey } : {}),
    };
  }
  if (
    value.action === "update-question-mapping"
    && exactKeys(
      value,
      ["action", "campId", "questionMapping"],
    )
    && isScoutnetQuestionMapping(value.questionMapping)
  ) {
    return {
      action: "update-question-mapping",
      campId: value.campId,
      questionMapping: value.questionMapping,
    };
  }

  throw new RequestBodyError("Action input is invalid");
}

async function requestInput(
  request: Request,
): Promise<ScoutnetConnectionRequest> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new RequestBodyError("Content-Type must be application/json");
  }
  const source = await readBoundedBody(request);
  try {
    return parseRequestBody(JSON.parse(source) as unknown);
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError("Body is not valid JSON");
  }
}

function targetPath(endpoint: ScoutnetCredentialEndpoint): string {
  return endpoint === "participants"
    ? SCOUTNET_CONNECTION_PARTICIPANTS_PATH
    : SCOUTNET_CONNECTION_QUESTIONS_PATH;
}

export function createScoutnetCredentialProbe(
  options: ScoutnetCredentialProbeOptions = {},
): (input: ScoutnetCredentialProbeInput) => Promise<void> {
  const fetcher = options.fetch ?? fetch;
  const baseUrl = (
    options.baseUrl ?? SCOUTNET_CONNECTION_API_BASE_URL
  ).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (input): Promise<void> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(
        `${baseUrl}${targetPath(input.endpoint)}`,
        {
          method: "GET",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "Accept": "application/json",
            "Authorization": createAuthorizationHeader({
              resourceId: input.projectId,
              key: input.apiKey,
            }),
          },
        },
      );
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 200) return;
      if (response.status === 401 || response.status === 403) {
        throw new ScoutnetCredentialProbeError("rejected");
      }
      throw new ScoutnetCredentialProbeError("unavailable");
    } catch (error) {
      if (error instanceof ScoutnetCredentialProbeError) throw error;
      throw new ScoutnetCredentialProbeError("unavailable");
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function probeConnectCredentials(
  dependencies: ScoutnetConnectionHandlerDependencies,
  input: ConnectRequest,
): Promise<void> {
  await Promise.all([
    dependencies.probeCredential({
      projectId: input.projectId,
      endpoint: "participants",
      apiKey: input.participantsApiKey,
    }),
    dependencies.probeCredential({
      projectId: input.projectId,
      endpoint: "questions",
      apiKey: input.questionsApiKey,
    }),
  ]);
}

async function probeRotatedCredentials(
  dependencies: ScoutnetConnectionHandlerDependencies,
  input: RotateRequest,
  status: ScoutnetConnectionStatus,
): Promise<string> {
  if (!status.connected || !status.projectId) {
    throw new ScoutnetConnectionRequestError();
  }
  const targetProjectId = input.projectId ?? status.projectId;
  if (
    input.projectId !== undefined
    && input.projectId !== status.projectId
    && (
      input.participantsApiKey === undefined
      || input.questionsApiKey === undefined
    )
  ) {
    throw new ScoutnetConnectionRequestError();
  }
  if (
    input.projectId === status.projectId
    && input.participantsApiKey === undefined
    && input.questionsApiKey === undefined
  ) {
    throw new ScoutnetConnectionRequestError();
  }

  const probes: Promise<void>[] = [];
  if (input.participantsApiKey !== undefined) {
    probes.push(dependencies.probeCredential({
      projectId: targetProjectId,
      endpoint: "participants",
      apiKey: input.participantsApiKey,
    }));
  }
  if (input.questionsApiKey !== undefined) {
    probes.push(dependencies.probeCredential({
      projectId: targetProjectId,
      endpoint: "questions",
      apiKey: input.questionsApiKey,
    }));
  }
  await Promise.all(probes);
  return targetProjectId;
}

function requiresAal2(action: ScoutnetConnectionAction): boolean {
  return action === "connect"
    || action === "rotate"
    || action === "update-question-mapping"
    || action === "disconnect";
}

async function loadQuestionCatalogue(
  dependencies: ScoutnetConnectionHandlerDependencies,
  actorUserId: string,
  campId: string,
): Promise<{
  context: ScoutnetAdapterServerContext;
  catalogue: ReturnType<typeof buildScoutnetQuestionCatalogue>;
}> {
  const context = await dependencies.getAdapterContext(actorUserId, campId);
  const rawQuestions = await dependencies.fetchProjectResource({
    projectId: context.projectId,
    endpoint: "questions",
    apiKey: context.questionsApiKey,
  });
  return {
    context,
    catalogue: buildScoutnetQuestionCatalogue(rawQuestions),
  };
}

async function loadParticipantSnapshot(
  dependencies: ScoutnetConnectionHandlerDependencies,
  actorUserId: string,
  campId: string,
) {
  const context = await dependencies.getAdapterContext(actorUserId, campId);
  const sourceReferenceSecret = dependencies.getSourceReferenceSecret();
  if (!sourceReferenceSecret) {
    throw new ScoutnetProjectAdapterError(
      "invalid_context",
      "Source-reference secret is unavailable",
    );
  }
  const rawQuestions = await dependencies.fetchProjectResource({
    projectId: context.projectId,
    endpoint: "questions",
    apiKey: context.questionsApiKey,
  });
  validateScoutnetQuestionMappingAgainstCatalogue(
    context.questionMapping,
    buildScoutnetQuestionCatalogue(rawQuestions),
    context,
  );
  const rawParticipants = await dependencies.fetchProjectResource({
    projectId: context.projectId,
    endpoint: "participants",
    apiKey: context.participantsApiKey,
  });
  return buildScoutnetParticipantSnapshot(
    rawParticipants,
    rawQuestions,
    {
      organizationId: context.organizationId,
      projectId: context.projectId,
      startsOn: context.startsOn,
      endsOn: context.endsOn,
      timezone: context.timezone,
      questionMapping: context.questionMapping,
      sourceReferenceSecret,
    },
  );
}

interface LoadedScoutnetReconciliation {
  snapshot: ScoutnetParticipantSnapshot;
  preview: ScoutnetReconciliationPreview;
  previewDigest: string;
}

async function loadReconciliation(
  dependencies: ScoutnetConnectionHandlerDependencies,
  actorUserId: string,
  campId: string,
  expectedStateDigest?: string,
): Promise<LoadedScoutnetReconciliation> {
  const status = publicStatus(
    await dependencies.getStatus(actorUserId, campId),
  );
  if (!status?.connected) throw new ScoutnetConnectionRequestError();

  const context = await dependencies.getReconciliationContext(
    actorUserId,
    campId,
  );
  if (
    context.campId !== campId
    || !validDigest(context.stateDigest)
  ) {
    throw new Error("Invalid reconciliation context");
  }
  if (
    expectedStateDigest !== undefined
    && context.stateDigest !== expectedStateDigest
  ) {
    throw new ScoutnetReconciliationConflictError();
  }

  // The concrete Edge dependency is fixture-only under the current local
  // authorisation. No live Project API fetch is wired to this route.
  const snapshot = await dependencies.getReconciliationSnapshot(campId);
  const preview = buildScoutnetReconciliationPreview(snapshot, context);
  return {
    snapshot,
    preview,
    previewDigest: await scoutnetReconciliationPreviewDigest(preview),
  };
}

function decisionsMatchPreview(
  decisions: ScoutnetReconciliationDecision[],
  preview: ScoutnetReconciliationPreview,
): boolean {
  if (decisions.length !== preview.rows.length) return false;
  const rows = new Map(
    preview.rows.map((row) => [row.sourceReference, row]),
  );
  for (const decision of decisions) {
    const row = rows.get(decision.sourceReference);
    if (!row) return false;
    if (
      decision.action === "link"
      && !row.duplicateCandidates.some((candidate) =>
        candidate.participantId === decision.participantId
      )
    ) {
      return false;
    }
  }
  return true;
}

export function createScoutnetConnectionHandler(
  dependencies: ScoutnetConnectionHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const appOrigin = normaliseAppOrigin(
      dependencies.getEnvironment().appOrigin,
    );
    const transportResponse = scoutnetConnectionTransportGuard(
      request,
      appOrigin ?? undefined,
    );
    if (transportResponse) return transportResponse;
    if (!appOrigin) {
      return errorResponse(
        "server_misconfigured",
        "Serverkonfigurationen för Scoutnet är ofullständig.",
        500,
        false,
      );
    }

    const token = accessToken(request);
    if (!token) {
      return errorResponse(
        "authentication_required",
        "En giltig inloggning krävs.",
        401,
        false,
        appOrigin,
      );
    }

    let input: ScoutnetConnectionRequest;
    try {
      input = await requestInput(request);
    } catch {
      return errorResponse(
        "invalid_request",
        "Begäran har ett ogiltigt format.",
        400,
        false,
        appOrigin,
      );
    }

    const user = await dependencies.authenticate(token).catch(() => null);
    if (!user || !isUuid(user.id)) {
      return errorResponse(
        "authentication_required",
        "Sessionen är ogiltig eller har gått ut.",
        401,
        false,
        appOrigin,
      );
    }
    if (requiresAal2(input.action) && user.assuranceLevel !== "aal2") {
      return errorResponse(
        "aal2_required",
        "Tvåfaktorsautentisering krävs för att ändra Scoutnet-anslutningen.",
        403,
        false,
        appOrigin,
      );
    }

    try {
      if (input.action === "status") {
        return successResponse(
          await dependencies.getStatus(user.id, input.campId),
          appOrigin,
        );
      }
      if (input.action === "question-catalogue") {
        const status = publicStatus(
          await dependencies.getStatus(user.id, input.campId),
        );
        if (!status?.connected) throw new ScoutnetConnectionRequestError();
        const { context, catalogue } = await loadQuestionCatalogue(
          dependencies,
          user.id,
          input.campId,
        );
        let mappingValid = false;
        try {
          validateScoutnetQuestionMappingAgainstCatalogue(
            context.questionMapping,
            catalogue,
            context,
          );
          mappingValid = true;
        } catch {
          mappingValid = false;
        }
        return jsonSuccessResponse({
          campId: input.campId,
          questions: catalogue.questions,
          suggestions: catalogue.suggestions,
          currentMapping: context.questionMapping,
          mappingValid,
          mappingUpdatedAt: status.questionMappingUpdatedAt,
        }, appOrigin);
      }
      if (input.action === "participant-snapshot") {
        const status = publicStatus(
          await dependencies.getStatus(user.id, input.campId),
        );
        if (!status?.connected) throw new ScoutnetConnectionRequestError();
        const snapshot = await loadParticipantSnapshot(
          dependencies,
          user.id,
          input.campId,
        );
        return jsonSuccessResponse({
          campId: input.campId,
          ...snapshot,
        }, appOrigin);
      }
      if (input.action === "reconciliation-preview") {
        const reconciliation = await loadReconciliation(
          dependencies,
          user.id,
          input.campId,
        );
        return jsonSuccessResponse({
          campId: input.campId,
          snapshotSource: "local_fixture",
          previewDigest: reconciliation.previewDigest,
          ...reconciliation.preview,
        }, appOrigin);
      }
      if (input.action === "reconciliation-apply") {
        const reconciliation = await loadReconciliation(
          dependencies,
          user.id,
          input.campId,
          input.stateDigest,
        );
        if (
          reconciliation.previewDigest !== input.previewDigest
          || !decisionsMatchPreview(
            input.decisions,
            reconciliation.preview,
          )
        ) {
          throw new ScoutnetReconciliationConflictError();
        }
        return jsonSuccessResponse(
          await dependencies.applyReconciliation({
            actorUserId: user.id,
            campId: input.campId,
            snapshot: reconciliation.snapshot,
            decisions: input.decisions,
            expectedStateDigest: input.stateDigest,
            idempotencyKey: input.idempotencyKey,
          }),
          appOrigin,
        );
      }
      if (input.action === "connect") {
        await probeConnectCredentials(dependencies, input);
        return successResponse(
          await dependencies.connect({
            actorUserId: user.id,
            assuranceLevel: "aal2",
            campId: input.campId,
            projectId: input.projectId,
            participantsApiKey: input.participantsApiKey,
            questionsApiKey: input.questionsApiKey,
          }),
          appOrigin,
        );
      }
      if (input.action === "rotate") {
        const currentStatus = publicStatus(
          await dependencies.getStatus(user.id, input.campId),
        );
        if (!currentStatus) throw new Error("Invalid status");
        await probeRotatedCredentials(dependencies, input, currentStatus);
        return successResponse(
          await dependencies.rotate({
            actorUserId: user.id,
            assuranceLevel: "aal2",
            campId: input.campId,
            ...(input.projectId !== undefined
              ? { projectId: input.projectId }
              : {}),
            ...(input.participantsApiKey !== undefined
              ? { participantsApiKey: input.participantsApiKey }
              : {}),
            ...(input.questionsApiKey !== undefined
              ? { questionsApiKey: input.questionsApiKey }
              : {}),
          }),
          appOrigin,
        );
      }
      if (input.action === "update-question-mapping") {
        const status = publicStatus(
          await dependencies.getStatus(user.id, input.campId),
        );
        if (!status?.connected) throw new ScoutnetConnectionRequestError();
        const { context, catalogue } = await loadQuestionCatalogue(
          dependencies,
          user.id,
          input.campId,
        );
        validateScoutnetQuestionMappingAgainstCatalogue(
          input.questionMapping,
          catalogue,
          context,
        );
        return successResponse(
          await dependencies.updateQuestionMapping({
            actorUserId: user.id,
            assuranceLevel: "aal2",
            campId: input.campId,
            questionMapping: input.questionMapping,
          }),
          appOrigin,
        );
      }
      return successResponse(
        await dependencies.disconnect({
          actorUserId: user.id,
          assuranceLevel: "aal2",
          campId: input.campId,
        }),
        appOrigin,
      );
    } catch (error) {
      if (error instanceof ScoutnetAuthorisationError) {
        return errorResponse(
          "forbidden",
          "Endast en aktiv organisationsadministratör får göra detta.",
          403,
          false,
          appOrigin,
        );
      }
      if (error instanceof ScoutnetReconciliationConflictError) {
        return errorResponse(
          "reconciliation_stale",
          "Förhandsgranskningen är inte längre aktuell. Hämta om den innan du sparar.",
          409,
          false,
          appOrigin,
        );
      }
      if (error instanceof ScoutnetReconciliationError) {
        return errorResponse(
          "scoutnet_response_invalid",
          "Scoutnet-underlaget kunde inte valideras i sin helhet.",
          502,
          false,
          appOrigin,
        );
      }
      if (error instanceof ScoutnetConnectionRequestError) {
        return errorResponse(
          "invalid_request",
          "Scoutnet-anslutningen kan inte ändras på det sättet.",
          400,
          false,
          appOrigin,
        );
      }
      if (error instanceof ScoutnetCredentialProbeError) {
        if (error.kind === "rejected") {
          return errorResponse(
            "credentials_rejected",
            "Scoutnet avvisade projekt-id eller en av endpoint-nycklarna.",
            400,
            false,
            appOrigin,
          );
        }
        return errorResponse(
          "scoutnet_unavailable",
          "Scoutnet kunde inte verifiera anslutningen just nu.",
          503,
          true,
          appOrigin,
        );
      }
      if (error instanceof ScoutnetProjectFetchError) {
        if (error.kind === "rejected") {
          return errorResponse(
            "credentials_rejected",
            "Scoutnet avvisade den sparade endpoint-nyckeln.",
            400,
            false,
            appOrigin,
          );
        }
        if (error.kind === "rate_limited") {
          return errorResponse(
            "scoutnet_rate_limited",
            "Scoutnet begränsar anrop just nu. Försök igen senare.",
            503,
            true,
            appOrigin,
            error.retryAfterSeconds === null
              ? {}
              : { "Retry-After": String(error.retryAfterSeconds) },
          );
        }
        if (error.kind === "invalid_response") {
          return errorResponse(
            "scoutnet_response_invalid",
            "Scoutnet gav ett svar som inte kunde valideras.",
            502,
            false,
            appOrigin,
          );
        }
        return errorResponse(
          "scoutnet_unavailable",
          "Scoutnet kunde inte hämtas just nu.",
          503,
          true,
          appOrigin,
        );
      }
      if (error instanceof ScoutnetProjectAdapterError) {
        if (error.code === "invalid_mapping") {
          return errorResponse(
            "question_mapping_required",
            "Frågemappningen måste bekräftas mot den aktuella frågelistan.",
            409,
            false,
            appOrigin,
          );
        }
        if (error.code === "invalid_context") {
          return errorResponse(
            "server_misconfigured",
            "Serverkonfigurationen för Scoutnet är ofullständig.",
            500,
            false,
            appOrigin,
          );
        }
        return errorResponse(
          "scoutnet_response_invalid",
          "Scoutnet-snapshotet kunde inte valideras i sin helhet.",
          502,
          false,
          appOrigin,
        );
      }
      return errorResponse(
        "connection_failed",
        "Scoutnet-anslutningen kunde inte uppdateras.",
        500,
        false,
        appOrigin,
      );
    }
  };
}
