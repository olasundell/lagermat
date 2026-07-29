import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SupplyItemRow } from "../supplies/supplyModel";
import { SupplierCataloguePanel, type SupplierCatalogueCandidateView } from "./SupplierCataloguePanel";
import type { SupplierAccount, SupplierProduct } from "./supplierModel";

const account: SupplierAccount = {
  id: "account-1",
  account_key: "00000000-0000-4000-8000-000000000001",
  organization_id: "organization-1",
  provider_key: "demo",
  display_name: "Demo-grossist",
  customer_number: null,
  active: true,
  created_by: "user-1",
  created_at: "2026-07-29T09:00:00Z",
  updated_at: "2026-07-29T09:00:00Z",
};

const product: SupplierProduct = {
  id: "product-1",
  organization_id: "organization-1",
  supplier_account_id: account.id,
  supplier_article_number: "RIS-10",
  display_name: "Ris 10 kg",
  gtin: "07310865004703",
  purchase_unit: "säck",
  package_amount: 10,
  package_unit: "kg",
  minimum_order_units: 1,
  brand: "Demo",
  catch_weight: false,
  category: "Skafferi",
  latest_import_run_id: null,
  normalized_search_name: "ris",
  packaging_metadata: {},
  product_fingerprint: "b".repeat(64),
  source_metadata: {},
  active: true,
  product_data_source: "catalogue_file",
  source_updated_at: "2026-07-29T09:00:00Z",
  created_by: "user-1",
  created_at: "2026-07-29T09:00:00Z",
  updated_at: "2026-07-29T09:00:00Z",
};

const item: SupplyItemRow = {
  id: "item-1",
  item_key: "purchase:ris",
  canonical_key: "ingredient:ris",
  category: "Torrvaror",
  item_name: "Ris",
  required_amount: 15,
  required_unit: "kg",
  ordered_amount: null,
  ordered_unit: null,
  package_note: null,
  comment: null,
  completed: false,
  row_version: 1,
  source_present: true,
  manually_moved: false,
};

const candidate: SupplierCatalogueCandidateView = {
  id: "candidate-1",
  supplierAccountId: account.id,
  canonicalKey: item.canonical_key,
  supplierProductId: product.id,
  status: "pending",
  classification: "safe",
  score: 100,
  matcherVersion: "deterministic-v1",
  amountPerPurchaseUnit: 10,
  requiredUnit: "kg",
  reasons: ["Exakt namn", "Samma mängdenhet", "Verifierad förpackning"],
  product,
};

function renderPanel(overrides: Partial<Parameters<typeof SupplierCataloguePanel>[0]> = {}) {
  return render(
    <SupplierCataloguePanel
      accounts={[account]}
      items={[item]}
      candidates={[]}
      approvedMatches={[]}
      columnProfiles={[]}
      online
      loading={false}
      onImport={vi.fn().mockResolvedValue({ imported: 2, matched: 1, dabasConfigured: false })}
      onApproveSafe={vi.fn().mockResolvedValue(undefined)}
      onApprove={vi.fn().mockResolvedValue(undefined)}
      onReject={vi.fn().mockResolvedValue(undefined)}
      onSuggestAlternative={vi.fn().mockResolvedValue(undefined)}
      onSearchAlternatives={vi.fn().mockResolvedValue([product])}
      {...overrides}
    />,
  );
}

describe("SupplierCataloguePanel", () => {
  it("låter användaren prova en tydligt märkt demokatalog och importerar bara giltiga rader", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn().mockResolvedValue({ imported: 2, matched: 1, dabasConfigured: false });
    renderPanel({ onImport });

    await user.click(screen.getByRole("button", { name: "Prova med exempeldata" }));

    expect(screen.getByText("demo-leverantorskatalog.xlsx")).toBeInTheDocument();
    expect(screen.getByText("1 kompletta")).toBeInTheDocument();
    expect(screen.getByText("1 behöver granskas")).toBeInTheDocument();
    expect(screen.getByText("1 blockeras")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Importera 2 artiklar" }));

    expect(onImport).toHaveBeenCalledWith(
      account.id,
      expect.objectContaining({ filename: "demo-leverantorskatalog.xlsx" }),
      expect.any(Array),
    );
    expect(await screen.findByText("Dabas är inte konfigurerat", { exact: false })).toBeInTheDocument();
  });

  it("batchgodkänner bara väntande säkra förslag", async () => {
    const user = userEvent.setup();
    const onApproveSafe = vi.fn().mockResolvedValue(undefined);
    renderPanel({ candidates: [candidate], onApproveSafe });

    expect(screen.getByText("2 säck täcker 20 kg.", { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Godkänn alla säkra" }));

    expect(onApproveSafe).toHaveBeenCalledWith(["candidate-1"]);
  });

  it("låter granskaren godkänna eller avvisa ett enskilt förslag", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const onReject = vi.fn().mockResolvedValue(undefined);
    renderPanel({
      candidates: [{ ...candidate, classification: "review", score: 82 }],
      onApprove,
      onReject,
    });

    await user.click(screen.getByRole("button", { name: "Godkänn" }));
    expect(onApprove).toHaveBeenCalledWith("candidate-1");

    await user.click(screen.getByRole("button", { name: "Inte rätt artikel" }));
    expect(onReject).toHaveBeenCalledWith("candidate-1");
  });

  it("söker bland importerade artiklar när ingen kandidat finns", async () => {
    const user = userEvent.setup();
    const onSuggestAlternative = vi.fn().mockResolvedValue(undefined);
    const onSearchAlternatives = vi.fn().mockResolvedValue([product]);
    renderPanel({ onSuggestAlternative, onSearchAlternatives });

    await user.type(screen.getByLabelText("Sök alternativ för Ris"), "RIS-10");
    await user.click(screen.getByRole("button", { name: "Sök" }));
    await user.click(screen.getByRole("button", { name: /Ris 10 kg/ }));

    expect(onSearchAlternatives).toHaveBeenCalledWith(account.id, "RIS-10");
    expect(onSuggestAlternative).toHaveBeenCalledWith(item, product);
  });

  it("återanvänder ett inläst godkännande efter omladdning", () => {
    renderPanel({
      approvedMatches: [{
        supplierAccountId: account.id,
        canonicalKey: item.canonical_key,
      }],
    });

    expect(screen.queryByLabelText("Sök alternativ för Ris")).not.toBeInTheDocument();
    expect(screen.getByText("Alla råvaror har minst ett förslag.")).toBeInTheDocument();
  });
});
