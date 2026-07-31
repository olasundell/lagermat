import {
  SUPPLIER_SEMANTIC_MAX_CANDIDATES_PER_GROUP,
  SUPPLIER_SEMANTIC_MAX_GROUPS_PER_REQUEST,
  SUPPLIER_SEMANTIC_PROMPT_VERSION,
  type SupplierSemanticAdapter,
  type SupplierSemanticCandidate,
  type SupplierSemanticIngredient,
  type SupplierSemanticRerankGroup,
  type SupplierSemanticRerankResult,
} from "../src/features/suppliers/supplierSemanticMatch.ts";
import {
  ICA_CATALOGUE_NORMALISATION_VERSION,
} from "../src/features/suppliers/icaStore.ts";

const REQUEST_BODY_LIMIT = 256_000;
const SUPABASE_BODY_LIMIT = 750_000;
const OPENAI_BODY_LIMIT = 256_000;
const SUPABASE_TIMEOUT_MS = 5_000;
const OPENAI_TIMEOUT_MS = 25_000;
const OPENAI_MODEL = "gpt-5-mini";
const ICA_SICKLA_STORE_ID = "1004021";
const RATE_WINDOW_MS = 60_000;
const RATE_GROUP_LIMIT = 24;
const MEMORY_CACHE_TTL_MS = 30 * 60_000;
const MEMORY_CACHE_LIMIT = 1_000;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface SupplierMatchRerankEnvironment {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  openAiBaseUrl?: string;
  openAiApiKey?: string;
}

export interface SupplierMatchRerankHandlerOptions {
  getEnvironment(): SupplierMatchRerankEnvironment;
  fetch?: FetchLike;
  now?: () => number;
  logger?: Pick<Console, "error">;
}

interface ServerConfiguration {
  supabaseUrl: URL;
  publishableKey: string;
  adapter: Exclude<SupplierSemanticAdapter, "none"> | null;
  openAiEndpoint: URL | null;
  openAiApiKey: string | null;
  model: string | null;
}

interface AuthenticatedRequest {
  organizationId: string;
  campId: string;
  supplierAccountId: string;
  groups: SupplierSemanticRerankGroup[];
}

interface SupplierAccountRecord {
  id: string;
  provider_key: string;
  provider_location_id: string | null;
}

interface SupplierProductRecord {
  id: string;
  display_name: string;
  brand: string | null;
  category: string | null;
  purchase_unit: string;
  package_amount: number;
  package_unit: string;
  minimum_order_units: number;
  catch_weight: boolean;
  product_fingerprint: string;
  packaging_metadata: unknown;
  source_metadata: unknown;
}

interface CacheIdentity {
  contextFingerprint: string;
  candidateSetFingerprint: string;
}

interface RateState {
  startedAt: number;
  groups: number;
}

interface MemoryCacheEntry {
  expiresAt: number;
  result: SupplierSemanticRerankResult;
}

class RequestError extends Error {}

class UpstreamError extends Error {
  constructor(
    readonly service: "supabase" | "openai",
    readonly reason: string,
    readonly upstreamStatus: number | null = null,
  ) {
    super(reason);
    this.name = "UpstreamError";
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function compactString(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length >= minimumLength && compact.length <= maximumLength
    ? compact
    : null;
}

function nullableString(value: unknown, maximumLength: number): string | null {
  return value === null ? null : compactString(value, 1, maximumLength);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
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

function parseSupabaseConfiguration(
  environment: SupplierMatchRerankEnvironment,
): { url: URL; key: string } | null {
  const rawUrl = environment.supabaseUrl?.trim();
  const key = environment.supabasePublishableKey?.trim();
  if (!rawUrl || !key || key.length > 4_096) return null;
  if (
    /^(?:sb_secret_|supabase_secret_)/.test(key)
    || jwtRole(key) === "service_role"
  ) {
    return null;
  }
  try {
    const url = new URL(rawUrl);
    const local = isLocalHostname(url.hostname);
    if (
      url.username
      || url.password
      || url.search
      || url.hash
      || url.pathname !== "/"
      || (local ? url.protocol !== "http:" : url.protocol !== "https:")
    ) {
      return null;
    }
    return { url, key };
  } catch {
    return null;
  }
}

function parseOpenAiEndpoint(value: string | undefined): URL | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const base = new URL(raw.endsWith("/") ? raw : `${raw}/`);
    if (
      base.protocol !== "https:"
      || base.username
      || base.password
      || base.search
      || base.hash
    ) {
      return null;
    }
    return new URL("responses", base);
  } catch {
    return null;
  }
}

function serverConfiguration(
  environment: SupplierMatchRerankEnvironment,
): ServerConfiguration | null {
  const supabase = parseSupabaseConfiguration(environment);
  if (!supabase) return null;

  const openAiEndpoint = parseOpenAiEndpoint(environment.openAiBaseUrl);
  const openAiApiKey = environment.openAiApiKey?.trim() ?? "";
  if (openAiEndpoint && openAiApiKey && openAiApiKey.length <= 4_096) {
    return {
      supabaseUrl: supabase.url,
      publishableKey: supabase.key,
      adapter: "netlify-ai-gateway",
      openAiEndpoint,
      openAiApiKey,
      model: OPENAI_MODEL,
    };
  }
  if (isLocalHostname(supabase.url.hostname)) {
    return {
      supabaseUrl: supabase.url,
      publishableKey: supabase.key,
      adapter: "fixture",
      openAiEndpoint: null,
      openAiApiKey: null,
      model: "local-semantic-fixture-v1",
    };
  }
  return {
    supabaseUrl: supabase.url,
    publishableKey: supabase.key,
    adapter: null,
    openAiEndpoint: null,
    openAiApiKey: null,
    model: null,
  };
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

async function readBoundedJson(
  responseOrRequest: Response | Request,
  maximumBytes: number,
  service?: UpstreamError["service"],
): Promise<unknown> {
  const contentType =
    responseOrRequest.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    if (service) {
      throw new UpstreamError(
        service,
        "unexpected_content_type",
        responseOrRequest instanceof Response ? responseOrRequest.status : null,
      );
    }
    throw new RequestError("Content-Type must be application/json");
  }
  const declaredLength = responseOrRequest.headers.get("Content-Length");
  if (
    declaredLength
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    if (service) {
      throw new UpstreamError(
        service,
        "response_too_large",
        responseOrRequest instanceof Response ? responseOrRequest.status : null,
      );
    }
    throw new RequestError("Body is too large");
  }
  const reader = responseOrRequest.body?.getReader();
  if (!reader) throw new RequestError("Body is missing");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("body too large");
        throw service
          ? new UpstreamError(service, "response_too_large")
          : new RequestError("Body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    if (service) throw new UpstreamError(service, "invalid_json");
    throw new RequestError("Body is not valid JSON");
  }
}

function stringList(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const strings = value.map((entry) =>
    compactString(entry, 1, maximumLength)
  );
  if (strings.some((entry) => !entry)) return null;
  return [...new Set(strings as string[])];
}

function parseCandidate(value: unknown): SupplierSemanticCandidate | null {
  const candidate = record(value);
  const productId = candidate?.productId;
  const productFingerprint = candidate?.productFingerprint;
  const displayName = compactString(candidate?.displayName, 1, 240);
  const brand = nullableString(candidate?.brand, 120);
  const category = nullableString(candidate?.category, 300);
  const purchaseUnit = compactString(candidate?.purchaseUnit, 1, 40);
  const packageAmount = candidate?.packageAmount;
  const packageUnit = compactString(candidate?.packageUnit, 1, 40);
  const deterministicScore = candidate?.deterministicScore;
  const deterministicReasons = stringList(
    candidate?.deterministicReasons,
    20,
    500,
  );
  if (
    !isUuid(productId)
    || !isFingerprint(productFingerprint)
    || !displayName
    || (candidate?.brand !== null && !brand)
    || (candidate?.category !== null && !category)
    || !purchaseUnit
    || typeof packageAmount !== "number"
    || !Number.isFinite(packageAmount)
    || packageAmount <= 0
    || !packageUnit
    || typeof deterministicScore !== "number"
    || !Number.isFinite(deterministicScore)
    || deterministicScore < 0
    || deterministicScore > 100
    || !deterministicReasons
  ) {
    return null;
  }
  return {
    productId,
    productFingerprint,
    displayName,
    brand,
    category,
    purchaseUnit,
    packageAmount,
    packageUnit,
    deterministicScore,
    deterministicReasons,
  };
}

function parseIngredient(value: unknown): SupplierSemanticIngredient | null {
  const ingredient = record(value);
  const canonicalKey = ingredient?.canonicalKey;
  const displayName = compactString(ingredient?.displayName, 1, 180);
  const requiredUnit = compactString(ingredient?.requiredUnit, 1, 40);
  const category = nullableString(ingredient?.category, 180);
  const comment = nullableString(ingredient?.comment, 500);
  const recipeNames = stringList(ingredient?.recipeNames, 30, 180);
  const dietaryLabels = stringList(ingredient?.dietaryLabels, 30, 80);
  if (
    !isFingerprint(canonicalKey)
    || !displayName
    || !requiredUnit
    || (ingredient?.category !== null && !category)
    || (ingredient?.comment !== null && !comment)
    || !recipeNames
    || !dietaryLabels
  ) {
    return null;
  }
  return {
    canonicalKey,
    displayName,
    requiredUnit,
    category,
    comment,
    recipeNames,
    dietaryLabels,
  };
}

function parseGroup(value: unknown): SupplierSemanticRerankGroup | null {
  const group = record(value);
  const ingredient = parseIngredient(group?.ingredient);
  const rawCandidates = group?.candidates;
  if (
    !ingredient
    || !Array.isArray(rawCandidates)
    || rawCandidates.length < 1
    || rawCandidates.length > SUPPLIER_SEMANTIC_MAX_CANDIDATES_PER_GROUP
  ) {
    return null;
  }
  const candidates = rawCandidates.map(parseCandidate);
  if (
    candidates.some((candidate) => !candidate)
    || new Set(candidates.map((candidate) => candidate?.productId)).size
      !== candidates.length
  ) {
    return null;
  }
  return {
    ingredient,
    candidates: candidates as SupplierSemanticCandidate[],
  };
}

function parseRequest(value: unknown): AuthenticatedRequest {
  const body = record(value);
  const organizationId = body?.organizationId;
  const campId = body?.campId;
  const supplierAccountId = body?.supplierAccountId;
  const groups = body?.groups;
  if (
    !isUuid(organizationId)
    || !isUuid(campId)
    || !isUuid(supplierAccountId)
    || body?.promptVersion !== SUPPLIER_SEMANTIC_PROMPT_VERSION
    || !Array.isArray(groups)
    || groups.length < 1
    || groups.length > SUPPLIER_SEMANTIC_MAX_GROUPS_PER_REQUEST
  ) {
    throw new RequestError("Invalid rerank request");
  }
  const parsedGroups = groups.map(parseGroup);
  if (
    parsedGroups.some((group) => !group)
    || new Set(parsedGroups.map((group) =>
      group?.ingredient.canonicalKey
    )).size !== parsedGroups.length
  ) {
    throw new RequestError("Invalid rerank groups");
  }
  return {
    organizationId,
    campId,
    supplierAccountId,
    groups: parsedGroups as SupplierSemanticRerankGroup[],
  };
}

function authorizationHeader(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  return authorization
      && authorization.length <= 8_192
      && /^Bearer [^\s]+$/.test(authorization)
    ? authorization
    : null;
}

function supabaseHeaders(
  configuration: ServerConfiguration,
  authorization: string,
  json = false,
): HeadersInit {
  return {
    "Accept": "application/json",
    "apikey": configuration.publishableKey,
    "Authorization": authorization,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function supabaseJson(
  fetcher: FetchLike,
  configuration: ServerConfiguration,
  authorization: string,
  input: URL,
  init: RequestInit = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(input, {
      ...init,
      headers: {
        ...supabaseHeaders(
          configuration,
          authorization,
          typeof init.body === "string",
        ),
        ...init.headers,
      },
      redirect: "error",
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamError("supabase", "network_error");
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new UpstreamError(
      "supabase",
      "unexpected_status",
      response.status,
    );
  }
  return readBoundedJson(response, SUPABASE_BODY_LIMIT, "supabase");
}

async function verifyUser(
  fetcher: FetchLike,
  configuration: ServerConfiguration,
  authorization: string,
): Promise<string | null> {
  const payload = await supabaseJson(
    fetcher,
    configuration,
    authorization,
    new URL("/auth/v1/user", configuration.supabaseUrl),
  );
  const userId = record(payload)?.id;
  return isUuid(userId) ? userId : null;
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
  const payload = await supabaseJson(
    fetcher,
    configuration,
    authorization,
    url,
  );
  return Array.isArray(payload) && payload.length === 1;
}

async function fetchAccount(
  fetcher: FetchLike,
  configuration: ServerConfiguration,
  authorization: string,
  organizationId: string,
  supplierAccountId: string,
): Promise<SupplierAccountRecord | null> {
  const url = new URL("/rest/v1/supplier_accounts", configuration.supabaseUrl);
  url.searchParams.set("organization_id", `eq.${organizationId}`);
  url.searchParams.set("id", `eq.${supplierAccountId}`);
  url.searchParams.set("active", "eq.true");
  url.searchParams.set(
    "select",
    "id,provider_key,provider_location_id",
  );
  url.searchParams.set("limit", "2");
  const payload = await supabaseJson(
    fetcher,
    configuration,
    authorization,
    url,
  );
  if (!Array.isArray(payload) || payload.length !== 1) return null;
  const account = record(payload[0]);
  return isUuid(account?.id)
      && typeof account.provider_key === "string"
      && (
        account.provider_location_id === null
        || typeof account.provider_location_id === "string"
      )
    ? account as unknown as SupplierAccountRecord
    : null;
}

function safeProduct(value: unknown): SupplierProductRecord | null {
  const product = record(value);
  return isUuid(product?.id)
      && compactString(product.display_name, 1, 240)
      && (product.brand === null || compactString(product.brand, 1, 120))
      && (
        product.category === null
        || compactString(product.category, 1, 300)
      )
      && compactString(product.purchase_unit, 1, 40)
      && typeof product.package_amount === "number"
      && Number.isFinite(product.package_amount)
      && product.package_amount > 0
      && compactString(product.package_unit, 1, 40)
      && typeof product.minimum_order_units === "number"
      && Number.isSafeInteger(product.minimum_order_units)
      && product.minimum_order_units > 0
      && typeof product.catch_weight === "boolean"
      && isFingerprint(product.product_fingerprint)
    ? product as unknown as SupplierProductRecord
    : null;
}

async function fetchProducts(
  fetcher: FetchLike,
  configuration: ServerConfiguration,
  authorization: string,
  request: AuthenticatedRequest,
): Promise<Map<string, SupplierProductRecord>> {
  const ids = [...new Set(request.groups.flatMap((group) =>
    group.candidates.map((candidate) => candidate.productId)
  ))];
  const url = new URL("/rest/v1/supplier_products", configuration.supabaseUrl);
  url.searchParams.set("organization_id", `eq.${request.organizationId}`);
  url.searchParams.set(
    "supplier_account_id",
    `eq.${request.supplierAccountId}`,
  );
  url.searchParams.set("active", "eq.true");
  url.searchParams.set("id", `in.(${ids.join(",")})`);
  url.searchParams.set(
    "select",
    "id,display_name,brand,category,purchase_unit,package_amount,package_unit,minimum_order_units,catch_weight,product_fingerprint,packaging_metadata,source_metadata",
  );
  url.searchParams.set("limit", String(ids.length + 1));
  const payload = await supabaseJson(
    fetcher,
    configuration,
    authorization,
    url,
  );
  if (!Array.isArray(payload)) return new Map();
  const products = payload.map(safeProduct);
  if (products.some((product) => !product)) return new Map();
  return new Map(
    (products as SupplierProductRecord[]).map((product) => [
      product.id,
      product,
    ]),
  );
}

async function fetchRejectedFingerprints(
  fetcher: FetchLike,
  configuration: ServerConfiguration,
  authorization: string,
  request: AuthenticatedRequest,
): Promise<Set<string>> {
  const canonicalKeys = request.groups.map((group) =>
    group.ingredient.canonicalKey
  );
  const url = new URL(
    "/rest/v1/supplier_match_candidates",
    configuration.supabaseUrl,
  );
  url.searchParams.set("organization_id", `eq.${request.organizationId}`);
  url.searchParams.set(
    "supplier_account_id",
    `eq.${request.supplierAccountId}`,
  );
  url.searchParams.set("status", "eq.rejected");
  url.searchParams.set(
    "canonical_key",
    `in.(${canonicalKeys.join(",")})`,
  );
  url.searchParams.set("select", "canonical_key,product_fingerprint");
  url.searchParams.set("limit", "1000");
  const payload = await supabaseJson(
    fetcher,
    configuration,
    authorization,
    url,
  );
  if (!Array.isArray(payload)) return new Set();
  return new Set(payload.flatMap((value) => {
    const row = record(value);
    return isFingerprint(row?.canonical_key)
        && isFingerprint(row.product_fingerprint)
      ? [`${row.canonical_key}:${row.product_fingerprint}`]
      : [];
  }));
}

async function fetchTrustedIngredientContexts(
  fetcher: FetchLike,
  configuration: ServerConfiguration,
  authorization: string,
  request: AuthenticatedRequest,
): Promise<Map<string, SupplierSemanticIngredient>> {
  const url = new URL(
    "/rest/v1/rpc/get_supplier_semantic_match_context",
    configuration.supabaseUrl,
  );
  const payload = await supabaseJson(
    fetcher,
    configuration,
    authorization,
    url,
    {
      method: "POST",
      body: JSON.stringify({
        p_organization_id: request.organizationId,
        p_camp_id: request.campId,
        p_canonical_keys: request.groups.map((group) =>
          group.ingredient.canonicalKey
        ),
      }),
    },
  );
  if (!Array.isArray(payload)) return new Map();
  const ingredients = payload.map(parseIngredient);
  if (
    ingredients.some((ingredient) => !ingredient)
    || new Set(
      ingredients.map((ingredient) => ingredient?.canonicalKey),
    ).size !== request.groups.length
  ) {
    return new Map();
  }
  const trusted = new Map(
    (ingredients as SupplierSemanticIngredient[]).map((ingredient) => [
      ingredient.canonicalKey,
      ingredient,
    ]),
  );
  return request.groups.every((group) =>
      trusted.has(group.ingredient.canonicalKey)
    )
    ? trusted
    : new Map();
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("sv-SE")
    .replace(/&/g, " och ")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compatibleUnits(left: string, right: string): boolean {
  const aliases: Readonly<Record<string, string>> = {
    kilogram: "kg",
    kilo: "kg",
    gram: "g",
    milligram: "mg",
    liter: "l",
    litre: "l",
    deciliter: "dl",
    centiliter: "cl",
    milliliter: "ml",
    matsked: "msk",
    matskedar: "msk",
    tesked: "tsk",
    teskedar: "tsk",
    styck: "st",
    stycken: "st",
  };
  const unit = (value: string) => {
    const normalized = normalizeText(value).replace(/\s+/g, "");
    return aliases[normalized] ?? normalized;
  };
  const leftUnit = unit(left);
  const rightUnit = unit(right);
  if (leftUnit === rightUnit) return true;
  const mass = new Set(["kg", "hg", "g", "mg"]);
  const volume = new Set(["l", "dl", "cl", "ml", "msk", "tsk"]);
  return (
    mass.has(leftUnit) && mass.has(rightUnit)
  ) || (
    volume.has(leftUnit) && volume.has(rightUnit)
  );
}

function verifiedInnerUnit(
  product: SupplierProductRecord,
): { count: number; label: string } | null {
  const packaging = record(product.packaging_metadata);
  const count = packaging?.inner_unit_count;
  const label = compactString(packaging?.inner_unit_label, 1, 80);
  return typeof count === "number"
      && Number.isSafeInteger(count)
      && count > 0
      && count <= 10_000
      && label
    ? { count, label }
    : null;
}

function productSupportsRequiredUnit(
  product: SupplierProductRecord,
  requiredUnit: string,
): boolean {
  return compatibleUnits(product.package_unit, requiredUnit)
    || (
      compatibleUnits("st", requiredUnit)
      && verifiedInnerUnit(product) !== null
    );
}

type DietaryRequirement =
  | "gluten_free"
  | "lactose_free"
  | "milk_free"
  | "vegan"
  | "vegetarian";

function dietaryRequirements(
  group: SupplierSemanticRerankGroup,
): DietaryRequirement[] {
  const text = normalizeText([
    group.ingredient.displayName,
    group.ingredient.comment ?? "",
    ...group.ingredient.dietaryLabels,
  ].join(" "));
  const tokens = new Set(text.split(" "));
  const requirements = [
    [
      "gluten_free",
      ["gluten", "glutenfri", "glutenfritt", "glutenfria"],
    ],
    [
      "lactose_free",
      ["laktos", "laktosfri", "laktosfritt", "laktosfria"],
    ],
    [
      "milk_free",
      [
        "mjölk",
        "mjölkprotein",
        "mjölkfri",
        "mjölkfritt",
        "mjölkfria",
      ],
    ],
    ["vegan", ["vegan", "vegansk", "veganskt", "veganska"]],
    [
      "vegetarian",
      ["vegetarian", "vegetarisk", "vegetariskt", "vegetariska"],
    ],
  ] as const;
  return requirements.flatMap(([key, variants]) =>
    variants.some((variant) => tokens.has(variant)) ? [key] : []
  );
}

function productMeetsDietaryRequirements(
  group: SupplierSemanticRerankGroup,
  product: SupplierProductRecord,
): boolean {
  const requirements = dietaryRequirements(group);
  if (!requirements.length) return true;
  const text = ` ${normalizeText(
    `${product.display_name} ${product.category ?? ""}`,
  )} `;
  const productMarkers: Readonly<Record<
    DietaryRequirement,
    readonly string[]
  >> = {
    gluten_free: ["glutenfri", "glutenfritt", "glutenfria"],
    lactose_free: ["laktosfri", "laktosfritt", "laktosfria"],
    milk_free: ["mjölkfri", "mjölkfritt", "mjölkfria"],
    vegan: ["vegan", "vegansk", "veganskt", "veganska"],
    vegetarian: ["vegetarisk", "vegetariskt", "vegetariska"],
  };
  return requirements.every((requirement) =>
    productMarkers[requirement].some((marker) =>
      text.includes(` ${marker} `)
    )
  );
}

function isIcaSicklaAccount(account: SupplierAccountRecord): boolean {
  return account.provider_key === "ica"
    && account.provider_location_id === ICA_SICKLA_STORE_ID;
}

function isVerifiedIcaProduct(
  account: SupplierAccountRecord,
  product: SupplierProductRecord,
): boolean {
  if (!isIcaSicklaAccount(account)) return false;
  const metadata = record(product.source_metadata);
  const packaging = record(product.packaging_metadata);
  return metadata?.source === "ica_public_webshop"
    && metadata.store_id === ICA_SICKLA_STORE_ID
    && packaging?.normalization_version
      === ICA_CATALOGUE_NORMALISATION_VERSION;
}

function validatedGroups(
  request: AuthenticatedRequest,
  account: SupplierAccountRecord,
  products: ReadonlyMap<string, SupplierProductRecord>,
  rejected: ReadonlySet<string>,
): SupplierSemanticRerankGroup[] | null {
  const groups: SupplierSemanticRerankGroup[] = [];
  for (const group of request.groups) {
    const candidates = group.candidates.flatMap((candidate) => {
      const product = products.get(candidate.productId);
      const innerUnit = product ? verifiedInnerUnit(product) : null;
      if (
        !product
        || product.product_fingerprint !== candidate.productFingerprint
        || product.catch_weight
        || !productSupportsRequiredUnit(
          product,
          group.ingredient.requiredUnit,
        )
        || !productMeetsDietaryRequirements(group, product)
        || !isVerifiedIcaProduct(account, product)
        || rejected.has(
          `${group.ingredient.canonicalKey}:${product.product_fingerprint}`,
        )
      ) {
        return [];
      }
      return [{
        ...candidate,
        displayName: product.display_name,
        brand: product.brand,
        category: product.category,
        purchaseUnit: product.purchase_unit,
        packageAmount: product.package_amount,
        packageUnit: product.package_unit,
        innerUnitCount: innerUnit?.count ?? null,
        innerUnitLabel: innerUnit?.label ?? null,
      }];
    });
    if (!candidates.length) return null;
    groups.push({ ingredient: group.ingredient, candidates });
  }
  return groups;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")
  }}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function cacheIdentity(
  group: SupplierSemanticRerankGroup,
): Promise<CacheIdentity> {
  return {
    contextFingerprint: await sha256(stableJson({
      promptVersion: SUPPLIER_SEMANTIC_PROMPT_VERSION,
      ingredient: group.ingredient,
    })),
    candidateSetFingerprint: await sha256(stableJson(
      group.candidates.map((candidate) => ({
        productId: candidate.productId,
        productFingerprint: candidate.productFingerprint,
        displayName: candidate.displayName,
        brand: candidate.brand,
        category: candidate.category,
        purchaseUnit: candidate.purchaseUnit,
        packageAmount: candidate.packageAmount,
        packageUnit: candidate.packageUnit,
        innerUnitCount: candidate.innerUnitCount ?? null,
        innerUnitLabel: candidate.innerUnitLabel ?? null,
        deterministicScore: candidate.deterministicScore,
        deterministicReasons: candidate.deterministicReasons,
      })),
    )),
  };
}

function memoryCacheKey(
  configuration: ServerConfiguration,
  request: AuthenticatedRequest,
  group: SupplierSemanticRerankGroup,
  identity: CacheIdentity,
): string {
  return [
    request.organizationId,
    request.campId,
    request.supplierAccountId,
    group.ingredient.canonicalKey,
    identity.contextFingerprint,
    identity.candidateSetFingerprint,
    SUPPLIER_SEMANTIC_PROMPT_VERSION,
    configuration.adapter ?? "none",
    configuration.model ?? "none",
  ].join("\u001f");
}

function readMemoryCache(
  cache: Map<string, MemoryCacheEntry>,
  key: string,
  group: SupplierSemanticRerankGroup,
  currentTime: number,
): SupplierSemanticRerankResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= currentTime) {
    cache.delete(key);
    return null;
  }
  return parseCachedResult(entry.result, group, true);
}

function writeMemoryCache(
  cache: Map<string, MemoryCacheEntry>,
  key: string,
  result: SupplierSemanticRerankResult,
  currentTime: number,
): void {
  for (const [candidateKey, entry] of cache) {
    if (entry.expiresAt <= currentTime) cache.delete(candidateKey);
  }
  while (cache.size >= MEMORY_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    cache.delete(oldestKey);
  }
  cache.set(key, {
    expiresAt: currentTime + MEMORY_CACHE_TTL_MS,
    result: { ...result, cached: false },
  });
}

function parseCachedResult(
  value: unknown,
  group: SupplierSemanticRerankGroup,
  cached: boolean,
): SupplierSemanticRerankResult | null {
  const result = record(value);
  const decision = result?.decision;
  const selectedProductId = result?.selectedProductId;
  const confidence = result?.confidence;
  const explanation = compactString(result?.explanation, 1, 500);
  if (
    (decision !== "match" && decision !== "ambiguous" && decision !== "no_match")
    || (typeof selectedProductId !== "string" && selectedProductId !== null)
    || typeof confidence !== "number"
    || !Number.isFinite(confidence)
    || confidence < 0
    || confidence > 1
    || !explanation
  ) {
    return null;
  }
  const selectedExists = typeof selectedProductId === "string"
    && group.candidates.some((candidate) =>
      candidate.productId === selectedProductId
    );
  if (
    (decision === "match" && !selectedExists)
    || (decision !== "match" && selectedProductId !== null)
  ) {
    return null;
  }
  return {
    canonicalKey: group.ingredient.canonicalKey,
    decision,
    selectedProductId,
    confidence,
    explanation,
    cached,
  };
}

function fixtureResults(
  groups: readonly SupplierSemanticRerankGroup[],
): SupplierSemanticRerankResult[] {
  return groups.map((group) => {
    const [top, runnerUp] = group.candidates;
    const margin = top && runnerUp
      ? top.deterministicScore - runnerUp.deterministicScore
      : null;
    const match = Boolean(
      top
      && top.deterministicScore >= 70
      && (margin === null || margin >= 4),
    );
    return {
      canonicalKey: group.ingredient.canonicalKey,
      decision: match ? "match" : "ambiguous",
      selectedProductId: match ? top!.productId : null,
      confidence: match ? 0.75 : 0.5,
      explanation: match
        ? "Lokal testadapter: den högst rankade säkerhetsfiltrerade artikeln passar recept- och kategorisammanhanget bäst."
        : "Lokal testadapter: kandidaterna är för lika och måste jämföras manuellt.",
      cached: false,
    };
  });
}

function openAiResponseText(payload: unknown): string | null {
  const response = record(payload);
  if (typeof response?.output_text === "string") return response.output_text;
  if (!Array.isArray(response?.output)) return null;
  for (const item of response.output) {
    const message = record(item);
    if (message?.type !== "message" || !Array.isArray(message.content)) {
      continue;
    }
    for (const content of message.content) {
      const output = record(content);
      if (output?.type === "output_text" && typeof output.text === "string") {
        return output.text;
      }
      if (output?.type === "refusal") return null;
    }
  }
  return null;
}

async function callOpenAi(
  fetcher: FetchLike,
  configuration: ServerConfiguration,
  userId: string,
  groups: readonly SupplierSemanticRerankGroup[],
): Promise<SupplierSemanticRerankResult[]> {
  if (
    !configuration.openAiEndpoint
    || !configuration.openAiApiKey
    || !configuration.model
  ) {
    throw new UpstreamError("openai", "not_configured");
  }
  let response: Response;
  try {
    response = await fetcher(configuration.openAiEndpoint, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${configuration.openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: configuration.model,
        instructions: [
          "Du omrankar riktiga svenska dagligvaruartiklar mot en råvara.",
          "Välj endast ett productId som finns bland kandidaterna, eller välj ambiguous/no_match.",
          "Receptnamn och kategori avgör skillnader som färsk, fryst, konserv, pulver och avsedd såstyp.",
          "Enheter och förpackningar är redan säkerhetsfiltrerade och får inte omtolkas. innerUnitCount är ett verifierat antal delar i den beställningsbara förpackningen när det finns.",
          "Pris och lager får inte påverka den semantiska bedömningen.",
          "Svara med en kort svensk förklaring. Resultatet kommer alltid att granskas av en människa.",
        ].join(" "),
        input: JSON.stringify({ groups }),
        reasoning: { effort: "minimal" },
        store: false,
        max_output_tokens: 1_600,
        safety_identifier: (await sha256(userId)).slice(0, 64),
        text: {
          format: {
            type: "json_schema",
            name: "supplier_product_rerank",
            strict: true,
            schema: {
              type: "object",
              properties: {
                results: {
                  type: "array",
                  minItems: groups.length,
                  maxItems: groups.length,
                  items: {
                    type: "object",
                    properties: {
                      canonicalKey: { type: "string" },
                      decision: {
                        type: "string",
                        enum: ["match", "ambiguous", "no_match"],
                      },
                      selectedProductId: {
                        type: ["string", "null"],
                      },
                      confidence: {
                        type: "number",
                        minimum: 0,
                        maximum: 1,
                      },
                      explanation: { type: "string" },
                    },
                    required: [
                      "canonicalKey",
                      "decision",
                      "selectedProductId",
                      "confidence",
                      "explanation",
                    ],
                    additionalProperties: false,
                  },
                },
              },
              required: ["results"],
              additionalProperties: false,
            },
          },
        },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamError("openai", "network_error");
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new UpstreamError("openai", "unexpected_status", response.status);
  }
  const payload = await readBoundedJson(
    response,
    OPENAI_BODY_LIMIT,
    "openai",
  );
  const outputText = openAiResponseText(payload);
  if (!outputText) throw new UpstreamError("openai", "missing_output");

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText) as unknown;
  } catch {
    throw new UpstreamError("openai", "invalid_structured_output");
  }
  const rawResults = record(parsed)?.results;
  if (!Array.isArray(rawResults) || rawResults.length !== groups.length) {
    throw new UpstreamError("openai", "invalid_structured_output");
  }
  const groupsByKey = new Map(
    groups.map((group) => [group.ingredient.canonicalKey, group]),
  );
  const results = rawResults.map((rawResult) => {
    const key = record(rawResult)?.canonicalKey;
    const group = typeof key === "string" ? groupsByKey.get(key) : undefined;
    return group ? parseCachedResult(rawResult, group, false) : null;
  });
  if (
    results.some((result) => !result)
    || new Set(results.map((result) => result?.canonicalKey)).size
      !== groups.length
  ) {
    throw new UpstreamError("openai", "invalid_structured_output");
  }
  return results as SupplierSemanticRerankResult[];
}

function consumeRateLimit(
  states: Map<string, RateState>,
  userId: string,
  groups: number,
  now: number,
): boolean {
  const previous = states.get(userId);
  const state = !previous || now - previous.startedAt >= RATE_WINDOW_MS
    ? { startedAt: now, groups: 0 }
    : previous;
  if (state.groups + groups > RATE_GROUP_LIMIT) {
    states.set(userId, state);
    return false;
  }
  state.groups += groups;
  states.set(userId, state);
  if (states.size > 1_000) {
    for (const [id, entry] of states) {
      if (now - entry.startedAt >= RATE_WINDOW_MS * 2) states.delete(id);
    }
  }
  return true;
}

export function createSupplierMatchRerankHandler(
  options: SupplierMatchRerankHandlerOptions,
): (request: Request) => Promise<Response> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const logger = options.logger ?? console;
  const rateStates = new Map<string, RateState>();
  const semanticCache = new Map<string, MemoryCacheEntry>();

  return async (request: Request): Promise<Response> => {
    if (!isSameOriginBrowserRequest(request)) {
      return jsonResponse(
        { error: "Anropet kommer från en otillåten webbplats." },
        403,
      );
    }
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Metoden stöds inte." }),
        {
          status: 405,
          headers: {
            "Allow": "POST",
            "Cache-Control": "private, no-store",
            "Content-Type": "application/json; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
          },
        },
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

    let body: AuthenticatedRequest;
    try {
      body = parseRequest(await readBoundedJson(
        request,
        REQUEST_BODY_LIMIT,
      ));
    } catch {
      return jsonResponse(
        { error: "Matchningsunderlaget är ogiltigt eller för stort." },
        400,
      );
    }

    let userId: string | null;
    try {
      userId = await verifyUser(fetcher, configuration, authorization);
      if (
        !userId
        || !await hasActiveMembership(
          fetcher,
          configuration,
          authorization,
          body.organizationId,
          userId,
        )
      ) {
        return jsonResponse(
          { error: "Aktivt organisationsmedlemskap krävs." },
          userId ? 403 : 401,
        );
      }
    } catch (error) {
      logger.error(JSON.stringify({
        stage: "verify_supplier_match_rerank_access",
        reason: error instanceof UpstreamError
          ? error.reason
          : "unexpected_error",
      }));
      return jsonResponse(
        { error: "Behörigheten kunde inte verifieras just nu." },
        502,
      );
    }

    let account: SupplierAccountRecord | null;
    let products: Map<string, SupplierProductRecord>;
    let rejected: Set<string>;
    let trustedContexts: Map<string, SupplierSemanticIngredient>;
    try {
      [account, products, rejected, trustedContexts] = await Promise.all([
        fetchAccount(
          fetcher,
          configuration,
          authorization,
          body.organizationId,
          body.supplierAccountId,
        ),
        fetchProducts(fetcher, configuration, authorization, body),
        fetchRejectedFingerprints(
          fetcher,
          configuration,
          authorization,
          body,
        ),
        fetchTrustedIngredientContexts(
          fetcher,
          configuration,
          authorization,
          body,
        ),
      ]);
    } catch (error) {
      logger.error(JSON.stringify({
        stage: "validate_supplier_match_rerank_products",
        reason: error instanceof UpstreamError
          ? error.reason
          : "unexpected_error",
      }));
      return jsonResponse(
        { error: "Leverantörsartiklarna kunde inte verifieras just nu." },
        502,
      );
    }
    if (!account) {
      return jsonResponse({ error: "Leverantörskontot finns inte." }, 404);
    }
    if (!isIcaSicklaAccount(account)) {
      return jsonResponse(
        { error: "Semantisk matchning stöds endast för ICA Kvantum Sickla." },
        409,
      );
    }
    if (trustedContexts.size !== body.groups.length) {
      return jsonResponse(
        { error: "Inköpsunderlaget är inaktuellt och måste räknas om." },
        409,
      );
    }
    const trustedBody: AuthenticatedRequest = {
      ...body,
      groups: body.groups.map((group) => ({
        ingredient: trustedContexts.get(
          group.ingredient.canonicalKey,
        )!,
        candidates: group.candidates,
      })),
    };
    const groups = validatedGroups(
      trustedBody,
      account,
      products,
      rejected,
    );
    if (!groups) {
      return jsonResponse(
        { error: "Kandidatfältet är inaktuellt eller bryter mot säkerhetsreglerna." },
        409,
      );
    }
    if (!configuration.adapter || !configuration.model) {
      return jsonResponse({
        configured: false,
        adapter: "none",
        model: null,
        promptVersion: SUPPLIER_SEMANTIC_PROMPT_VERSION,
        results: [],
      }, 200);
    }

    const identities = await Promise.all(groups.map(cacheIdentity));
    const cacheKeys = groups.map((group, index) =>
      memoryCacheKey(
        configuration,
        trustedBody,
        group,
        identities[index]!,
      )
    );
    const currentTime = now();
    const cachedResults = groups.map((group, index) =>
      readMemoryCache(
        semanticCache,
        cacheKeys[index]!,
        group,
        currentTime,
      )
    );
    const misses = groups.flatMap((group, index) =>
      cachedResults[index] ? [] : [{ group, index }]
    );
    if (
      misses.length
      && !consumeRateLimit(rateStates, userId!, misses.length, currentTime)
    ) {
      return jsonResponse(
        { error: "För många semantiska matchningar. Försök igen om en minut." },
        429,
      );
    }

    let freshResults: SupplierSemanticRerankResult[] = [];
    if (misses.length) {
      try {
        freshResults = configuration.adapter === "fixture"
          ? fixtureResults(misses.map((miss) => miss.group))
          : await callOpenAi(
              fetcher,
              configuration,
              userId!,
              misses.map((miss) => miss.group),
            );
      } catch (error) {
        logger.error(JSON.stringify({
          stage: "run_supplier_match_rerank",
          reason: error instanceof UpstreamError
            ? error.reason
            : "unexpected_error",
          upstreamStatus: error instanceof UpstreamError
            ? error.upstreamStatus
            : null,
        }));
        return jsonResponse(
          { error: "Den semantiska matchningen kunde inte köras just nu." },
          502,
        );
      }
    }

    const results = [...cachedResults];
    for (let index = 0; index < misses.length; index += 1) {
      const miss = misses[index]!;
      const result = freshResults[index]!;
      results[miss.index] = result;
      writeMemoryCache(
        semanticCache,
        cacheKeys[miss.index]!,
        result,
        currentTime,
      );
    }

    return jsonResponse({
      configured: true,
      adapter: configuration.adapter,
      model: configuration.model,
      promptVersion: SUPPLIER_SEMANTIC_PROMPT_VERSION,
      results,
    }, 200);
  };
}
