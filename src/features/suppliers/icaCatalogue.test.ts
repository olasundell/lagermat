import { describe, expect, it } from "vitest";
import {
  normaliseIcaCatalogueResponse,
  parseIcaPackSizeDescription,
} from "./icaCatalogue";
import {
  proposeSupplierCandidateOrder,
  type SupplierProduct,
} from "./supplierModel";

function product(overrides: Record<string, unknown> = {}) {
  return {
    retailerProductId: "2012345670001",
    productId: "ica-product-1",
    name: "Krossade tomater 3-p 1170g ICA",
    brand: "ICA",
    packSizeDescription: "1170g",
    price: { amount: "35.90", currency: "SEK" },
    unitPrice: { amount: "30.68", currency: "SEK", unit: "kg" },
    available: true,
    categoryPath: ["Skafferi", "Konserver", "Krossade tomater"],
    image: { src: "https://assets.icanet.se/product.png" },
    ...overrides,
  };
}

function response(...products: Array<Record<string, unknown>>) {
  return {
    productGroups: [{
      decoratedProducts: products,
    }],
  };
}

describe("ICA:s publika katalogformat", () => {
  it.each([
    ["1170g", { amount: 1.17, unit: "kg", dimension: "mass" }],
    ["0,39 kg", { amount: 0.39, unit: "kg", dimension: "mass" }],
    ["500ml", { amount: 0.5, unit: "l", dimension: "volume" }],
    ["33 cl", { amount: 0.33, unit: "l", dimension: "volume" }],
    ["6x33 cl", {
      amount: 1.98,
      unit: "l",
      dimension: "volume",
      innerCount: 6,
    }],
    ["2 × 500g", {
      amount: 1,
      unit: "kg",
      dimension: "mass",
      innerCount: 2,
    }],
    ["6 per frp", { amount: 6, unit: "st", dimension: "count" }],
    ["20st", { amount: 20, unit: "st", dimension: "count" }],
  ])("normaliserar en exakt förpackningsmängd %s", (source, expected) => {
    expect(parseIcaPackSizeDescription(source)).toEqual(expected);
  });

  it.each([
    "",
    "ca 1kg",
    "1 st (500g)",
    "0kg",
    "-1kg",
    "1.2345678kg",
    "6,5st",
  ])("vägrar en ofullständig eller osäker förpackning %j", (source) => {
    expect(parseIcaPackSizeDescription(source)).toBeNull();
  });

  it("skapar en stagingrad med ICA-artikel, pris och tre verifierade innerenheter", () => {
    const result = normaliseIcaCatalogueResponse(response(product()), {
      storeId: "1004021",
      query: "krossade tomater",
      completedQueries: ["Krossade tomater", "Tomatpuré"],
    });

    expect(result).toMatchObject({
      duplicateCount: 0,
      rejectedProducts: [],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      source_row: 1,
      raw_data: expect.objectContaining({
        store_id: "1004021",
        retailer_product_id: "2012345670001",
        product_id: "ica-product-1",
        pack_size_description: "1170g",
      }),
      normalized_data: {
        supplier_article_number: "2012345670001",
        display_name: "Krossade tomater 3-p 1170g ICA",
        purchase_unit: "förpackning",
        package_amount: 1.17,
        package_unit: "kg",
        minimum_order_units: 1,
        price: 35.9,
        currency: "SEK",
        availability_status: "unknown",
        category: "Skafferi > Konserver > Krossade tomater",
        brand: "ICA",
        catch_weight: false,
        packaging_metadata: {
          normalization_version: "ica-public-catalogue-v1",
          source_pack_size_description: "1170g",
          package_dimension: "mass",
          inner_unit_count: 3,
          inner_unit_label: "stycken",
        },
        metadata: {
          source: "ica_public_webshop",
          store_id: "1004021",
          query: "krossade tomater",
          ica_completed_searches: ["Krossade tomater", "Tomatpuré"],
          ica_retailer_product_id: "2012345670001",
          ica_product_id: "ica-product-1",
          ica_unit_price: {
            amount: "30.68",
            currency: "SEK",
            unit: "kg",
          },
          ica_available: true,
          ica_category_path: [
            "Skafferi",
            "Konserver",
            "Krossade tomater",
          ],
          ica_image_url: "https://assets.icanet.se/product.png",
        },
      },
    });
  });

  it("ger två ICA-förpackningar och sex innerenheter för ett behov på 1,7373 kg", () => {
    const result = normaliseIcaCatalogueResponse(response(product()), {
      storeId: "1004021",
    });
    const normalized = result.rows[0]!.normalized_data;
    const proposal = proposeSupplierCandidateOrder(1.7373, "kg", {
      amountPerPurchaseUnit: normalized.package_amount as number,
      requiredUnit: normalized.package_unit as string,
      product: {
        active: true,
        minimum_order_units: normalized.minimum_order_units as number,
        packaging_metadata:
          normalized.packaging_metadata as SupplierProduct["packaging_metadata"],
        purchase_unit: normalized.purchase_unit as string,
      },
    });

    expect(proposal).toMatchObject({
      status: "ready",
      purchaseUnits: 2,
      orderedAmount: 2.34,
    });
    expect(proposal.packageNote).toContain(
      "6 stycken (2 förpackningar à 3 × 390 g)",
    );
  });

  it("använder neutrala stycken för ett explicit antal utan säker behållare", () => {
    const result = normaliseIcaCatalogueResponse(response(product({
      retailerProductId: "egg-6",
      name: "Ägg frigående 6st ICA",
      packSizeDescription: "6 per frp",
      categoryPath: ["Mejeri & Ost", "Ägg"],
    })), { storeId: "1004021" });

    expect(result.rows[0]?.normalized_data).toMatchObject({
      package_amount: 6,
      package_unit: "st",
      packaging_metadata: {
        inner_unit_count: 6,
        inner_unit_label: "stycken",
      },
    });
  });

  it("bevarar available som rådata utan att kalla det verifierat lager", () => {
    const result = normaliseIcaCatalogueResponse(response(product({
      available: false,
    })), { storeId: "1004021" });

    expect(result.rows[0]?.normalized_data).toMatchObject({
      availability_status: "unknown",
      metadata: {
        ica_available: false,
      },
    });
  });

  it("märker ICA:s viktvaror så att säker matchning blockeras", () => {
    const result = normaliseIcaCatalogueResponse(response(product({
      retailerProductId: "catchweight-1",
      type: "CATCHWEIGHT",
      catchweight: {
        typicalQuantity: { value: "0.6", uom: "kg" },
      },
    })), { storeId: "1004021" });

    expect(result.rows[0]?.normalized_data).toMatchObject({
      catch_weight: true,
      metadata: {
        ica_product_type: "CATCHWEIGHT",
        ica_catchweight: {
          typicalQuantity: { value: "0.6", uom: "kg" },
        },
      },
    });
  });

  it("deduplicerar samma ICA-artikel i featured och vanliga träffar", () => {
    const duplicate = product();
    const result = normaliseIcaCatalogueResponse({
      productGroups: [
        { decoratedProducts: [duplicate] },
        { decoratedProducts: [{ ...duplicate }] },
      ],
    }, { storeId: "1004021" });

    expect(result.rows).toHaveLength(1);
    expect(result.rejectedProducts).toEqual([]);
    expect(result.duplicateCount).toBe(1);
  });

  it("låter ett kampanjpris variera utan att förlora samma fasta artikel", () => {
    const result = normaliseIcaCatalogueResponse(response(
      product({ price: { amount: "28.55", currency: "SEK" } }),
      product({ price: { amount: "24.90", currency: "SEK" } }),
    ), { storeId: "1004021" });

    expect(result.rows).toHaveLength(1);
    expect(result.rejectedProducts).toEqual([]);
    expect(result.duplicateCount).toBe(1);
  });

  it("vägrar motstridiga dubbletter av samma ICA-artikel", () => {
    const result = normaliseIcaCatalogueResponse(response(
      product(),
      product({ packSizeDescription: "2kg" }),
    ), { storeId: "1004021" });

    expect(result.rows).toEqual([]);
    expect(result.duplicateCount).toBe(1);
    expect(result.rejectedProducts).toEqual([
      expect.objectContaining({
        retailerProductId: "2012345670001",
        reason: "conflicting_duplicate",
      }),
    ]);
  });

  it("vägrar saknad, ungefärlig och motstridig förpackningsinformation", () => {
    const result = normaliseIcaCatalogueResponse(response(
      product({
        retailerProductId: "missing",
        packSizeDescription: null,
      }),
      product({
        retailerProductId: "approximate",
        packSizeDescription: "ca 1kg",
      }),
      product({
        retailerProductId: "conflict",
        name: "Tomatburkar 3-p 6-pack",
        packSizeDescription: "1kg",
      }),
    ), { storeId: "1004021" });

    expect(result.rows).toEqual([]);
    expect(result.rejectedProducts.map(({ retailerProductId, reason }) => ({
      retailerProductId,
      reason,
    }))).toEqual([
      { retailerProductId: "approximate", reason: "invalid_pack_size" },
      { retailerProductId: "conflict", reason: "conflicting_inner_count" },
      { retailerProductId: "missing", reason: "missing_pack_size" },
    ]);
  });

  it("kräver rätt svarform och butikens id", () => {
    expect(() =>
      normaliseIcaCatalogueResponse({}, { storeId: "1004021" })
    ).toThrow("ICA-svaret saknar productGroups.");
    expect(() =>
      normaliseIcaCatalogueResponse(response(product()), { storeId: " " })
    ).toThrow("ICA-butikens id saknas.");
  });
});
