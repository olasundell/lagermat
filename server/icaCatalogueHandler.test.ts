import { describe, expect, it, vi } from "vitest";
import { createIcaCatalogueHandler } from "./icaCatalogueHandler.ts";
import { ICA_SICKLA_STORE_ID } from "./icaCatalogueSource.ts";

const appOrigin = "http://127.0.0.1:5179";
const supabaseOrigin = "http://127.0.0.1:54321";
const organizationId = "9b7c02ca-11dc-4a10-bdd8-ed1f14833709";
const userId = "e7f18be5-ad38-4a67-a935-f72003c42420";
const accessToken = "header.payload.signature";
const serviceRoleKey = "sb_secret_local-test";

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function request(
  body: unknown = {
    organizationId,
    storeId: ICA_SICKLA_STORE_ID,
    queries: ["Krossade tomater"],
  },
  headers: HeadersInit = {},
): Request {
  return new Request(`${appOrigin}/api/ica-catalogue`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Origin": appOrigin,
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function inputUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input));
}

function successfulFetch() {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    void _init;
    const url = inputUrl(input);
    if (url.origin === supabaseOrigin && url.pathname === "/auth/v1/user") {
      return json({ id: userId });
    }
    if (
      url.origin === supabaseOrigin
      && url.pathname === "/rest/v1/organization_memberships"
    ) {
      return json([{ organization_id: organizationId }]);
    }
    if (
      url.origin === supabaseOrigin
      && url.pathname === "/rest/v1/rpc/publish_ica_catalogue_rows_service"
    ) {
      return json({ status: "finalized", imported_rows: 1 });
    }
    if (url.origin === "https://handlaprivatkund.ica.se") {
      return json({
        productGroups: [{
          decoratedProducts: [{
            productId: "2141387",
            retailerProductId: "2141387",
            name: "Krossade tomater 3-p 1170g ICA",
            brand: "ICA",
            packSizeDescription: "1.17kg",
            type: "REGULAR",
            price: { amount: "28.55", currency: "SEK" },
            promoPrice: null,
            unitPrice: {
              unit: "kg",
              price: { amount: "24.40", currency: "SEK" },
              pricePerSuffix: "/kg",
            },
            available: true,
            catchweight: null,
            categoryPath: ["Skafferi", "Tomatkonserver"],
            countryOfOrigin: "Italien",
          }],
        }],
      });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
}

function handler(
  fetcher = successfulFetch(),
  options: {
    rateQueryUnits?: number;
    logger?: Pick<Console, "error">;
    localFixture?: boolean;
    supabaseUrl?: string;
  } = {},
) {
  return createIcaCatalogueHandler({
    getEnvironment: () => ({
      supabaseUrl: options.supabaseUrl ?? supabaseOrigin,
      supabasePublishableKey: "local-publishable-key",
      supabaseServiceRoleKey: serviceRoleKey,
      localIcaFixture: options.localFixture ? "true" : undefined,
    }),
    fetch: fetcher,
    now: () => Date.parse("2026-07-29T12:00:00.000Z"),
    ...options,
  });
}

describe("ICA catalogue Node handler", () => {
  it("uses a visibly synthetic Sickla fixture only when explicitly enabled locally", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = inputUrl(input);
      if (url.pathname === "/auth/v1/user") return json({ id: userId });
      if (url.pathname === "/rest/v1/organization_memberships") {
        return json([{ organization_id: organizationId }]);
      }
      if (url.pathname === "/rest/v1/rpc/publish_ica_catalogue_rows_service") {
        return json({ status: "finalized", imported_rows: 6 });
      }
      throw new Error(`Fixture mode must not call ICA: ${url} ${init?.method}`);
    });

    const response = await handler(fetcher, { localFixture: true })(request({
      organizationId,
      storeId: ICA_SICKLA_STORE_ID,
      queries: ["Mjölk", "Banan"],
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      source: {
        provider: "ica",
        channel: "local-fixture",
        synthetic: true,
        complete: true,
        store: { id: ICA_SICKLA_STORE_ID, name: "ICA Kvantum Sickla" },
        searches: [{ query: "Mjölk" }, { query: "Banan" }],
      },
      products: expect.arrayContaining([
        expect.objectContaining({
          name: "Mjölk 1 l ICA",
          packSizeDescription: "1 l",
        }),
        expect.objectContaining({
          name: "Banan 1 st ICA",
          packSizeDescription: "1 st",
        }),
      ]),
    });
    expect(fetcher.mock.calls.some(([input]) =>
      inputUrl(input).origin === "https://handlaprivatkund.ica.se"
    )).toBe(false);
  });

  it("keeps fixture article numbers bounded for the longest accepted query", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = inputUrl(input);
      if (url.pathname === "/auth/v1/user") return json({ id: userId });
      if (url.pathname === "/rest/v1/organization_memberships") {
        return json([{ organization_id: organizationId }]);
      }
      if (url.pathname === "/rest/v1/rpc/publish_ica_catalogue_rows_service") {
        return json({ status: "finalized", imported_rows: 3 });
      }
      throw new Error(`Fixture mode must not call ICA: ${url}`);
    });
    const longestAcceptedQuery = "a".repeat(80);

    const response = await handler(fetcher, { localFixture: true })(request({
      organizationId,
      storeId: ICA_SICKLA_STORE_ID,
      queries: [longestAcceptedQuery],
    }));
    const payload = await response.json() as {
      products: Array<{ retailerProductId: string; name: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.products).toHaveLength(3);
    expect(new Set(payload.products.map((product) => product.retailerProductId)).size)
      .toBe(3);
    expect(payload.products.every((product) => product.retailerProductId.length <= 120))
      .toBe(true);
    expect(payload.products.every((product) =>
      product.name.startsWith(`${longestAcceptedQuery} `)
      && product.name.endsWith(" ICA")
    ))
      .toBe(true);
  });

  it("keeps local fixture article identity stable across Swedish query casing", async () => {
    const fetcher = successfulFetch();
    const fixtureHandler = handler(fetcher, { localFixture: true });

    expect((await fixtureHandler(request({
      organizationId,
      storeId: ICA_SICKLA_STORE_ID,
      queries: ["Ris"],
    }))).status).toBe(200);
    expect((await fixtureHandler(request({
      organizationId,
      storeId: ICA_SICKLA_STORE_ID,
      queries: ["ris"],
    }))).status).toBe(200);

    const publishBodies = fetcher.mock.calls
      .filter(([input]) => inputUrl(input).pathname
        === "/rest/v1/rpc/publish_ica_catalogue_rows_service")
      .map(([, init]) => JSON.parse(String(init?.body)) as {
        p_rows: Array<{
          normalized_data: {
            supplier_article_number: string;
            package_unit: string;
            brand: string;
          };
        }>;
      });
    expect(publishBodies).toHaveLength(2);
    expect(publishBodies[0]!.p_rows).toHaveLength(6);
    expect(publishBodies[0]!.p_rows.filter((row) =>
      row.normalized_data.package_unit === "kg"
    ).map((row) => row.normalized_data.brand)).toEqual(["ICA", "ICA Basic"]);
    expect(publishBodies[0]!.p_rows.map((row) =>
      row.normalized_data.supplier_article_number
    )).toEqual(publishBodies[1]!.p_rows.map((row) =>
      row.normalized_data.supplier_article_number
    ));
  });

  it("keeps an explicit local no-result query unmatched", async () => {
    const fetcher = successfulFetch();
    const response = await handler(fetcher, { localFixture: true })(request({
      organizationId,
      storeId: ICA_SICKLA_STORE_ID,
      queries: ["Testvara utan träff"],
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      source: { channel: "local-fixture", complete: true },
      products: [],
    });
    const publishCall = fetcher.mock.calls.find(([input]) =>
      inputUrl(input).pathname
        === "/rest/v1/rpc/publish_ica_catalogue_rows_service"
    );
    expect(JSON.parse(String(publishCall?.[1]?.body))).toMatchObject({
      p_source: "ica_local_fixture",
      p_refresh_date: "2026-07-29",
      p_completed_queries: ["Testvara utan träff"],
      p_rows: [],
    });
  });

  it("keeps a fixture opt-in fail-closed when the server uses a hosted Supabase URL", async () => {
    const hostedSupabase = "https://project.supabase.co";
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = inputUrl(input);
      if (url.origin === hostedSupabase && url.pathname === "/auth/v1/user") {
        return json({ id: userId });
      }
      if (url.origin === hostedSupabase && url.pathname === "/rest/v1/organization_memberships") {
        return json([{ organization_id: organizationId }]);
      }
      if (
        url.origin === hostedSupabase
        && url.pathname === "/rest/v1/rpc/publish_ica_catalogue_rows_service"
      ) {
        return json({ status: "finalized", imported_rows: 0 });
      }
      return new Response("<html>challenge</html>", {
        status: 202,
        headers: { "x-amzn-waf-action": "challenge" },
      });
    });

    const response = await handler(fetcher, {
      localFixture: true,
      supabaseUrl: hostedSupabase,
      logger: { error: vi.fn() },
    })(request());
    const payload = await response.json();

    expect(payload).toMatchObject({
      source: { channel: "public-webshop", complete: false },
      products: [],
    });
    expect(payload.source.synthetic).toBeUndefined();
  });

  it("authenticates the member and returns only compact ICA Sickla products", async () => {
    const fetcher = successfulFetch();
    const response = await handler(fetcher)(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(payload).toMatchObject({
      source: {
        provider: "ica",
        channel: "public-webshop",
        endpointVersion: "v6",
        complete: true,
        store: {
          id: ICA_SICKLA_STORE_ID,
          name: "ICA Kvantum Sickla",
        },
      },
      products: [{
        productId: "2141387",
        retailerProductId: "2141387",
        name: "Krossade tomater 3-p 1170g ICA",
        price: { amount: "28.55", currency: "SEK" },
        scoutmatSearchMatches: [{
          query: "Krossade tomater",
          rank: 0,
        }],
      }],
    });

    const icaCall = fetcher.mock.calls.find(([input]) =>
      inputUrl(input).origin === "https://handlaprivatkund.ica.se"
    );
    expect(icaCall).toBeDefined();
    const icaUrl = inputUrl(icaCall![0]);
    const icaHeaders = new Headers(icaCall![1]?.headers);
    expect(icaUrl.pathname).toBe(
      "/stores/1004021/api/webproductpagews/v6/product-pages/search",
    );
    expect(icaUrl.searchParams.get("q")).toBe("Krossade tomater");
    expect(icaHeaders.get("ecom-request-source")).toBe("web");
    expect(icaHeaders.get("Referer")).toBe(
      "https://handlaprivatkund.ica.se/stores/1004021/",
    );
    expect(icaHeaders.get("Authorization")).toBeNull();
    expect(icaHeaders.get("Cookie")).toBeNull();

    const publishCall = fetcher.mock.calls.find(([input]) =>
      inputUrl(input).pathname
        === "/rest/v1/rpc/publish_ica_catalogue_rows_service"
    );
    expect(publishCall).toBeDefined();
    const publishHeaders = new Headers(publishCall![1]?.headers);
    const publishBody = JSON.parse(String(publishCall![1]?.body));
    expect(publishHeaders.get("apikey")).toBe(serviceRoleKey);
    expect(publishHeaders.get("Authorization")).toBeNull();
    expect(publishBody).toMatchObject({
      p_organization_id: organizationId,
      p_actor_user_id: userId,
      p_source: "ica_public_webshop",
      p_refresh_date: "2026-07-29",
      p_completed_queries: ["Krossade tomater"],
      p_rows: [expect.objectContaining({
        normalized_data: expect.objectContaining({
          supplier_article_number: "2141387",
          metadata: expect.objectContaining({
            source: "ica_public_webshop",
            store_id: ICA_SICKLA_STORE_ID,
          }),
        }),
      })],
    });
  });

  it("rejects missing sessions and cross-origin browser requests before ICA", async () => {
    const fetcher = successfulFetch();
    const withoutSession = request(undefined, { Authorization: "" });
    const otherOrigin = request(undefined, {
      Origin: "https://attacker.invalid",
      "Sec-Fetch-Site": "cross-site",
    });

    expect((await handler(fetcher)(withoutSession)).status).toBe(401);
    expect((await handler(fetcher)(otherOrigin)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires active membership before contacting ICA", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = inputUrl(input);
      if (url.pathname === "/auth/v1/user") return json({ id: userId });
      if (url.pathname === "/rest/v1/organization_memberships") return json([]);
      throw new Error(`Unexpected request to ${url}`);
    });

    const response = await handler(fetcher)(request());

    expect(response.status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects unsupported stores, malformed queries and oversized bodies", async () => {
    const fetcher = successfulFetch();
    const invalidStore = request({
      organizationId,
      storeId: "1004599",
      queries: ["Mjölk"],
    });
    const oversized = request(undefined, { "Content-Length": "5000" });

    expect((await handler(fetcher)(invalidStore)).status).toBe(400);
    expect((await handler(fetcher)(oversized)).status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reports ICA's WAF challenge as an incomplete genuine catalogue without solving it", async () => {
    const logger = { error: vi.fn() };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = inputUrl(input);
      if (url.pathname === "/auth/v1/user") return json({ id: userId });
      if (url.pathname === "/rest/v1/organization_memberships") {
        return json([{ organization_id: organizationId }]);
      }
      if (url.pathname === "/rest/v1/rpc/publish_ica_catalogue_rows_service") {
        return json({ status: "finalized", imported_rows: 0 });
      }
      return new Response("<html>challenge</html>", {
        status: 202,
        headers: { "x-amzn-waf-action": "challenge" },
      });
    });

    const response = await handler(fetcher, { logger })(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      source: {
        provider: "ica",
        channel: "public-webshop",
        complete: false,
        searches: [],
      },
      products: [],
    });
    expect(JSON.stringify(payload)).not.toContain("challenge");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("\"reason\":\"waf_challenge\""),
    );
  });

  it("keeps genuine products fetched before ICA temporarily limits the batch", async () => {
    const logger = { error: vi.fn() };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = inputUrl(input);
      if (url.pathname === "/auth/v1/user") return json({ id: userId });
      if (url.pathname === "/rest/v1/organization_memberships") {
        return json([{ organization_id: organizationId }]);
      }
      if (url.pathname === "/rest/v1/rpc/publish_ica_catalogue_rows_service") {
        return json({ status: "finalized", imported_rows: 1 });
      }
      if (url.searchParams.get("q") === "Krossade tomater") {
        return json({
          productGroups: [{
            decoratedProducts: [{
              productId: "2141387",
              retailerProductId: "2141387",
              name: "Krossade tomater 3-p 1170g ICA",
              brand: "ICA",
              packSizeDescription: "1.17kg",
              type: "REGULAR",
              price: { amount: "28.55", currency: "SEK" },
              promoPrice: null,
              unitPrice: null,
              available: true,
              catchweight: null,
              categoryPath: ["Skafferi", "Tomatkonserver"],
              countryOfOrigin: "Italien",
            }],
          }],
        });
      }
      return new Response("<html>challenge</html>", {
        status: 202,
        headers: { "x-amzn-waf-action": "challenge" },
      });
    });

    const response = await handler(fetcher, { logger })(request({
      organizationId,
      storeId: ICA_SICKLA_STORE_ID,
      queries: ["Krossade tomater", "Ris"],
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      source: {
        complete: false,
        searches: [{ query: "Krossade tomater" }],
      },
      products: [{
        retailerProductId: "2141387",
        name: "Krossade tomater 3-p 1170g ICA",
      }],
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("serialises outbound ICA searches to avoid bursting the public endpoint", async () => {
    let activeIcaRequests = 0;
    let maximumConcurrentIcaRequests = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = inputUrl(input);
      if (url.pathname === "/auth/v1/user") return json({ id: userId });
      if (url.pathname === "/rest/v1/organization_memberships") {
        return json([{ organization_id: organizationId }]);
      }
      if (url.pathname === "/rest/v1/rpc/publish_ica_catalogue_rows_service") {
        return json({ status: "finalized", imported_rows: 0 });
      }
      activeIcaRequests += 1;
      maximumConcurrentIcaRequests = Math.max(
        maximumConcurrentIcaRequests,
        activeIcaRequests,
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeIcaRequests -= 1;
      return json({ productGroups: [] });
    });

    const response = await handler(fetcher)(request({
      organizationId,
      storeId: ICA_SICKLA_STORE_ID,
      queries: ["Gul lök", "Gurka", "Morot"],
    }));

    expect(response.status).toBe(200);
    expect(maximumConcurrentIcaRequests).toBe(1);
  });

  it("returns an incomplete catalogue when ICA changes or withholds its payload", async () => {
    const logger = { error: vi.fn() };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = inputUrl(input);
      if (url.pathname === "/auth/v1/user") return json({ id: userId });
      if (url.pathname === "/rest/v1/organization_memberships") {
        return json([{ organization_id: organizationId }]);
      }
      if (url.pathname === "/rest/v1/rpc/publish_ica_catalogue_rows_service") {
        return json({ status: "finalized", imported_rows: 0 });
      }
      return json({ message: "temporarily unavailable" });
    });

    const response = await handler(fetcher, { logger })(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      source: {
        provider: "ica",
        channel: "public-webshop",
        complete: false,
        searches: [],
      },
      products: [],
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("\"reason\":\"unexpected_payload\""),
    );
  });

  it("rate-limits authenticated catalogue search units", async () => {
    const fetcher = successfulFetch();
    const limitedHandler = handler(fetcher, { rateQueryUnits: 1 });

    expect((await limitedHandler(request())).status).toBe(200);
    const response = await limitedHandler(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
  });

  it("does not spend public ICA query units in explicit local fixture mode", async () => {
    const fetcher = successfulFetch();
    const fixtureHandler = handler(fetcher, {
      localFixture: true,
      rateQueryUnits: 1,
    });

    expect((await fixtureHandler(request())).status).toBe(200);
    expect((await fixtureHandler(request())).status).toBe(200);
    expect(fetcher.mock.calls.some(([input]) =>
      inputUrl(input).origin === "https://handlaprivatkund.ica.se"
    )).toBe(false);
  });

  it("fails closed when server-owned catalogue publication fails", async () => {
    const logger = { error: vi.fn() };
    const fetcher = successfulFetch();
    fetcher.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = inputUrl(input);
      if (url.pathname === "/auth/v1/user") return json({ id: userId });
      throw new Error(`Unexpected first request to ${url}`);
    });
    fetcher.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = inputUrl(input);
      if (url.pathname === "/rest/v1/organization_memberships") {
        return json([{ organization_id: organizationId }]);
      }
      throw new Error(`Unexpected second request to ${url}`);
    });
    fetcher.mockImplementationOnce(async () => json({
      productGroups: [{
        decoratedProducts: [{
          productId: "2141387",
          retailerProductId: "2141387",
          name: "Krossade tomater 3-p 1170g ICA",
          brand: "ICA",
          packSizeDescription: "1.17kg",
          type: "REGULAR",
          price: { amount: "28.55", currency: "SEK" },
          promoPrice: null,
          unitPrice: null,
          available: true,
          catchweight: null,
          categoryPath: [],
          countryOfOrigin: null,
        }],
      }],
    }));
    fetcher.mockImplementationOnce(async () => json({ error: "denied" }, 403));

    const response = await handler(fetcher, { logger })(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "ICA-sortimentet kunde inte sparas just nu.",
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('"stage":"publish_ica_catalogue"'),
    );
  });

  it("refuses elevated Supabase keys in the server configuration", async () => {
    const configuredWithSecret = createIcaCatalogueHandler({
      getEnvironment: () => ({
        supabaseUrl: "https://example.supabase.co",
        supabasePublishableKey: "sb_secret_not-allowed",
        supabaseServiceRoleKey: serviceRoleKey,
      }),
      fetch: successfulFetch(),
    });

    expect((await configuredWithSecret(request())).status).toBe(500);
  });
});
