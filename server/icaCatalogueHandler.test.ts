import { describe, expect, it, vi } from "vitest";
import { createIcaCatalogueHandler } from "./icaCatalogueHandler.ts";
import { ICA_SICKLA_STORE_ID } from "./icaCatalogueSource.ts";

const appOrigin = "http://127.0.0.1:5179";
const supabaseOrigin = "http://127.0.0.1:54321";
const organizationId = "9b7c02ca-11dc-4a10-bdd8-ed1f14833709";
const userId = "e7f18be5-ad38-4a67-a935-f72003c42420";
const accessToken = "header.payload.signature";

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
  options: { rateQueryUnits?: number; logger?: Pick<Console, "error"> } = {},
) {
  return createIcaCatalogueHandler({
    getEnvironment: () => ({
      supabaseUrl: supabaseOrigin,
      supabasePublishableKey: "local-publishable-key",
    }),
    fetch: fetcher,
    now: () => Date.parse("2026-07-29T12:00:00.000Z"),
    ...options,
  });
}

describe("ICA catalogue Node handler", () => {
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

  it("refuses elevated Supabase keys in the server configuration", async () => {
    const configuredWithSecret = createIcaCatalogueHandler({
      getEnvironment: () => ({
        supabaseUrl: "https://example.supabase.co",
        supabasePublishableKey: "sb_secret_not-allowed",
      }),
      fetch: successfulFetch(),
    });

    expect((await configuredWithSecret(request())).status).toBe(500);
  });
});
