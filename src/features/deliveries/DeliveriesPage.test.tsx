import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeliveriesPage } from "./DeliveriesPage";
import { filterSupplyItems, formatExactAmount, hasUnitMismatch, type SupplyItemRow, type SupplyListRow } from "../supplies/supplyModel";

const mocks = vi.hoisted(() => ({
  fetchCurrentCalculation: vi.fn(),
  fetchSupplyLists: vi.fn(),
  generateSupplyLists: vi.fn(),
  invalidateQueries: vi.fn()
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...props }: { to: string; children: React.ReactNode; className?: string }) => <a href={to} {...props}>{children}</a>
  };
});

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } })
}));

vi.mock("../workspace/WorkspaceContext", () => ({
  useWorkspace: () => ({
    activeCamp: { id: "camp-1", name: "Testlägret", timezone: "Europe/Stockholm" },
    activeMembership: { organizationId: "org-1", organizationName: "Testkåren" }
  })
}));

vi.mock("../supplies/useOfflineSupplyState", () => ({
  useOfflineSupplyState: () => ({ online: true, pending: 0, conflicts: [] })
}));

vi.mock("../supplies/SupplySyncStatus", () => ({ SupplySyncStatus: () => null }));
vi.mock("../supplies/SupplyExportActions", () => ({
  SupplyExportActions: ({ disabled }: { disabled: boolean }) => <button disabled={disabled}>Testexport</button>
}));

vi.mock("../supplies/supplyApi", () => ({
  changeSupplyListStatus: vi.fn(),
  fetchCurrentCalculation: mocks.fetchCurrentCalculation,
  fetchSupplyLists: mocks.fetchSupplyLists,
  generateSupplyLists: mocks.generateSupplyLists,
  moveDeliveryItem: vi.fn(),
  saveSupplyItem: vi.fn()
}));

const items: SupplyItemRow[] = [
  { id: "1", item_key: "a", canonical_key: "ingredient:a", category: "Grönt", item_name: "Aubergine", required_amount: 5.7, required_unit: "st", ordered_amount: 3, ordered_unit: "kg", package_note: null, comment: null, completed: false, row_version: 1, source_present: true, manually_moved: false },
  { id: "2", item_key: "b", canonical_key: "ingredient:b", category: "Kylvaror", item_name: "Bregott", required_amount: 3.441, required_unit: "kg", ordered_amount: 3.5, ordered_unit: "kg", package_note: null, comment: null, completed: true, row_version: 1, source_present: true, manually_moved: false }
];

describe("delivery supply model", () => {
  it("filters remaining items and preserves exact decimal text", () => {
    expect(filterSupplyItems(items, "remaining", "").map((item) => item.item_name)).toEqual(["Aubergine"]);
    expect(formatExactAmount(items[0]!.required_amount)).toBe("5,7");
    expect(formatExactAmount(items[1]!.required_amount)).toBe("3,441");
  });

  it("flags unlike units without pretending to compare them", () => {
    expect(hasUnitMismatch(items[0]!)).toBe(true);
    expect(hasUnitMismatch(items[1]!)).toBe(false);
  });
});

const staleDelivery: SupplyListRow = {
  id: "delivery-1",
  list_key: "delivery-1",
  kind: "delivery",
  status: "active",
  title: "Första leveransen",
  range_start: null,
  range_end: null,
  version: 1,
  source_present: true,
  calculation_revisions: { revision_number: 1, status: "stale" },
  supply_list_items: []
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.invalidateQueries.mockImplementation((filters) => queryClient.invalidateQueries(filters));
  return render(<QueryClientProvider client={queryClient}><DeliveriesPage /></QueryClientProvider>);
}

describe("delivery calculation guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchCurrentCalculation.mockResolvedValue(null);
    mocks.fetchSupplyLists.mockResolvedValue({ lists: [], source: "server", cachedAt: null });
    mocks.generateSupplyLists.mockResolvedValue(undefined);
  });

  it("guides to Matsedel instead of creating deliveries without a current calculation", async () => {
    renderPage();

    expect(await screen.findByRole("link", { name: "Räkna ut mängder" })).toHaveAttribute("href", "/matsedel");
    expect(screen.queryByRole("button", { name: "Skapa leveranser" })).not.toBeInTheDocument();
    expect(mocks.generateSupplyLists).not.toHaveBeenCalled();
  });

  it("does not update an existing delivery from a stale calculation", async () => {
    mocks.fetchSupplyLists.mockResolvedValue({ lists: [staleDelivery], source: "server", cachedAt: null });
    renderPage();

    expect(await screen.findByRole("heading", { name: "Första leveransen" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Räkna ut mängder" })).toHaveAttribute("href", "/matsedel");
    expect(screen.queryByRole("button", { name: "Uppdatera" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Testexport" })).toBeDisabled();
  });

  it("asks to update the delivery list when a current calculation exists", async () => {
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [staleDelivery],
      source: "server",
      cachedAt: null,
    });
    renderPage();

    expect(await screen.findByText(
      /Datum saknas · 0 varor · listan behöver uppdateras/,
    )).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uppdatera" }))
      .toBeInTheDocument();
    expect(screen.queryByText(/mängderna behöver räknas om/))
      .not.toBeInTheDocument();
  });

  it("creates deliveries when a current calculation exists", async () => {
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Skapa leveranser" }));
    await waitFor(() => expect(mocks.generateSupplyLists).toHaveBeenCalledTimes(1));
  });

  it("exposes which delivery filter is selected", async () => {
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyLists.mockResolvedValue({ lists: [staleDelivery], source: "server", cachedAt: null });
    renderPage();

    const all = await screen.findByRole("button", { name: "Alla 0" });
    const remaining = screen.getByRole("button", { name: "Kvar 0" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(remaining).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(remaining);
    expect(remaining).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");
  });

  it("uses singular copy when one delivery item remains", async () => {
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [{ ...staleDelivery, supply_list_items: [items[0]!] }],
      source: "server",
      cachedAt: null
    });
    renderPage();

    expect(await screen.findByText("1 vara återstår")).toBeInTheDocument();
    expect(screen.getByText(/Datum saknas · 1 vara ·/)).toBeInTheDocument();
  });

  it("shows the allocated ICA package share on the delivery row", async () => {
    const allocatedItem: SupplyItemRow = {
      ...items[1]!,
      ordered_amount: 3,
      ordered_unit: "förpackning",
      package_note: "3 av totalt 15 förpackningar · 0,14 kg/förpackning · Bacon skivat 140g (ICA 12345)",
      order_source_kind: "supplier_purchase",
      supplier_order_source_item_id: "purchase-item-1",
      supplier_order_account_id: "ica-sickla",
      supplier_order_product_id: "ica-bacon",
      supplier_order_total_units: 15,
      supplier_order_product_fingerprint: "a".repeat(64)
    };
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [{ ...staleDelivery, supply_list_items: [allocatedItem] }],
      source: "server",
      cachedAt: null
    });

    renderPage();

    expect(await screen.findByLabelText("Beställt för Bregott")).toHaveTextContent("3 förpackningar");
    expect(screen.getByText(/3 av totalt 15 förpackningar/)).toBeInTheDocument();
    expect(screen.getByText(/Bacon skivat 140g/)).toBeInTheDocument();
  });

  it("rounds each delivery's indivisible physical requirement upwards", async () => {
    const purchase: SupplyListRow = {
      ...staleDelivery,
      id: "purchase",
      list_key: "purchase",
      kind: "purchase",
      title: "Hela lägret",
      supply_list_items: [{
        ...items[0]!,
        id: "purchase-bread",
        canonical_key: "ingredient:bread",
        item_name: "Mjukt bröd",
        required_amount: 14.2,
        required_unit: "skivor",
      }],
    };
    const first: SupplyListRow = {
      ...staleDelivery,
      id: "delivery-a",
      list_key: "delivery:a",
      title: "Första leveransen",
      range_start: "2026-07-20T08:00:00Z",
      supply_list_items: [{
        ...items[0]!,
        id: "delivery-a-bread",
        item_key: "bread",
        canonical_key: "ingredient:bread",
        item_name: "Mjukt bröd",
        required_amount: 7.1,
        required_unit: "skivor",
      }],
    };
    const second: SupplyListRow = {
      ...staleDelivery,
      id: "delivery-b",
      list_key: "delivery:b",
      title: "Andra leveransen",
      range_start: "2026-07-21T08:00:00Z",
      supply_list_items: [{
        ...items[0]!,
        id: "delivery-b-bread",
        item_key: "bread",
        canonical_key: "ingredient:bread",
        item_name: "Mjukt bröd",
        required_amount: 7.1,
        required_unit: "skivor",
      }],
    };
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [purchase, first, second],
      source: "server",
      cachedAt: null,
    });
    renderPage();

    expect(await screen.findByText("Behov 8 skivor")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Leverans"), {
      target: { value: second.id },
    });
    expect(await screen.findByText("Behov 8 skivor")).toBeInTheDocument();
  });
});
