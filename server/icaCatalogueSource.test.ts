import { describe, expect, it } from "vitest";

import {
  buildIcaSearchUrl,
  ICA_SICKLA_STORE_ID,
  IcaPayloadError,
  MAX_QUERY_COUNT,
  parseCatalogueRequest,
  parseIcaSearchPayload,
} from "./icaCatalogueSource.ts";

const organizationId = "9b7c02ca-11dc-4a10-bdd8-ed1f14833709";

describe("parseCatalogueRequest", () => {
  it("accepts Sickla and normalises and deduplicates bounded searches", () => {
    expect(parseCatalogueRequest({
      organizationId,
      storeId: ICA_SICKLA_STORE_ID,
      queries: ["  Krossade   tomater ", "krossade tomater", "Gräddfil"],
    })).toEqual({
      organizationId,
      storeId: ICA_SICKLA_STORE_ID,
      queries: ["Krossade tomater", "Gräddfil"],
    });
  });

  it("rejects other stores and excessive search batches", () => {
    expect(() => parseCatalogueRequest({
      organizationId,
      storeId: "1004599",
      queries: ["mjölk"],
    })).toThrow("Only ICA Kvantum Sickla is supported");

    expect(() => parseCatalogueRequest({
      organizationId,
      storeId: ICA_SICKLA_STORE_ID,
      queries: Array.from({ length: MAX_QUERY_COUNT + 1 }, (_, index) =>
        `produkt ${index}`
      ),
    })).toThrow("queries must be a non-empty bounded array");
  });

  it("rejects malformed organisations and control characters", () => {
    expect(() => parseCatalogueRequest({
      organizationId: "not-a-uuid",
      storeId: ICA_SICKLA_STORE_ID,
      queries: ["mjölk"],
    })).toThrow("organizationId must be a UUID");

    expect(() => parseCatalogueRequest({
      organizationId,
      storeId: ICA_SICKLA_STORE_ID,
      queries: ["mjölk\u0000"],
    })).toThrow("invalid length or content");
  });
});

describe("buildIcaSearchUrl", () => {
  it("pins the public endpoint and all server-controlled bounds", () => {
    const url = buildIcaSearchUrl("krossade tomater");

    expect(url.origin).toBe("https://handlaprivatkund.ica.se");
    expect(url.pathname).toBe(
      "/stores/1004021/api/webproductpagews/v6/product-pages/search",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "krossade tomater",
      tag: "web",
      includeAdditionalPageInfo: "true",
      maxProductsToDecorate: "50",
      maxPageSize: "50",
    });
  });
});

describe("parseIcaSearchPayload", () => {
  it("returns compact public product fields and removes duplicate groups", () => {
    const rawProduct = {
      productId: "2001234",
      retailerProductId: "2001234",
      name: "Krossade tomater 390 g ICA",
      brand: "ICA",
      packSizeDescription: "390 g",
      type: "REGULAR",
      price: { amount: "13.95", currency: "SEK" },
      promoPrice: null,
      unitPrice: {
        unit: "kg",
        price: { amount: "35.77", currency: "SEK" },
        pricePerSuffix: "/kg",
      },
      available: true,
      catchweight: null,
      categoryPath: ["Skafferi", "Konserver"],
      countryOfOrigin: "Italien",
      image: { src: "https://example.invalid/not-returned.jpg" },
      promotions: [{ description: "not returned" }],
    };

    expect(parseIcaSearchPayload({
      productGroups: [
        { decoratedProducts: [rawProduct] },
        { decoratedProducts: [rawProduct] },
      ],
      metadata: { nextPageToken: null },
    })).toEqual([{
      productId: "2001234",
      retailerProductId: "2001234",
      name: "Krossade tomater 390 g ICA",
      brand: "ICA",
      packSizeDescription: "390 g",
      type: "REGULAR",
      price: { amount: "13.95", currency: "SEK" },
      promoPrice: null,
      unitPrice: {
        unit: "kg",
        price: { amount: "35.77", currency: "SEK" },
        pricePerSuffix: "/kg",
      },
      available: true,
      catchweight: null,
      categoryPath: ["Skafferi", "Konserver"],
      countryOfOrigin: "Italien",
    }]);
  });

  it("preserves catchweight metadata needed to block unsafe matching", () => {
    expect(parseIcaSearchPayload({
      productGroups: [{
        decoratedProducts: [{
          productId: "2009999",
          retailerProductId: "2009999",
          name: "Lösviktsvara",
          type: "CATCHWEIGHT",
          catchweight: {
            typicalQuantity: { value: "0.6", uom: "kg" },
          },
        }],
      }],
    })[0]?.catchweight).toEqual({
      typicalQuantity: { value: "0.6", uom: "kg" },
    });
  });

  it("rejects non-ICA-shaped payloads and unsafe product identifiers", () => {
    expect(() => parseIcaSearchPayload({ products: [] }))
      .toThrow(IcaPayloadError);
    expect(parseIcaSearchPayload({
      productGroups: [{
        decoratedProducts: [{
          productId: "../bad",
          retailerProductId: "123",
          name: "Bad",
        }],
      }],
    })).toEqual([]);
  });

  it("keeps valid ICA products when another product has malformed optional metadata", () => {
    expect(parseIcaSearchPayload({
      productGroups: [{
        decoratedProducts: [
          {
            productId: "bad-unit-price",
            retailerProductId: "bad-unit-price",
            name: "Gurka styck",
            unitPrice: {
              unit: "",
              price: { amount: "49.95", currency: "SEK" },
            },
          },
          {
            productId: "valid-cucumber",
            retailerProductId: "valid-cucumber",
            name: "Gurka 300g Klass 1",
            packSizeDescription: "300g",
          },
        ],
      }],
    })).toEqual([expect.objectContaining({
      productId: "valid-cucumber",
      retailerProductId: "valid-cucumber",
      name: "Gurka 300g Klass 1",
    })]);
  });
});
