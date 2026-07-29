import { describe, expect, it } from "vitest";
import {
  proposeSupplierOrder,
  type SupplierMatchDetail,
} from "./supplierModel";

function supplierMatchDetail(
  overrides: {
    amount_per_purchase_unit?: number;
    minimum_order_units?: number;
    purchase_unit?: string;
    required_unit?: string;
    account_active?: boolean;
    product_active?: boolean;
    availability_status?: string;
  } = {},
): SupplierMatchDetail {
  return {
    account: {
      id: "account-1",
      account_key: "00000000-0000-4000-8000-000000000001",
      organization_id: "organization-1",
      provider_key: "menigo",
      display_name: "Menigo",
      customer_number: "12345",
      active: overrides.account_active ?? true,
      created_by: "user-1",
      created_at: "2026-07-29T09:00:00Z",
      updated_at: "2026-07-29T09:00:00Z",
    },
    product: {
      id: "product-1",
      organization_id: "organization-1",
      supplier_account_id: "account-1",
      supplier_article_number: "ABC-123",
      display_name: "Ris 3 kg",
      gtin: "07300000000000",
      purchase_unit: overrides.purchase_unit ?? "kolli",
      package_amount: 3,
      package_unit: "kg",
      minimum_order_units: overrides.minimum_order_units ?? 1,
      brand: null,
      catch_weight: false,
      category: null,
      latest_import_run_id: null,
      normalized_search_name: "ris",
      packaging_metadata: {},
      product_fingerprint: "a".repeat(64),
      source_metadata: {},
      active: overrides.product_active ?? true,
      product_data_source: "manual",
      source_updated_at: "2026-07-29T09:00:00Z",
      created_by: "user-1",
      created_at: "2026-07-29T09:00:00Z",
      updated_at: "2026-07-29T09:00:00Z",
    },
    offer: {
      id: "offer-1",
      organization_id: "organization-1",
      supplier_product_id: "product-1",
      price: 199.5,
      currency: "SEK",
      availability_status: overrides.availability_status ?? "available",
      valid_from: "2026-07-29",
      valid_to: null,
      fetched_at: "2026-07-29T09:00:00Z",
      created_at: "2026-07-29T09:00:00Z",
      updated_at: "2026-07-29T09:00:00Z",
    },
    match: {
      id: "match-1",
      organization_id: "organization-1",
      canonical_key: "ingredient:ris:kg",
      supplier_product_id: "product-1",
      supplier_account_id: "account-1",
      approved_product_fingerprint: "a".repeat(64),
      required_unit: overrides.required_unit ?? "kg",
      amount_per_purchase_unit: overrides.amount_per_purchase_unit ?? 3,
      approved_by: "user-1",
      approved_at: "2026-07-29T09:00:00Z",
      created_at: "2026-07-29T09:00:00Z",
      updated_at: "2026-07-29T09:00:00Z",
    },
  };
}

describe("proposeSupplierOrder", () => {
  it("håller behovet separat och föreslår hela inköpsenheter med synligt överskott", () => {
    const proposal = proposeSupplierOrder(5.5, "kg", supplierMatchDetail());

    expect(proposal).toEqual({
      status: "ready",
      reason: null,
      purchaseUnits: 2,
      orderedAmount: 6,
      surplusAmount: 0.5,
      packageNote: "2 kolli à 3 kg = 6 kg (behov 5.5 kg, överskott 0.5 kg)",
    });
  });

  it("respekterar en positiv heltals-minimiorder", () => {
    const proposal = proposeSupplierOrder(
      5.5,
      "kg",
      supplierMatchDetail({ minimum_order_units: 3 }),
    );

    expect(proposal.status).toBe("ready");
    expect(proposal.purchaseUnits).toBe(3);
    expect(proposal.orderedAmount).toBe(9);
    expect(proposal.surplusAmount).toBe(3.5);
  });

  it("normaliserar skiftläge och blanksteg men vägrar en faktisk enhetskonflikt", () => {
    expect(proposeSupplierOrder(5.5, "  KG ", supplierMatchDetail({
      required_unit: " kg ",
    })).status).toBe("ready");

    expect(proposeSupplierOrder(5.5, "g", supplierMatchDetail())).toEqual({
      status: "unit_mismatch",
      reason: "unit_mismatch",
      purchaseUnits: null,
      orderedAmount: null,
      surplusAmount: null,
      packageNote: null,
    });
  });

  it.each([
    {
      name: "negativt behov",
      amount: -0.1,
      detail: supplierMatchDetail(),
      reason: "invalid_required_amount",
    },
    {
      name: "noll per inköpsenhet",
      amount: 1,
      detail: supplierMatchDetail({ amount_per_purchase_unit: 0 }),
      reason: "invalid_amount_per_purchase_unit",
    },
    {
      name: "negativ mängd per inköpsenhet",
      amount: 1,
      detail: supplierMatchDetail({ amount_per_purchase_unit: -2 }),
      reason: "invalid_amount_per_purchase_unit",
    },
    {
      name: "minimiorder som inte är ett heltal",
      amount: 1,
      detail: supplierMatchDetail({ minimum_order_units: 1.5 }),
      reason: "invalid_minimum_order_units",
    },
    {
      name: "minimiorder som inte är positiv",
      amount: 1,
      detail: supplierMatchDetail({ minimum_order_units: 0 }),
      reason: "invalid_minimum_order_units",
    },
    {
      name: "tom inköpsenhet",
      amount: 1,
      detail: supplierMatchDetail({ purchase_unit: " " }),
      reason: "invalid_purchase_unit",
    },
  ])("felmarkerar $name utan att föreslå en beställning", ({ amount, detail, reason }) => {
    expect(proposeSupplierOrder(amount, "kg", detail)).toMatchObject({
      status: "invalid_mapping",
      reason,
      purchaseUnits: null,
      orderedAmount: null,
      surplusAmount: null,
      packageNote: null,
    });
  });

  it("räknar decimaler utan binära avrundningsrester", () => {
    const proposal = proposeSupplierOrder(
      "0.3",
      "l",
      supplierMatchDetail({
        amount_per_purchase_unit: 0.1,
        required_unit: "l",
      }),
    );

    expect(proposal.status).toBe("ready");
    expect(proposal.purchaseUnits).toBe(3);
    expect(proposal.orderedAmount).toBe(0.3);
    expect(proposal.surplusAmount).toBe(0);
    expect(proposal.packageNote).toContain("överskott 0 l");
  });

  it.each([
    ["slut i lager", { availability_status: "out_of_stock" }, "supplier_product_out_of_stock"],
    ["utgången", { availability_status: "discontinued" }, "supplier_product_discontinued"],
    ["inaktiv leverantör", { account_active: false }, "inactive_supplier_account"],
    ["inaktiv artikel", { product_active: false }, "inactive_supplier_product"],
  ] as const)("blockerar en artikel som är %s", (_label, overrides, reason) => {
    expect(proposeSupplierOrder(5.5, "kg", supplierMatchDetail(overrides))).toMatchObject({
      status: "invalid_mapping",
      reason,
      purchaseUnits: null,
      orderedAmount: null,
    });
  });

  it("muterar inte leverantörsmatchningen", () => {
    const detail = supplierMatchDetail();
    const original = structuredClone(detail);

    proposeSupplierOrder(5.5, "kg", detail);

    expect(detail).toEqual(original);
  });
});
