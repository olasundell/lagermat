import { describe, expect, it, vi } from "vitest";
import {
  fetchIcaCatalogueBatch,
  type IcaCatalogueSessionClient,
} from "./icaCatalogueClient";

const organizationId = "9b7c02ca-11dc-4a10-bdd8-ed1f14833709";
const storeId = "1004021";

function publicPayload(query = "Krossade tomater"): unknown {
  return {
    source: {
      provider: "ica",
      channel: "public-webshop",
      complete: true,
      endpointVersion: "v7",
      store: { id: storeId, name: "ICA Kvantum Sickla" },
      searches: [{
        query,
        fetchedAt: "2026-08-04T18:36:03.000Z",
        cache: "miss",
      }],
    },
    products: [{ retailerProductId: "2141387" }],
  };
}

function client(
  accessToken: string | null = "header.payload.signature",
  invoke = vi.fn().mockResolvedValue({
    data: publicPayload(),
    error: null,
  }),
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
    functions: {
      invoke: invoke as IcaCatalogueSessionClient["functions"]["invoke"],
    },
  };
}

describe("fetchIcaCatalogueBatch", () => {
  it("uses the authenticated Supabase Edge Function in the public runtime", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: publicPayload(),
      error: null,
    });
    const fetcher = vi.fn();

    await expect(fetchIcaCatalogueBatch(
      client("header.payload.signature", invoke),
      organizationId,
      storeId,
      ["Krossade tomater"],
      "public",
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

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("ica-catalogue", {
      body: {
        organizationId,
        storeId,
        queries: ["Krossade tomater"],
      },
      headers: {
        Authorization: "Bearer header.payload.signature",
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves the same-origin endpoint for the explicit local fixture runtime", async () => {
    const invoke = vi.fn();
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
      client("header.payload.signature", invoke),
      organizationId,
      storeId,
      ["Mjölk"],
      "fixture",
      fetcher,
    )).resolves.toMatchObject({
      source: { channel: "local-fixture", synthetic: true },
      products: [{ retailerProductId: "local-mjolk-l" }],
    });

    expect(invoke).not.toHaveBeenCalled();
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
      queries: ["Mjölk"],
    });
  });

  it("requires an authenticated session before making either request", async () => {
    const invoke = vi.fn();
    const fetcher = vi.fn();

    await expect(fetchIcaCatalogueBatch(
      client(null, invoke),
      organizationId,
      storeId,
      ["Mjölk"],
      "public",
      fetcher,
    )).rejects.toThrow("Logga in igen");
    expect(invoke).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces a bounded Edge error without falling back to another source", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: {
        context: new Response(JSON.stringify({
          error: "ICA:s publika katalog kunde inte hämtas just nu.",
        }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
      },
    });
    const fetcher = vi.fn();

    await expect(fetchIcaCatalogueBatch(
      client("header.payload.signature", invoke),
      organizationId,
      storeId,
      ["Mjölk"],
      "public",
      fetcher,
    )).rejects.toThrow("ICA:s publika katalog");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not expose an oversized Edge error", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: {
        context: new Response(JSON.stringify({ error: "x".repeat(241) }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
      },
    });

    await expect(fetchIcaCatalogueBatch(
      client("header.payload.signature", invoke),
      organizationId,
      storeId,
      ["Mjölk"],
      "public",
    )).rejects.toThrow("ICA-katalogen kunde inte hämtas just nu.");
  });

  it("rejects an Edge response without verified ICA Sickla provenance", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        source: {
          provider: "generic",
          channel: "fixture",
          complete: true,
          store: { id: storeId },
        },
        products: [],
      },
      error: null,
    });

    await expect(fetchIcaCatalogueBatch(
      client("header.payload.signature", invoke),
      organizationId,
      storeId,
      ["Mjölk"],
      "public",
    )).rejects.toThrow("oväntat format");
  });

  it("rejects synthetic fixture provenance in the public runtime", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        source: {
          provider: "ica",
          channel: "local-fixture",
          synthetic: true,
          complete: true,
          store: { id: storeId },
          searches: [{ query: "Mjölk", cache: "fixture" }],
        },
        products: [{ retailerProductId: "local-mjolk-l" }],
      },
      error: null,
    });

    await expect(fetchIcaCatalogueBatch(
      client("header.payload.signature", invoke),
      organizationId,
      storeId,
      ["Mjölk"],
      "public",
    )).rejects.toThrow("oväntat format");
  });

  it("rejects catalogue progress for searches that were not requested", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        source: {
          provider: "ica",
          channel: "public-webshop",
          complete: false,
          store: { id: storeId },
          searches: [{
            query: "Gurka",
            fetchedAt: "2026-08-04T18:36:03.000Z",
            cache: "miss",
          }],
        },
        products: [],
      },
      error: null,
    });

    await expect(fetchIcaCatalogueBatch(
      client("header.payload.signature", invoke),
      organizationId,
      storeId,
      ["Mjölk"],
      "public",
    )).rejects.toThrow("oväntat format");
  });
});
