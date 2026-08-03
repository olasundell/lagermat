const ICA_CATALOGUE_ENDPOINT = "/api/ica-catalogue";
const RESPONSE_BODY_LIMIT = 4_000_000;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface IcaCatalogueSessionClient {
  auth: {
    getSession(): Promise<{
      data: {
        session: { access_token: string } | null;
      };
      error: { message: string } | null;
    }>;
  };
}

export interface IcaCatalogueResponse {
  source: {
    provider: "ica";
    channel: "public-webshop" | "local-fixture";
    synthetic?: true;
    complete: boolean;
    endpointVersion?: unknown;
    store: {
      id: string;
      name?: unknown;
    };
    searches: Array<{
      query: string;
      fetchedAt?: unknown;
      cache?: unknown;
    }>;
  };
  products: unknown[];
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
    throw new Error("ICA-katalogen gav ett för stort svar.");
  }

  const text = await response.text();
  if (text.length > RESPONSE_BODY_LIMIT) {
    throw new Error("ICA-katalogen gav ett för stort svar.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("ICA-katalogen svarade i ett oväntat format.");
  }
}

function errorMessage(payload: unknown): string | null {
  const error = record(payload)?.error;
  return typeof error === "string" && error.length <= 240 ? error : null;
}

function catalogueResponse(
  payload: unknown,
  expectedStoreId: string,
  expectedQueries: readonly string[],
): IcaCatalogueResponse | null {
  const body = record(payload);
  const source = record(body?.source);
  const store = record(source?.store);
  const expectedByKey = new Map(
    expectedQueries.map((query) => [
      query.trim().toLocaleLowerCase("sv-SE"),
      query.trim(),
    ]),
  );
  const rawSearches = source?.searches;
  if (
    !Array.isArray(rawSearches)
    || rawSearches.length > expectedByKey.size
  ) {
    return null;
  }
  const searches: IcaCatalogueResponse["source"]["searches"] = [];
  const seenSearches = new Set<string>();
  for (const rawSearch of rawSearches) {
    const search = record(rawSearch);
    const query = typeof search?.query === "string"
      ? search.query.trim()
      : "";
    const key = query.toLocaleLowerCase("sv-SE");
    const expectedQuery = expectedByKey.get(key);
    if (!expectedQuery || seenSearches.has(key)) return null;
    searches.push({
      query: expectedQuery,
      fetchedAt: search?.fetchedAt,
      cache: search?.cache,
    });
    seenSearches.add(key);
  }
  const publicWebshop = source?.channel === "public-webshop"
    && source.synthetic === undefined;
  const localFixture = source?.channel === "local-fixture"
    && source.synthetic === true;
  if (
    source?.provider !== "ica"
    || (!publicWebshop && !localFixture)
    || typeof source.complete !== "boolean"
    || store?.id !== expectedStoreId
    || !Array.isArray(body?.products)
    || (source.complete && searches.length !== expectedByKey.size)
  ) {
    return null;
  }
  return {
    source: {
      provider: "ica",
      channel: localFixture ? "local-fixture" : "public-webshop",
      ...(localFixture ? { synthetic: true as const } : {}),
      complete: source.complete,
      endpointVersion: source.endpointVersion,
      store: {
        id: expectedStoreId,
        name: store.name,
      },
      searches,
    },
    products: body.products,
  };
}

export async function fetchIcaCatalogueBatch(
  client: IcaCatalogueSessionClient,
  organizationId: string,
  storeId: string,
  queries: readonly string[],
  fetcher: FetchLike = globalThis.fetch,
): Promise<IcaCatalogueResponse> {
  const { data, error } = await client.auth.getSession();
  if (error) {
    throw new Error("Den inloggade sessionen kunde inte läsas.");
  }
  const accessToken = data.session?.access_token;
  if (
    !accessToken
    || accessToken.length > 8_185
    || /\s/.test(accessToken)
  ) {
    throw new Error("Logga in igen för att hämta ICA:s sortiment.");
  }

  let response: Response;
  try {
    response = await fetcher(ICA_CATALOGUE_ENDPOINT, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId,
        storeId,
        queries,
      }),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new Error("ICA-katalogen kunde inte nås just nu.");
  }

  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new Error(
      errorMessage(payload) ?? "ICA-katalogen kunde inte hämtas just nu.",
    );
  }
  const catalogue = catalogueResponse(payload, storeId, queries);
  if (!catalogue) {
    throw new Error("ICA-katalogen svarade i ett oväntat format.");
  }
  return catalogue;
}
