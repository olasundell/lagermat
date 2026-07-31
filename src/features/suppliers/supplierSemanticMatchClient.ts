import {
  SUPPLIER_SEMANTIC_MATCH_ENDPOINT,
  SUPPLIER_SEMANTIC_MAX_GROUPS_PER_REQUEST,
  SUPPLIER_SEMANTIC_PROMPT_VERSION,
  type SupplierSemanticRerankGroup,
  type SupplierSemanticRerankResponse,
  type SupplierSemanticRerankResult,
} from "./supplierSemanticMatch";

const RESPONSE_BODY_LIMIT = 512_000;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface SupplierSemanticSessionClient {
  auth: {
    getSession(): Promise<{
      data: {
        session: { access_token: string } | null;
      };
      error: { message: string } | null;
    }>;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function responsePayload(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("Content-Length");
  if (
    contentLength
    && (!/^\d+$/.test(contentLength) || Number(contentLength) > RESPONSE_BODY_LIMIT)
  ) {
    throw new Error("Den semantiska matchningen gav ett för stort svar.");
  }
  const text = await response.text();
  if (text.length > RESPONSE_BODY_LIMIT) {
    throw new Error("Den semantiska matchningen gav ett för stort svar.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Den semantiska matchningen svarade i ett oväntat format.");
  }
}

function serverError(payload: unknown): string | null {
  const error = record(payload)?.error;
  return typeof error === "string" && error.length <= 240 ? error : null;
}

function validResult(
  value: unknown,
  groupsByCanonicalKey: ReadonlyMap<string, SupplierSemanticRerankGroup>,
): SupplierSemanticRerankResult | null {
  const result = record(value);
  const canonicalKey = result?.canonicalKey;
  const decision = result?.decision;
  const selectedProductId = result?.selectedProductId;
  const confidence = result?.confidence;
  const explanation = result?.explanation;
  const cached = result?.cached;
  if (
    typeof canonicalKey !== "string"
    || !groupsByCanonicalKey.has(canonicalKey)
    || (
      decision !== "match"
      && decision !== "ambiguous"
      && decision !== "no_match"
    )
    || (typeof selectedProductId !== "string" && selectedProductId !== null)
    || typeof confidence !== "number"
    || !Number.isFinite(confidence)
    || confidence < 0
    || confidence > 1
    || typeof explanation !== "string"
    || !explanation.trim()
    || explanation.length > 500
    || typeof cached !== "boolean"
  ) {
    return null;
  }
  const selectedCandidate = selectedProductId
    ? groupsByCanonicalKey.get(canonicalKey)?.candidates.some((candidate) =>
        candidate.productId === selectedProductId
      )
    : false;
  if (
    (decision === "match" && !selectedCandidate)
    || (decision !== "match" && selectedProductId !== null)
  ) {
    return null;
  }
  return {
    canonicalKey,
    decision,
    selectedProductId,
    confidence,
    explanation: explanation.trim(),
    cached,
  };
}

function validResponse(
  value: unknown,
  groups: readonly SupplierSemanticRerankGroup[],
): SupplierSemanticRerankResponse | null {
  const body = record(value);
  const configured = body?.configured;
  const adapter = body?.adapter;
  const model = body?.model;
  const promptVersion = body?.promptVersion;
  const rawResults = body?.results;
  if (
    typeof configured !== "boolean"
    || (
      adapter !== "netlify-ai-gateway"
      && adapter !== "fixture"
      && adapter !== "none"
    )
    || (typeof model !== "string" && model !== null)
    || (typeof model === "string" && (model.length < 1 || model.length > 120))
    || promptVersion !== SUPPLIER_SEMANTIC_PROMPT_VERSION
    || !Array.isArray(rawResults)
  ) {
    return null;
  }
  if (!configured) {
    return adapter === "none" && model === null && rawResults.length === 0
      ? {
          configured: false,
          adapter: "none",
          model: null,
          promptVersion: SUPPLIER_SEMANTIC_PROMPT_VERSION,
          results: [],
        }
      : null;
  }
  if (adapter === "none" || !model || rawResults.length !== groups.length) {
    return null;
  }

  const groupsByCanonicalKey = new Map(
    groups.map((group) => [group.ingredient.canonicalKey, group]),
  );
  const results = rawResults.map((result) =>
    validResult(result, groupsByCanonicalKey)
  );
  if (
    results.some((result) => !result)
    || new Set(results.map((result) => result?.canonicalKey)).size
      !== groups.length
  ) {
    return null;
  }
  return {
    configured: true,
    adapter,
    model,
    promptVersion: SUPPLIER_SEMANTIC_PROMPT_VERSION,
    results: results as SupplierSemanticRerankResult[],
  };
}

export async function fetchSupplierSemanticReranks(
  client: SupplierSemanticSessionClient,
  organizationId: string,
  campId: string,
  supplierAccountId: string,
  groups: readonly SupplierSemanticRerankGroup[],
  fetcher: FetchLike = globalThis.fetch,
): Promise<SupplierSemanticRerankResponse> {
  if (
    groups.length < 1
    || groups.length > SUPPLIER_SEMANTIC_MAX_GROUPS_PER_REQUEST
  ) {
    throw new Error("Den semantiska matchningsgruppen har ogiltig storlek.");
  }
  const { data, error } = await client.auth.getSession();
  if (error) {
    throw new Error("Den inloggade sessionen kunde inte läsas.");
  }
  const accessToken = data.session?.access_token;
  if (!accessToken || accessToken.length > 8_185 || /\s/.test(accessToken)) {
    throw new Error("Logga in igen för att förbättra matchningsförslagen.");
  }

  let response: Response;
  try {
    response = await fetcher(SUPPLIER_SEMANTIC_MATCH_ENDPOINT, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId,
        campId,
        supplierAccountId,
        promptVersion: SUPPLIER_SEMANTIC_PROMPT_VERSION,
        groups,
      }),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Den semantiska matchningen kunde inte nås just nu.");
  }

  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new Error(
      serverError(payload)
        ?? "Den semantiska matchningen kunde inte köras just nu.",
    );
  }
  const parsed = validResponse(payload, groups);
  if (!parsed) {
    throw new Error("Den semantiska matchningen svarade i ett oväntat format.");
  }
  return parsed;
}
