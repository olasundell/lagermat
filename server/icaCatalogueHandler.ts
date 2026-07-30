import {
  buildIcaSearchUrl,
  ICA_SICKLA_STORE_ID,
  ICA_SICKLA_STORE_NAME,
  type IcaCatalogueProduct,
  IcaPayloadError,
  parseCatalogueRequest,
  parseIcaSearchPayload,
} from "./icaCatalogueSource.ts";

const ICA_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
  + "AppleWebKit/537.36 (KHTML, like Gecko) "
  + "Chrome/126.0.0.0 Safari/537.36";
const REQUEST_BODY_LIMIT = 4_096;
const ICA_BODY_LIMIT = 1_500_000;
const SUPABASE_BODY_LIMIT = 64_000;
const ICA_TIMEOUT_MS = 8_000;
const SUPABASE_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 2 * 60_000;
const CACHE_MAX_ENTRIES = 100;
const RATE_WINDOW_MS = 60_000;
const DEFAULT_RATE_QUERY_UNITS = 80;
const RATE_MAX_USERS = 1_000;
const OUTBOUND_CHUNK_SIZE = 1;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface IcaCatalogueEnvironment {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
}

export interface IcaCatalogueHandlerOptions {
  getEnvironment(): IcaCatalogueEnvironment;
  fetch?: FetchLike;
  now?: () => number;
  logger?: Pick<Console, "error">;
  rateQueryUnits?: number;
}

interface ServerConfiguration {
  supabaseUrl: URL;
  publishableKey: string;
}

interface CachedSearch {
  fetchedAt: string;
  products: IcaCatalogueProduct[];
}

interface SearchResult extends CachedSearch {
  query: string;
  cache: "hit" | "miss";
}

interface SearchBatchOutcome {
  results: SearchResult[];
  complete: boolean;
  limitation: UpstreamError | null;
}

interface RateState {
  windowStartedAt: number;
  queryUnits: number;
  lastSeenAt: number;
}

interface HandlerState {
  searchCache: Map<string, { expiresAt: number; value: CachedSearch }>;
  inFlightSearches: Map<string, Promise<CachedSearch>>;
  rateStates: Map<string, RateState>;
}

class RequestBodyError extends Error {}

class UpstreamError extends Error {
  constructor(
    readonly service: "supabase" | "ica",
    readonly reason: string,
    readonly upstreamStatus: number | null = null,
  ) {
    super(reason);
    this.name = "UpstreamError";
  }
}

function jsonResponse(
  body: unknown,
  status: number,
  additionalHeaders: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...additionalHeaders,
    },
  });
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function jwtRole(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const base64 = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64)) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function serverConfiguration(
  environment: IcaCatalogueEnvironment,
): ServerConfiguration | null {
  const rawUrl = environment.supabaseUrl?.trim();
  const publishableKey = environment.supabasePublishableKey?.trim();
  if (!rawUrl || !publishableKey || publishableKey.length > 4_096) return null;
  if (
    /^(?:sb_secret_|supabase_secret_)/.test(publishableKey)
    || jwtRole(publishableKey) === "service_role"
  ) {
    return null;
  }

  try {
    const supabaseUrl = new URL(rawUrl);
    const local = isLocalHostname(supabaseUrl.hostname);
    if (
      supabaseUrl.username
      || supabaseUrl.password
      || supabaseUrl.search
      || supabaseUrl.hash
      || supabaseUrl.pathname !== "/"
      || (local ? supabaseUrl.protocol !== "http:" : supabaseUrl.protocol !== "https:")
    ) {
      return null;
    }
    return { supabaseUrl, publishableKey };
  } catch {
    return null;
  }
}

function isSameOriginBrowserRequest(request: Request): boolean {
  const originHeader = request.headers.get("Origin");
  if (!originHeader) return false;
  try {
    const requestOrigin = new URL(request.url).origin;
    const origin = new URL(originHeader);
    if (origin.href !== `${origin.origin}/` || origin.origin !== requestOrigin) {
      return false;
    }
  } catch {
    return false;
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return !fetchSite || fetchSite === "same-origin";
}

async function readBoundedBytes(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel("body too large");
        throw new RequestBodyError("Body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function declaredBodyTooLarge(
  headers: Headers,
  maximumBytes: number,
): boolean {
  const contentLength = headers.get("Content-Length");
  return Boolean(
    contentLength
    && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes),
  );
}

async function readJsonBytes(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<unknown> {
  const bytes = await readBoundedBytes(body, maximumBytes);
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as unknown;
}

async function readRequestJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new RequestBodyError("Content-Type must be application/json");
  }
  if (declaredBodyTooLarge(request.headers, REQUEST_BODY_LIMIT)) {
    throw new RequestBodyError("Body is too large");
  }
  try {
    return await readJsonBytes(request.body, REQUEST_BODY_LIMIT);
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError("Body is not valid JSON");
  }
}

async function readResponseJson(
  response: Response,
  maximumBytes: number,
  service: UpstreamError["service"],
): Promise<unknown> {
  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new UpstreamError(service, "unexpected_content_type", response.status);
  }
  if (declaredBodyTooLarge(response.headers, maximumBytes)) {
    throw new UpstreamError(service, "response_too_large", response.status);
  }
  try {
    return await readJsonBytes(response.body, maximumBytes);
  } catch {
    throw new UpstreamError(service, "invalid_or_oversized_json", response.status);
  }
}

function authorizationHeader(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (
    !authorization
    || authorization.length > 8_192
    || !/^Bearer [^\s]+$/.test(authorization)
  ) {
    return null;
  }
  return authorization;
}

function supabaseHeaders(
  configuration: ServerConfiguration,
  authorization: string,
): HeadersInit {
  return {
    "Accept": "application/json",
    "apikey": configuration.publishableKey,
    "Authorization": authorization,
  };
}

async function verifyUser(
  fetcher: FetchLike,
  configuration: ServerConfiguration,
  authorization: string,
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetcher(
      new URL("/auth/v1/user", configuration.supabaseUrl),
      {
        method: "GET",
        headers: supabaseHeaders(configuration, authorization),
        redirect: "error",
        signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
      },
    );
  } catch {
    throw new UpstreamError("supabase", "auth_network_error");
  }

  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    if (response.status >= 500) {
      throw new UpstreamError(
        "supabase",
        "auth_unavailable",
        response.status,
      );
    }
    return null;
  }

  const payload = await readResponseJson(
    response,
    SUPABASE_BODY_LIMIT,
    "supabase",
  );
  if (
    !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
    || !("id" in payload)
    || typeof payload.id !== "string"
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(payload.id)
  ) {
    throw new UpstreamError("supabase", "invalid_auth_payload", response.status);
  }
  return payload.id;
}

async function hasActiveMembership(
  fetcher: FetchLike,
  configuration: ServerConfiguration,
  authorization: string,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const url = new URL(
    "/rest/v1/organization_memberships",
    configuration.supabaseUrl,
  );
  url.searchParams.set("organization_id", `eq.${organizationId}`);
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("status", "eq.active");
  url.searchParams.set("select", "organization_id");
  url.searchParams.set("limit", "2");

  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: supabaseHeaders(configuration, authorization),
      redirect: "error",
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamError("supabase", "membership_network_error");
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new UpstreamError(
      "supabase",
      "membership_unavailable",
      response.status,
    );
  }

  const payload = await readResponseJson(
    response,
    SUPABASE_BODY_LIMIT,
    "supabase",
  );
  return Array.isArray(payload) && payload.length === 1;
}

function pruneCache(state: HandlerState, now: number): void {
  for (const [key, entry] of state.searchCache) {
    if (entry.expiresAt <= now) state.searchCache.delete(key);
  }
  while (state.searchCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = state.searchCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    state.searchCache.delete(oldestKey);
  }
}

function pruneRateStates(state: HandlerState, now: number): void {
  for (const [userId, entry] of state.rateStates) {
    if (now - entry.lastSeenAt > RATE_WINDOW_MS * 2) {
      state.rateStates.delete(userId);
    }
  }
  while (state.rateStates.size >= RATE_MAX_USERS) {
    const oldestUserId = state.rateStates.keys().next().value;
    if (typeof oldestUserId !== "string") break;
    state.rateStates.delete(oldestUserId);
  }
}

function consumeRateLimit(
  state: HandlerState,
  userId: string,
  queryCount: number,
  now: number,
  queryUnitLimit: number,
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  pruneRateStates(state, now);
  const existing = state.rateStates.get(userId);
  const current = !existing || now - existing.windowStartedAt >= RATE_WINDOW_MS
    ? { windowStartedAt: now, queryUnits: 0, lastSeenAt: now }
    : existing;

  current.lastSeenAt = now;
  if (current.queryUnits + queryCount > queryUnitLimit) {
    state.rateStates.set(userId, current);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((RATE_WINDOW_MS - (now - current.windowStartedAt)) / 1_000),
      ),
    };
  }
  current.queryUnits += queryCount;
  state.rateStates.set(userId, current);
  return { allowed: true };
}

async function fetchIcaSearch(
  fetcher: FetchLike,
  query: string,
  now: () => number,
): Promise<CachedSearch> {
  let response: Response;
  try {
    response = await fetcher(buildIcaSearchUrl(query), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "ecom-request-source": "web",
        "Referer":
          `https://handlaprivatkund.ica.se/stores/${ICA_SICKLA_STORE_ID}/`,
        "User-Agent": ICA_USER_AGENT,
      },
      redirect: "error",
      signal: AbortSignal.timeout(ICA_TIMEOUT_MS),
    });
  } catch (error) {
    throw new UpstreamError(
      "ica",
      error instanceof DOMException && error.name === "TimeoutError"
        ? "timeout"
        : "network_error",
    );
  }

  if (response.status !== 200) {
    const challenged = response.status === 202
      || response.headers.get("x-amzn-waf-action") === "challenge";
    void response.body?.cancel().catch(() => undefined);
    throw new UpstreamError(
      "ica",
      challenged ? "waf_challenge" : "unexpected_status",
      response.status,
    );
  }

  const payload = await readResponseJson(response, ICA_BODY_LIMIT, "ica");
  let products: IcaCatalogueProduct[];
  try {
    products = parseIcaSearchPayload(payload);
  } catch (error) {
    if (error instanceof IcaPayloadError) {
      throw new UpstreamError("ica", "unexpected_payload", response.status);
    }
    throw error;
  }
  return {
    fetchedAt: new Date(now()).toISOString(),
    products,
  };
}

async function getIcaSearch(
  state: HandlerState,
  fetcher: FetchLike,
  query: string,
  now: () => number,
): Promise<SearchResult> {
  const cacheKey = query.toLocaleLowerCase("sv-SE");
  const currentTime = now();
  pruneCache(state, currentTime);
  const cached = state.searchCache.get(cacheKey);
  if (cached && cached.expiresAt > currentTime) {
    state.searchCache.delete(cacheKey);
    state.searchCache.set(cacheKey, cached);
    return { query, cache: "hit", ...cached.value };
  }

  let pending = state.inFlightSearches.get(cacheKey);
  if (!pending) {
    pending = fetchIcaSearch(fetcher, query, now);
    state.inFlightSearches.set(cacheKey, pending);
  }
  try {
    const value = await pending;
    state.searchCache.set(cacheKey, {
      expiresAt: now() + CACHE_TTL_MS,
      value,
    });
    return { query, cache: "miss", ...value };
  } finally {
    if (state.inFlightSearches.get(cacheKey) === pending) {
      state.inFlightSearches.delete(cacheKey);
    }
  }
}

async function fetchSearchesUntilLimited(
  state: HandlerState,
  fetcher: FetchLike,
  queries: string[],
  now: () => number,
): Promise<SearchBatchOutcome> {
  const results: SearchResult[] = [];
  for (let offset = 0; offset < queries.length; offset += OUTBOUND_CHUNK_SIZE) {
    const queryChunk = queries.slice(offset, offset + OUTBOUND_CHUNK_SIZE);
    const settled = await Promise.allSettled(
      queryChunk.map((query) => getIcaSearch(state, fetcher, query, now)),
    );
    let limitation: UpstreamError | null = null;
    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(result.value);
        continue;
      }
      if (
        result.reason instanceof UpstreamError
        && result.reason.service === "ica"
      ) {
        limitation ??= result.reason;
        continue;
      }
      throw result.reason;
    }
    if (limitation) {
      return { results, complete: false, limitation };
    }
  }
  return { results, complete: true, limitation: null };
}

function mergeProducts(results: SearchResult[]): IcaCatalogueProduct[] {
  const productsById = new Map<string, IcaCatalogueProduct>();
  for (const result of results) {
    for (const product of result.products) {
      if (!productsById.has(product.productId)) {
        productsById.set(product.productId, product);
      }
    }
  }
  return [...productsById.values()];
}

export function createIcaCatalogueHandler(
  options: IcaCatalogueHandlerOptions,
): (request: Request) => Promise<Response> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const logger = options.logger ?? console;
  const queryUnitLimit = Number.isSafeInteger(options.rateQueryUnits)
      && (options.rateQueryUnits ?? 0) > 0
    ? options.rateQueryUnits!
    : DEFAULT_RATE_QUERY_UNITS;
  const state: HandlerState = {
    searchCache: new Map(),
    inFlightSearches: new Map(),
    rateStates: new Map(),
  };

  return async (request: Request): Promise<Response> => {
    if (!isSameOriginBrowserRequest(request)) {
      return jsonResponse(
        { error: "Anropet kommer från en otillåten webbplats." },
        403,
      );
    }
    if (request.method !== "POST") {
      return jsonResponse(
        { error: "Metoden stöds inte." },
        405,
        { "Allow": "POST" },
      );
    }

    const configuration = serverConfiguration(options.getEnvironment());
    if (!configuration) {
      return jsonResponse(
        { error: "Serverkonfigurationen är ofullständig." },
        500,
      );
    }

    const authorization = authorizationHeader(request);
    if (!authorization) {
      return jsonResponse({ error: "Inloggning krävs." }, 401);
    }

    let userId: string | null;
    try {
      userId = await verifyUser(
        fetcher,
        configuration,
        authorization,
      );
    } catch (error) {
      const detail = error instanceof UpstreamError
        ? { reason: error.reason, upstreamStatus: error.upstreamStatus }
        : { reason: "unexpected_error", upstreamStatus: null };
      logger.error(JSON.stringify({
        stage: "verify_ica_catalogue_session",
        ...detail,
      }));
      return jsonResponse(
        { error: "Sessionen kunde inte verifieras just nu." },
        502,
      );
    }
    if (!userId) {
      return jsonResponse(
        { error: "Sessionen är ogiltig eller har gått ut." },
        401,
      );
    }

    let body: ReturnType<typeof parseCatalogueRequest>;
    try {
      body = parseCatalogueRequest(await readRequestJson(request));
    } catch (error) {
      const message = error instanceof RequestBodyError
          && error.message === "Body is too large"
        ? "Förfrågan är för stor."
        : "Organisation, butik och sökningar måste vara giltiga.";
      return jsonResponse({ error: message }, 400);
    }

    let activeMember: boolean;
    try {
      activeMember = await hasActiveMembership(
        fetcher,
        configuration,
        authorization,
        body.organizationId,
        userId,
      );
    } catch (error) {
      const detail = error instanceof UpstreamError
        ? { reason: error.reason, upstreamStatus: error.upstreamStatus }
        : { reason: "unexpected_error", upstreamStatus: null };
      logger.error(JSON.stringify({
        stage: "verify_ica_catalogue_membership",
        ...detail,
      }));
      return jsonResponse(
        { error: "Organisationsbehörigheten kunde inte verifieras." },
        502,
      );
    }
    if (!activeMember) {
      return jsonResponse(
        { error: "Aktivt organisationsmedlemskap krävs." },
        403,
      );
    }

    const rateLimit = consumeRateLimit(
      state,
      userId,
      body.queries.length,
      now(),
      queryUnitLimit,
    );
    if (!rateLimit.allowed) {
      return jsonResponse(
        { error: "För många katalogsökningar. Försök igen om en stund." },
        429,
        { "Retry-After": String(rateLimit.retryAfterSeconds) },
      );
    }

    try {
      const outcome = await fetchSearchesUntilLimited(
        state,
        fetcher,
        body.queries,
        now,
      );
      if (!outcome.complete) {
        logger.error(JSON.stringify({
          stage: "fetch_public_ica_catalogue",
          storeId: ICA_SICKLA_STORE_ID,
          reason: outcome.limitation?.reason ?? "temporarily_limited",
          upstreamStatus: outcome.limitation?.upstreamStatus ?? null,
          completedSearches: outcome.results.length,
          requestedSearches: body.queries.length,
        }));
      }
      return jsonResponse({
        source: {
          provider: "ica",
          channel: "public-webshop",
          endpointVersion: "v6",
          complete: outcome.complete,
          store: {
            id: ICA_SICKLA_STORE_ID,
            name: ICA_SICKLA_STORE_NAME,
          },
          searches: outcome.results.map(({ query, fetchedAt, cache }) => ({
            query,
            fetchedAt,
            cache,
          })),
        },
        products: mergeProducts(outcome.results),
      }, 200);
    } catch (error) {
      const detail = error instanceof UpstreamError
        ? { reason: error.reason, upstreamStatus: error.upstreamStatus }
        : { reason: "unexpected_error", upstreamStatus: null };
      logger.error(JSON.stringify({
        stage: "fetch_public_ica_catalogue",
        storeId: ICA_SICKLA_STORE_ID,
        ...detail,
      }));
      return jsonResponse(
        { error: "ICA:s publika katalog kunde inte hämtas just nu." },
        502,
      );
    }
  };
}
