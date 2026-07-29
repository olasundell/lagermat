import { describe, expect, it } from "vitest";
import type { SupplyItemRow } from "../supplies/supplyModel";
import { demoSupplierCataloguePreview } from "./demoSupplierCatalogue";
import {
  buildStagedSupplierCatalogueRows,
  buildSupplierMatchCandidatePayloads,
  supplierCatalogueSourceFingerprint,
} from "./supplierCatalogueWorkflow";
import type {
  SupplierAccount,
  SupplierProduct,
} from "./supplierModel";

const account = {
  id: "00000000-0000-4000-8000-000000000001",
  account_key: "00000000-0000-4000-8000-000000000001",
  organization_id: "00000000-0000-4000-8000-000000000002",
  provider_key: "demo",
  display_name: "Demo",
  customer_number: null,
  active: true,
  created_by: "00000000-0000-4000-8000-000000000003",
  created_at: "2026-07-29T09:00:00Z",
  updated_at: "2026-07-29T09:00:00Z",
} satisfies SupplierAccount;

const item = {
  id: "item-1",
  item_key: "purchase:graddfil",
  canonical_key: "a".repeat(64),
  category: "Mejeri",
  item_name: "Gräddfil",
  required_amount: 5,
  required_unit: "l",
  ordered_amount: null,
  ordered_unit: null,
  package_note: null,
  comment: null,
  completed: false,
  row_version: 1,
  source_present: true,
  manually_moved: false,
} satisfies SupplyItemRow;

const product = {
  id: "00000000-0000-4000-8000-000000000004",
  organization_id: account.organization_id,
  supplier_account_id: account.id,
  supplier_article_number: "MS-168278",
  display_name: "Gräddfil 3,6 l",
  gtin: "07310865004703",
  purchase_unit: "kolli",
  package_amount: 3.6,
  package_unit: "l",
  minimum_order_units: 1,
  brand: "Arla",
  catch_weight: false,
  category: "Mejeri",
  latest_import_run_id: "00000000-0000-4000-8000-000000000005",
  normalized_search_name: "graddfil",
  packaging_metadata: {},
  product_fingerprint: "b".repeat(64),
  source_metadata: {},
  active: true,
  product_data_source: "import:xlsx",
  source_updated_at: "2026-07-29T09:00:00Z",
  created_by: account.created_by,
  created_at: "2026-07-29T09:00:00Z",
  updated_at: "2026-07-29T09:00:00Z",
} satisfies SupplierProduct;

describe("supplier catalogue workflow", () => {
  it("skapar ett stabilt SHA-256-fingeravtryck av importens semantiska innehåll", async () => {
    const first = await supplierCatalogueSourceFingerprint(demoSupplierCataloguePreview);
    const second = await supplierCatalogueSourceFingerprint(demoSupplierCataloguePreview);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it("stegar bara giltiga och granskningsbara rader och håller Dabas separat", () => {
    const rows = buildStagedSupplierCatalogueRows(demoSupplierCataloguePreview, [{
      gtin: "07310865004703",
      displayName: "Dabas namn",
      brand: "Dabas-varumärke",
      packageDescription: "12 x 3 dl",
      manufacturerArticleNumber: "168278",
    }]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.normalized_data).toMatchObject({
      supplier_article_number: "MS-168278",
      display_name: "Gräddfil 3 dl",
      brand: "Arla",
      package_amount: 3.6,
      package_unit: "l",
    });
    expect(rows[0]?.normalized_data.metadata).toMatchObject({
      dabas_display_name: "Dabas namn",
    });
  });

  it("bygger en säker kandidat med förklaringar och aktuellt produktfingeravtryck", () => {
    const payloads = buildSupplierMatchCandidatePayloads({
      organizationId: account.organization_id,
      supplierAccountId: account.id,
      items: [item],
      accounts: [account],
      products: [product],
      offers: [],
      approvedMatches: [],
      rejectedFingerprintsByCanonicalKey: new Map(),
      asOfDate: "2026-07-29",
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      canonical_key: item.canonical_key,
      supplier_product_id: product.id,
      status: "safe",
      score: 100,
      product_fingerprint: "b".repeat(64),
      required_unit: "l",
      amount_per_purchase_unit: 3.6,
    });
  });
});
