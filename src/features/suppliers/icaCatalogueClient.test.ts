import { describe, expect, it, vi } from "vitest";
import {
  fetchIcaCatalogueBatch,
  type IcaCatalogueSessionClient,
} from "./icaCatalogueClient";

const organizationId = "9b7c02ca-11dc-4a10-bdd8-ed1f14833709";
const storeId = "1004021";

function client(
  accessToken: string | null = "header.payload.signature",
): IcaCatalogueSessionClient {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: accessToken ? { access_token: accessToken } : null,
        },
        error: null,
      }),
    },
  };
}

describe("fetchIcaCatalogueBatch", () => {
  it("uses the same-origin Node endpoint with the current user session", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      source: {
        provider: "ica",
        channel: "public-webshop",
        complete: true,
        endpointVersion: "v6",
        store: { id: storeId, name: "ICA Kvantum Sickla" },
        searches: [{
          query: "Krossade tomater",
          fetchedAt: "2026-07-29T18:36:03.000Z",
          cache: "miss",
        }],
      },
      products: [{ retailerProductId: "2141387" }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(fetchIcaCatalogueBatch(
      client(),
      organizationId,
      storeId,
      ["Krossade tomater"],
      fetcher,
    )).resolves.toMatchObject({
      source: {
        provider: "ica",
        channel: "public-webshop",
        complete: true,
        store: { id: storeId },
        searches: [{ query: "Krossade tomater" }],
      },
      products: [{ retailerProductId: "2141387" }],
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/ica-catalogue");
    expect(init).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Authorization: "Bearer header.payload.signature",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      organizationId,
      storeId,
      queries: ["Krossade tomater"],
    });
  });

  it("requires an authenticated session before making a request", async () => {
    const fetcher = vi.fn();

    await expect(fetchIcaCatalogueBatch(
      client(null),
      organizationId,
      storeId,
      ["Mjölk"],
      fetcher,
    )).rejects.toThrow("Logga in igen");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces the bounded server error without falling back to another source", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "ICA:s publika katalog kunde inte hämtas just nu.",
    }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(fetchIcaCatalogueBatch(
      client(),
      organizationId,
      storeId,
      ["Mjölk"],
      fetcher,
    )).rejects.toThrow("ICA:s publika katalog");
  });

  it("rejects a response without verified ICA Sickla provenance", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      source: {
        provider: "generic",
        channel: "fixture",
        complete: true,
        store: { id: storeId },
      },
      products: [],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(fetchIcaCatalogueBatch(
      client(),
      organizationId,
      storeId,
      ["Mjölk"],
      fetcher,
    )).rejects.toThrow("oväntat format");
  });

  it("accepts an explicitly marked local Sickla fixture without accepting generic fixtures", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      source: {
        provider: "ica",
        channel: "local-fixture",
        synthetic: true,
        complete: true,
        store: { id: storeId, name: "ICA Kvantum Sickla" },
        searches: [{ query: "Mjölk", cache: "fixture" }],
      },
      products: [{ retailerProductId: "local-mjolk-l" }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(fetchIcaCatalogueBatch(
      client(), organizationId, storeId, ["Mjölk"], fetcher,
    )).resolves.toMatchObject({
      source: { channel: "local-fixture", synthetic: true },
      products: [{ retailerProductId: "local-mjolk-l" }],
    });
  });

  it("rejects catalogue progress for searches that were not requested", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      source: {
        provider: "ica",
        channel: "public-webshop",
        complete: false,
        store: { id: storeId },
        searches: [{
          query: "Gurka",
          fetchedAt: "2026-07-29T18:36:03.000Z",
          cache: "miss",
        }],
      },
      products: [],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(fetchIcaCatalogueBatch(
      client(),
      organizationId,
      storeId,
      ["Mjölk"],
      fetcher,
    )).rejects.toThrow("oväntat format");
  });
});
