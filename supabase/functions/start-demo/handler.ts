const REQUEST_BODY_LIMIT = 4_096;
const ACCESS_TOKEN_LIMIT = 8_192;
const TURNSTILE_TOKEN_LIMIT = 2_048;
const TURNSTILE_RESPONSE_LIMIT = 32_768;
const TURNSTILE_ENDPOINT =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ATTEMPTS = 3;
const TURNSTILE_TIMEOUT_MS = 4_000;

export const START_DEMO_TURNSTILE_ACTION = "start-demo";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface StartDemoEnvironment {
  appOrigin?: string;
  demoMode?: string;
  turnstileSecretKey?: string;
}

export interface AuthenticatedDemoUser {
  id: string;
  isAnonymous: boolean;
}

export interface TurnstileVerification {
  success: boolean;
  action: string | null;
  hostname: string | null;
  errorCodes: string[];
}

export interface TurnstileVerificationInput {
  token: string;
  remoteIp?: string;
  idempotencyKey: string;
}

export interface DemoProvisionInput {
  userId: string;
  reset: boolean;
}

export interface DemoProvisionResult {
  organizationId: string;
  campId: string;
  expiresAt: string;
  templateVersion: number;
  reused: boolean;
}

export interface StartDemoHandlerDependencies {
  getEnvironment(): StartDemoEnvironment;
  authenticate(accessToken: string): Promise<AuthenticatedDemoUser | null>;
  verifyTurnstile(
    input: TurnstileVerificationInput,
  ): Promise<TurnstileVerification>;
  provision(input: DemoProvisionInput): Promise<DemoProvisionResult>;
  randomUUID?: () => string;
}

export interface TurnstileValidatorOptions {
  secretKey: string;
  fetch?: FetchLike;
  endpoint?: string;
  attempts?: number;
  timeoutMs?: number;
}

interface ServerConfiguration {
  appOrigin: string;
  appHostname: string;
  turnstileSecretKey: string;
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

class RequestBodyError extends Error {}

export class TurnstileUnavailableError extends Error {
  constructor() {
    super("Turnstile verification is unavailable");
    this.name = "TurnstileUnavailableError";
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
  code: string,
  message: string,
  status: number,
  retryable: boolean,
  appOrigin?: string,
  additionalHeaders: HeadersInit = {},
): Response {
  const body: ErrorBody = { error: { code, message, retryable } };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...(appOrigin ? corsHeaders(appOrigin) : {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      }),
      "Content-Type": "application/json; charset=utf-8",
      ...additionalHeaders,
    },
  });
}

function successResponse(
  body: DemoProvisionResult,
  appOrigin: string,
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...corsHeaders(appOrigin),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
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

function serverConfiguration(
  environment: StartDemoEnvironment,
): ServerConfiguration | null {
  const appOrigin = normaliseAppOrigin(environment.appOrigin);
  const turnstileSecretKey = environment.turnstileSecretKey?.trim();
  if (
    !appOrigin
    || !turnstileSecretKey
    || turnstileSecretKey.length > 4_096
  ) {
    return null;
  }

  return {
    appOrigin,
    appHostname: new URL(appOrigin).hostname,
    turnstileSecretKey,
  };
}

export function startDemoTransportGuard(
  request: Request,
  rawAppOrigin: string | undefined,
): Response | null {
  const appOrigin = normaliseAppOrigin(rawAppOrigin);
  if (!appOrigin) {
    return errorResponse(
      "server_misconfigured",
      "Serverkonfigurationen för demot är ofullständig.",
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

async function requestInput(
  request: Request,
): Promise<{ action: "start" | "reset"; turnstileToken: string }> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new RequestBodyError("Content-Type must be application/json");
  }

  const source = await readBoundedBody(request);
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new RequestBodyError("Body is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RequestBodyError("Body must be an object");
  }

  const body = parsed as Record<string, unknown>;
  const keys = Object.keys(body);
  if (
    keys.length !== 2
    || !keys.includes("action")
    || !keys.includes("turnstileToken")
  ) {
    throw new RequestBodyError("Body contains unsupported fields");
  }
  if (body.action !== "start" && body.action !== "reset") {
    throw new RequestBodyError("Action is invalid");
  }
  if (
    typeof body.turnstileToken !== "string"
    || body.turnstileToken.length === 0
    || body.turnstileToken.length > TURNSTILE_TOKEN_LIMIT
    || body.turnstileToken.trim() !== body.turnstileToken
  ) {
    throw new RequestBodyError("Turnstile token is invalid");
  }

  return {
    action: body.action,
    turnstileToken: body.turnstileToken,
  };
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function validProvisionResult(
  value: DemoProvisionResult,
): value is DemoProvisionResult {
  if (
    !value
    || typeof value !== "object"
    || !isUuid(value.organizationId)
    || !isUuid(value.campId)
    || !Number.isInteger(value.templateVersion)
    || value.templateVersion <= 0
    || typeof value.reused !== "boolean"
    || typeof value.expiresAt !== "string"
    || value.expiresAt.length > 64
    || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.expiresAt)
  ) {
    return false;
  }

  return Number.isFinite(Date.parse(value.expiresAt));
}

function trustedRemoteIp(request: Request): string | undefined {
  const value = request.headers.get("CF-Connecting-IP");
  return value && value.length <= 64 && /^[0-9a-f:.]+$/i.test(value)
    ? value
    : undefined;
}

export function createStartDemoHandler(
  dependencies: StartDemoHandlerDependencies,
): (request: Request) => Promise<Response> {
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID());

  return async (request: Request): Promise<Response> => {
    const environment = dependencies.getEnvironment();
    const transportResponse = startDemoTransportGuard(
      request,
      environment.appOrigin,
    );
    if (transportResponse) return transportResponse;

    if (environment.demoMode !== "true") {
      return errorResponse(
        "demo_disabled",
        "Demot är inte tillgängligt i den här miljön.",
        404,
        false,
        normaliseAppOrigin(environment.appOrigin) ?? undefined,
      );
    }

    const configuration = serverConfiguration(environment);
    if (!configuration) {
      return errorResponse(
        "server_misconfigured",
        "Serverkonfigurationen för demot är ofullständig.",
        500,
        false,
        normaliseAppOrigin(environment.appOrigin) ?? undefined,
      );
    }

    const token = accessToken(request);
    if (!token) {
      return errorResponse(
        "authentication_required",
        "En giltig anonym session krävs.",
        401,
        false,
        configuration.appOrigin,
      );
    }

    let input: Awaited<ReturnType<typeof requestInput>>;
    try {
      input = await requestInput(request);
    } catch {
      return errorResponse(
        "invalid_request",
        "Begäran har ett ogiltigt format.",
        400,
        false,
        configuration.appOrigin,
      );
    }

    let user: AuthenticatedDemoUser | null;
    try {
      user = await dependencies.authenticate(token);
    } catch {
      return errorResponse(
        "authentication_unavailable",
        "Sessionen kunde inte verifieras just nu.",
        503,
        true,
        configuration.appOrigin,
      );
    }
    if (!user || !isUuid(user.id)) {
      return errorResponse(
        "authentication_required",
        "En giltig anonym session krävs.",
        401,
        false,
        configuration.appOrigin,
      );
    }
    if (!user.isAnonymous) {
      return errorResponse(
        "anonymous_session_required",
        "Demot kan bara startas med en anonym demosession.",
        403,
        false,
        configuration.appOrigin,
      );
    }

    let turnstile: TurnstileVerification;
    try {
      turnstile = await dependencies.verifyTurnstile({
        token: input.turnstileToken,
        remoteIp: trustedRemoteIp(request),
        idempotencyKey: randomUUID(),
      });
    } catch {
      return errorResponse(
        "turnstile_unavailable",
        "Robotkontrollen kunde inte verifieras just nu.",
        503,
        true,
        configuration.appOrigin,
      );
    }

    if (
      !turnstile.success
      || turnstile.action !== START_DEMO_TURNSTILE_ACTION
      || turnstile.hostname !== configuration.appHostname
    ) {
      return errorResponse(
        "turnstile_rejected",
        "Robotkontrollen kunde inte godkännas.",
        403,
        false,
        configuration.appOrigin,
      );
    }

    let provisioned: DemoProvisionResult;
    try {
      provisioned = await dependencies.provision({
        userId: user.id,
        reset: input.action === "reset",
      });
    } catch {
      return errorResponse(
        "provisioning_unavailable",
        "Demot kunde inte skapas just nu.",
        503,
        true,
        configuration.appOrigin,
      );
    }

    if (!validProvisionResult(provisioned)) {
      return errorResponse(
        "invalid_server_response",
        "Demot gav ett ogiltigt serversvar.",
        502,
        true,
        configuration.appOrigin,
      );
    }

    return successResponse({
      organizationId: provisioned.organizationId,
      campId: provisioned.campId,
      expiresAt: provisioned.expiresAt,
      templateVersion: provisioned.templateVersion,
      reused: provisioned.reused,
    }, configuration.appOrigin);
  };
}

function normaliseTurnstileResult(value: unknown): TurnstileVerification | null {
  if (!value || typeof value !== "object") return null;
  const response = value as Record<string, unknown>;
  const errorCodes = response["error-codes"];
  if (
    typeof response.success !== "boolean"
    || (response.action !== undefined && typeof response.action !== "string")
    || (response.hostname !== undefined && typeof response.hostname !== "string")
    || (errorCodes !== undefined
      && (!Array.isArray(errorCodes)
        || errorCodes.some((code) => typeof code !== "string")))
  ) {
    return null;
  }

  return {
    success: response.success,
    action: typeof response.action === "string" ? response.action : null,
    hostname: typeof response.hostname === "string" ? response.hostname : null,
    errorCodes: Array.isArray(errorCodes) ? errorCodes : [],
  };
}

async function fetchWithTimeout(
  fetcher: FetchLike,
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(endpoint, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function createTurnstileValidator(
  options: TurnstileValidatorOptions,
): (input: TurnstileVerificationInput) => Promise<TurnstileVerification> {
  const secretKey = options.secretKey.trim();
  const fetcher = options.fetch ?? fetch;
  const endpoint = options.endpoint ?? TURNSTILE_ENDPOINT;
  const attempts = options.attempts ?? TURNSTILE_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? TURNSTILE_TIMEOUT_MS;

  if (
    !secretKey
    || secretKey.length > 4_096
    || attempts < 1
    || attempts > TURNSTILE_ATTEMPTS
    || timeoutMs < 1
    || timeoutMs > 30_000
  ) {
    throw new TurnstileUnavailableError();
  }

  return async (input): Promise<TurnstileVerification> => {
    if (
      !input.token
      || input.token.length > TURNSTILE_TOKEN_LIMIT
      || !isUuid(input.idempotencyKey)
      || (input.remoteIp !== undefined
        && !/^[0-9a-f:.]{1,64}$/i.test(input.remoteIp))
    ) {
      throw new TurnstileUnavailableError();
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const form = new FormData();
      form.set("secret", secretKey);
      form.set("response", input.token);
      form.set("idempotency_key", input.idempotencyKey);
      if (input.remoteIp) form.set("remoteip", input.remoteIp);

      try {
        const response = await fetchWithTimeout(fetcher, endpoint, {
          method: "POST",
          body: form,
        }, timeoutMs);
        if (!response.ok) throw new TurnstileUnavailableError();

        const source = await response.text();
        if (source.length > TURNSTILE_RESPONSE_LIMIT) {
          throw new TurnstileUnavailableError();
        }
        const result = normaliseTurnstileResult(JSON.parse(source));
        if (!result) throw new TurnstileUnavailableError();
        return result;
      } catch {
        if (attempt === attempts - 1) {
          throw new TurnstileUnavailableError();
        }
      }
    }

    throw new TurnstileUnavailableError();
  };
}
