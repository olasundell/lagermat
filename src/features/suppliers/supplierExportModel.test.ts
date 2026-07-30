import { describe, expect, it } from "vitest";
import type { SupplyItemRow } from "../supplies/supplyModel";
import { createSupplierOrderCsv, createSupplierOrderUnderlay } from "./supplierExportModel";
import type { SupplierAccount, SupplierMatchDetail } from "./supplierModel";

const supplier: SupplierAccount = {
  id: "supplier-1",
  account_key: "00000000-0000-4000-8000-000000000001",
  organization_id: "organization-1",
  provider_key: "menigo",
  provider_location_id: null,
  display_name: "Menigo",
  customer_number: "KUND-42",
  active: true,
  created_by: "user-1",
  created_at: "2026-07-29T09:00:00Z",
  updated_at: "2026-07-29T09:00:00Z",
};

function item(overrides: Partial<SupplyItemRow> = {}): SupplyItemRow {
  return {
    id: "item-1",
    item_key: "purchase:ris",
    canonical_key: "ingredient:ris",
    category: "Torrvaror",
    item_name: "Ris",
    required_amount: 5.5,
    required_unit: "kg",
    ordered_amount: 6,
    ordered_unit: "kg",
    package_note: "2 kolli",
    comment: "Kontrollera pris",
    completed: false,
    row_version: 1,
    source_present: true,
    manually_moved: false,
    ...overrides,
  };
}

function detail(overrides: Partial<SupplierMatchDetail["match"]> = {}): SupplierMatchDetail {
  return {
    account: supplier,
    product: {
      id: "product-1",
      organization_id: "organization-1",
      supplier_account_id: supplier.id,
      supplier_article_number: "R-3000",
      display_name: "Ris 3 kg",
      gtin: "07300000000000",
      purchase_unit: "kolli",
      package_amount: 3,
      package_unit: "kg",
      minimum_order_units: 1,
      brand: null,
      catch_weight: false,
      category: null,
      latest_import_run_id: null,
      normalized_search_name: "ris",
      packaging_metadata: {},
      product_fingerprint: "a".repeat(64),
      source_metadata: {},
      active: true,
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
      availability_status: "available",
      valid_from: "2026-07-29",
      valid_to: "2026-08-05",
      fetched_at: "2026-07-29T09:00:00Z",
      created_at: "2026-07-29T09:00:00Z",
      updated_at: "2026-07-29T09:00:00Z",
    },
    match: {
      id: "match-1",
      organization_id: "organization-1",
      canonical_key: "ingredient:ris",
      supplier_product_id: "product-1",
      supplier_account_id: supplier.id,
      approved_product_fingerprint: "a".repeat(64),
      required_unit: "kg",
      amount_per_purchase_unit: 3,
      approved_by: "user-1",
      approved_at: "2026-07-29T09:00:00Z",
      created_at: "2026-07-29T09:00:00Z",
      updated_at: "2026-07-29T09:00:00Z",
      ...overrides,
    },
  };
}

describe("supplier order underlay", () => {
  it("exporterar artikel, GTIN, kundpris och transparent kolliförslag utan att kalla det en order", () => {
    const underlay = createSupplierOrderUnderlay({
      organizationName: "Björkstad scoutkår",
      campName: "Sommarläger 2026",
      supplier,
      items: [item()],
      details: [detail()],
      readiness: { canFinalize: true, problems: [] },
      generatedAt: new Date("2026-07-29T10:00:00Z"),
    });

    const csv = createSupplierOrderCsv(underlay);
    expect(csv).toContain('"UNDERLAG – INGEN ORDER HAR SKICKATS"');
    expect(csv).toContain('"5.5";"kg";"MATCHAD";"R-3000";"07300000000000"');
    expect(csv).toContain('"2";"6";"0.5";"3";"kg";"199.5";"SEK"');
    expect(csv).not.toContain("specialkost");
    expect(underlay.lines[0]?.item.required_amount).toBe(5.5);
  });

  it("behåller omatchade råvaror synliga i stället för att tappa dem ur underlaget", () => {
    const underlay = createSupplierOrderUnderlay({
      organizationName: "Björkstad scoutkår",
      campName: "Sommarläger 2026",
      supplier,
      items: [item(), item({ id: "item-2", canonical_key: "ingredient:lök", item_name: "Gul lök" })],
      details: [detail()],
      readiness: { canFinalize: true, problems: [] },
    });

    const csv = createSupplierOrderCsv(underlay);
    expect(underlay.lines).toHaveLength(2);
    expect(underlay.draft).toBe(true);
    expect(csv).toContain('"SAKNAR MATCHNING"');
    expect(csv).toContain('"UNDERLAG MED VARNINGAR"');
    expect(csv).toContain('"1 råvara saknar artikelmatchning"');
  });

  it("väljer den senast godkända matchningen för samma leverantör och råvara", () => {
    const older = detail();
    const newer = detail({
      id: "match-2",
      supplier_product_id: "product-2",
      amount_per_purchase_unit: 2,
      approved_at: "2026-07-30T09:00:00Z",
    });
    newer.product = {
      ...newer.product,
      id: "product-2",
      supplier_article_number: "R-2000",
      package_amount: 2,
    };

    const underlay = createSupplierOrderUnderlay({
      organizationName: "Björkstad scoutkår",
      campName: "Sommarläger 2026",
      supplier,
      items: [item()],
      details: [older, newer],
      readiness: { canFinalize: true, problems: [] },
    });

    expect(underlay.lines[0]?.detail?.product.supplier_article_number).toBe("R-2000");
    expect(underlay.lines[0]?.proposal).toMatchObject({ status: "ready", purchaseUnits: 3 });
  });

  it("neutraliserar formelliknande extern data i CSV-celler", () => {
    const underlay = createSupplierOrderUnderlay({
      organizationName: "Björkstad scoutkår",
      campName: "Sommarläger 2026",
      supplier,
      items: [item({ item_name: "=HYPERLINK(\"https://example.invalid\")" })],
      details: [],
      readiness: { canFinalize: true, problems: [] },
    });

    expect(createSupplierOrderCsv(underlay)).toContain(
      `"'=HYPERLINK(""https://example.invalid"")"`,
    );
  });
});
