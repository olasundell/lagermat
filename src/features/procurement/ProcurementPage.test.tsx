import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplyItemRow, SupplyListRow } from "../supplies/supplyModel";
import type { SupplierCatalogueCandidateView } from "../suppliers/SupplierCataloguePanel";
import type { SupplierFoundationSnapshot } from "../suppliers/supplierApi";
import type {
  IngredientSupplierMatch,
  SupplierAccount,
  SupplierProduct,
} from "../suppliers/supplierModel";
import { ProcurementPage } from "./ProcurementPage";

type SupplierTestData = SupplierFoundationSnapshot;

const testState = vi.hoisted(() => ({
  lists: [] as SupplyListRow[],
  supplierData: {
    accounts: [],
    products: [],
    offers: [],
    matches: [],
    details: [],
    candidates: [],
    columnProfiles: [],
    approvedMatches: [],
  } as SupplierTestData,
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  saveSupplyItem: vi.fn().mockResolvedValue(undefined),
  approveSafe: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "supply-lists") {
      return {
        data: { lists: testState.lists, source: "network", cachedAt: null },
        error: null,
        isLoading: false,
      };
    }
    if (queryKey[0] === "supplier-foundation") {
      return {
        data: testState.supplierData,
        error: null,
        isPending: false,
        isFetching: false,
      };
    }
    return {
      data: { id: "calculation-1", revision_number: 1, status: "current" },
      error: null,
      isPending: false,
      isFetching: false,
    };
  },
  useQueryClient: () => ({ invalidateQueries: testState.invalidateQueries }),
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

vi.mock("../workspace/WorkspaceContext", () => ({
  useWorkspace: () => ({
    activeMembership: { organizationId: "organization-1", organizationName: "Björkstad scoutkår" },
    activeCamp: { id: "camp-1", name: "Sommarläger 2026", timezone: "Europe/Stockholm" },
  }),
}));

vi.mock("../supplies/useOfflineSupplyState", () => ({
  useOfflineSupplyState: () => ({ online: true, pending: 0, conflicts: [] }),
}));

vi.mock("../supplies/SupplyExportActions", () => ({ SupplyExportActions: () => null }));
vi.mock("../supplies/SupplySyncStatus", () => ({ SupplySyncStatus: () => null }));
vi.mock("../supplies/supplyApi", () => ({
  fetchCurrentCalculation: vi.fn(),
  fetchSupplyLists: vi.fn(),
  generateSupplyLists: vi.fn(),
  saveSupplyItem: testState.saveSupplyItem,
}));
vi.mock("../suppliers/SupplierOrderExportActions", () => ({
  SupplierOrderExportActions: () => null,
}));
vi.mock("../suppliers/supplierApi", () => ({
  ensureIcaSicklaSupplierAccount: vi.fn(),
  fetchSupplierFoundation: vi.fn(),
  saveSupplierAccount: vi.fn(),
  saveSupplierProductMatch: vi.fn(),
}));
vi.mock("../suppliers/supplierCatalogueApi", () => ({
  approveSafeSupplierMatchCandidates: testState.approveSafe,
  decideSupplierMatchCandidate: vi.fn(),
  ensureSupplierCatalogueMatches: vi.fn().mockResolvedValue({
    generated: false,
  }),
  importSupplierCatalogueAndMatch: vi.fn(),
  searchSupplierCatalogueProducts: vi.fn(),
  suggestSupplierCatalogueAlternative: vi.fn(),
}));

const account: SupplierAccount = {
  id: "account-1",
  account_key: "00000000-0000-4000-8000-000000000001",
  organization_id: "organization-1",
  provider_key: "ica",
  provider_location_id: "1004021",
  display_name: "ICA Kvantum Sickla",
  customer_number: null,
  active: true,
  created_by: "user-1",
  created_at: "2026-07-29T09:00:00Z",
  updated_at: "2026-07-29T09:00:00Z",
};

const tomatoProduct: SupplierProduct = {
  id: "product-tomato",
  organization_id: "organization-1",
  supplier_account_id: account.id,
  supplier_article_number: "DEMO-TOMAT-6",
  display_name: "Krossade tomater",
  gtin: "07350000000009",
  purchase_unit: "kolli",
  package_amount: 2.4,
  package_unit: "kg",
  minimum_order_units: 1,
  brand: "Demo",
  catch_weight: false,
  category: "Konserver",
  latest_import_run_id: null,
  normalized_search_name: "krossade tomater",
  packaging_metadata: {
    inner_unit_count: 6,
    inner_unit_label: "burkar",
  },
  product_fingerprint: "b".repeat(64),
  source_metadata: {},
  active: true,
  product_data_source: "catalogue_file",
  source_updated_at: "2026-07-29T09:00:00Z",
  created_by: "user-1",
  created_at: "2026-07-29T09:00:00Z",
  updated_at: "2026-07-29T09:00:00Z",
};

function tomatoItem(overrides: Partial<SupplyItemRow> = {}): SupplyItemRow {
  return {
    id: "item-tomato",
    item_key: "purchase:krossade-tomater",
    canonical_key: "ingredient:krossade-tomater",
    category: "Konserver",
    item_name: "Krossade tomater",
    required_amount: 1.7373,
    required_unit: "kg",
    ordered_amount: null,
    ordered_unit: null,
    package_note: null,
    comment: null,
    completed: false,
    row_version: 1,
    source_present: true,
    manually_moved: false,
    ...overrides,
  };
}

function purchaseList(item: SupplyItemRow): SupplyListRow {
  return {
    id: "purchase-list-1",
    list_key: "purchase",
    kind: "purchase",
    status: "active",
    title: "Hela lägret",
    range_start: null,
    range_end: null,
    version: 1,
    source_present: true,
    calculation_revisions: { revision_number: 1, status: "current" },
    supply_list_items: [item],
  };
}

function supplierData(overrides: Partial<SupplierTestData> = {}): SupplierTestData {
  return {
    accounts: [],
    products: [],
    offers: [],
    matches: [],
    details: [],
    candidates: [],
    columnProfiles: [],
    approvedMatches: [],
    ...overrides,
  };
}

beforeEach(() => {
  testState.lists = [];
  testState.supplierData = supplierData();
  vi.clearAllMocks();
});

describe("ProcurementPage", () => {
  it("exposes the selected perspective with aria-pressed", async () => {
    const user = userEvent.setup();
    render(<ProcurementPage />);

    const purchase = screen.getByRole("button", { name: "Hela lägret" });
    const distribution = screen.getByRole("button", { name: "Per måltid och matlag" });

    expect(purchase).toHaveAttribute("aria-pressed", "true");
    expect(distribution).toHaveAttribute("aria-pressed", "false");

    await user.click(distribution);

    expect(purchase).toHaveAttribute("aria-pressed", "false");
    expect(distribution).toHaveAttribute("aria-pressed", "true");
  });

  it("writes a safe approved match to the order row in whole supplier packages", async () => {
    const user = userEvent.setup();
    const item = tomatoItem();
    const candidate: SupplierCatalogueCandidateView = {
      id: "candidate-tomato",
      supplierAccountId: account.id,
      canonicalKey: item.canonical_key,
      supplierProductId: tomatoProduct.id,
      status: "pending",
      classification: "safe",
      score: 100,
      matcherVersion: "deterministic-v1",
      amountPerPurchaseUnit: 2.4,
      requiredUnit: "kg",
      reasons: ["Exakt namn", "Samma mängdenhet", "Verifierad förpackning"],
      product: tomatoProduct,
    };
    testState.lists = [purchaseList(item)];
    testState.supplierData = supplierData({
      accounts: [account],
      products: [tomatoProduct],
      candidates: [candidate],
    });

    render(<ProcurementPage />);

    expect(screen.getByText("6 burkar (1 kolli à 6 × 400 g) täcker 2,4 kg.", {
      exact: false,
    })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Godkänn alla säkra" }));

    await waitFor(() => expect(testState.approveSafe).toHaveBeenCalledWith(
      {
        userId: "user-1",
        organizationId: "organization-1",
        campId: "camp-1",
      },
      account.id,
      [candidate.id],
    ));
    expect(testState.saveSupplyItem).toHaveBeenCalledWith(
      {
        userId: "user-1",
        organizationId: "organization-1",
        campId: "camp-1",
      },
      "purchase-list-1",
      item,
      expect.objectContaining({
        orderedAmount: 1,
        orderedUnit: "kolli",
        packageNote: expect.stringContaining("6 burkar"),
      }),
    );
  });

  it("shows the consumer packages prominently after approval without a false unit warning", () => {
    const item = tomatoItem({
      ordered_amount: 1,
      ordered_unit: "kolli",
      package_note: "6 burkar (1 kolli à 6 × 400 g) = 2.4 kg",
    });
    const match: IngredientSupplierMatch = {
      id: "match-tomato",
      organization_id: "organization-1",
      canonical_key: item.canonical_key,
      supplier_product_id: tomatoProduct.id,
      supplier_account_id: account.id,
      required_unit: "kg",
      amount_per_purchase_unit: 2.4,
      approved_product_fingerprint: tomatoProduct.product_fingerprint,
      approved_by: "user-1",
      approved_at: "2026-07-29T10:00:00Z",
      created_at: "2026-07-29T10:00:00Z",
      updated_at: "2026-07-29T10:00:00Z",
    };
    testState.lists = [purchaseList(item)];
    testState.supplierData = supplierData({
      accounts: [account],
      products: [tomatoProduct],
      matches: [match],
      details: [{ account, product: tomatoProduct, offer: null, match }],
      approvedMatches: [{
        supplierAccountId: account.id,
        canonicalKey: item.canonical_key,
      }],
    });

    const { container } = render(<ProcurementPage />);

    const summary = container.querySelector(".order-editor__supplier-summary");
    expect(summary).not.toBeNull();
    expect(within(summary as HTMLElement).getByText(
      "Köp 6 burkar (1 kolli à 6 × 400 g)",
    )).toBeInTheDocument();
    expect(screen.queryByText(/Kontrollera mängden manuellt/)).not.toBeInTheDocument();
  });
});
