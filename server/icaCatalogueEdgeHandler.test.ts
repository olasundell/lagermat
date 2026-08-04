import { describe, expect, it, vi } from "vitest";
import { createIcaCatalogueHandler } from "../shared/icaCatalogueHandler.ts";
import { ICA_SICKLA_STORE_ID } from "../shared/icaCatalogueSource.ts";
import { isIcaCatalogueDemoEnabled } from "../supabase/functions/ica-catalogue/environment.ts";

const appOrigin = "https://lagermat-staging.netlify.app";
const functionUrl =
  "https://project.supabase.co/functions/v1/ica-catalogue";
const supabaseOrigin = "https://project.supabase.co";
const organizationId = "9b7c02ca-11dc-4a10-bdd8-ed1f14833709";
const userId = "e7f18be5-ad38-4a67-a935-f72003c42420";
const accessToken = "header.payload.signature";
const serviceKey = ["sb", "secret", "edge-test-only"].join("_");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function inputUrl(input: RequestInfo | URL): URL {
  return input instanceof Request ? new URL(input.url) : new URL(String(input));
}

function request(origin = appOrigin): Request {
  return new Request(functionUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Origin": origin,
      "Sec-Fetch-Site": "cross-site",
    },
    body: JSON.stringify({
      organizationId,
      storeId: ICA_SICKLA_STORE_ID,
      queries: ["Krossade tomater"],
    }),
  });
}

function edgeHandler(
  fetcher: typeof fetch,
  supabaseUrl = supabaseOrigin,
) {
  return createIcaCatalogueHandler({
    allowedOrigin: appOrigin,
    getEnvironment: () => ({
      supabaseUrl,
      supabasePublishableKey: "sb_publishable_edge-test-only",
      supabaseServiceRoleKey: serviceKey,
    }),
    fetch: fetcher,
    now: () => Date.parse("2026-08-04T12:00:00.000Z"),
  });
}

describe("ICA catalogue Supabase Edge handler contract", () => {
  it("fails closed unless the hosted environment explicitly enables demo mode", () => {
    const environment = (value: string | undefined) => ({
      get: (name: string) => name === "DEMO_MODE" ? value : undefined,
    });

    expect(isIcaCatalogueDemoEnabled(environment(undefined))).toBe(false);
    expect(isIcaCatalogueDemoEnabled(environment("TRUE"))).toBe(false);
    expect(isIcaCatalogueDemoEnabled(environment("false"))).toBe(false);
    expect(isIcaCatalogueDemoEnabled(environment("true"))).toBe(true);
  });

  it("answers exact-origin CORS preflights without touching secrets or upstreams", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await edgeHandler(fetcher)(new Request(functionUrl, {
      method: "OPTIONS",
      headers: {
        "Origin": appOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(appOrigin);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "POST, OPTIONS",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a different browser origin without CORS headers before authentication", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await edgeHandler(fetcher)(request("https://evil.example"));

    expect(response.status).toBe(403);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    await expect(response.json()).resolves.toEqual({
      error: "Anropet kommer från en otillåten webbplats.",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a different-origin preflight without allowing that origin", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await edgeHandler(fetcher)(new Request(functionUrl, {
      method: "OPTIONS",
      headers: {
        "Origin": "https://evil.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    }));

    expect(response.status).toBe(403);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts the local Edge Runtime's exact internal Kong origin", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = inputUrl(input);
      if (url.pathname === "/auth/v1/user") return json({ id: userId });
      if (url.pathname === "/rest/v1/organization_memberships") return json([]);
      throw new Error(`Unexpected request to ${url}`);
    });

    const response = await edgeHandler(fetcher, "http://kong:8000")(request());

    expect(response.status).toBe(403);
    expect(inputUrl(fetcher.mock.calls[0]![0]).origin).toBe("http://kong:8000");
  });

  it("authenticates membership, publishes with the service key and never returns it", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = inputUrl(input);
      if (url.pathname === "/auth/v1/user") {
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          `Bearer ${accessToken}`,
        );
        return json({ id: userId });
      }
      if (url.pathname === "/rest/v1/organization_memberships") {
        return json([{ organization_id: organizationId }]);
      }
      if (url.pathname === "/rest/v1/rpc/publish_ica_catalogue_rows_service") {
        const headers = new Headers(init?.headers);
        expect(headers.get("apikey")).toBe(serviceKey);
        expect(headers.get("Authorization")).toBeNull();
        expect(JSON.parse(String(init?.body))).toMatchObject({
          p_organization_id: organizationId,
          p_actor_user_id: userId,
          p_source: "ica_public_webshop",
          p_completed_queries: ["Krossade tomater"],
        });
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
              unitPrice: null,
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

    const response = await edgeHandler(fetcher)(request());
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(appOrigin);
    expect(responseText).not.toContain(serviceKey);
    expect(JSON.parse(responseText)).toMatchObject({
      source: {
        provider: "ica",
        channel: "public-webshop",
        complete: true,
      },
      products: [expect.objectContaining({ productId: "2141387" })],
    });
  });
});
