import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeliveriesPage } from "./DeliveriesPage";
import { deliveryItemOrigin, deliveryItemSource, filterSupplyItems, formatExactAmount, hasUnitMismatch, type SupplyItemRow, type SupplyListRow } from "../supplies/supplyModel";

const mocks = vi.hoisted(() => ({
  changeSupplyListStatus: vi.fn(),
  fetchCurrentCalculation: vi.fn(),
  fetchSupplyExportReadiness: vi.fn(),
  fetchSupplyLists: vi.fn(),
  generateSupplyLists: vi.fn(),
  invalidateQueries: vi.fn(),
  moveDeliveryItem: vi.fn(),
  offlineState: { online: true, pending: 0, conflicts: [] as unknown[] }
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
  useOfflineSupplyState: () => mocks.offlineState
}));

vi.mock("../supplies/SupplySyncStatus", () => ({ SupplySyncStatus: () => null }));
vi.mock("../supplies/SupplyExportActions", () => ({
  SupplyExportActions: ({ disabled }: { disabled: boolean }) => <button disabled={disabled}>Testexport</button>
}));

vi.mock("../supplies/supplyApi", () => ({
  changeSupplyListStatus: mocks.changeSupplyListStatus,
  fetchCurrentCalculation: mocks.fetchCurrentCalculation,
  fetchSupplyExportReadiness: mocks.fetchSupplyExportReadiness,
  fetchSupplyLists: mocks.fetchSupplyLists,
  generateSupplyLists: mocks.generateSupplyLists,
  moveDeliveryItem: mocks.moveDeliveryItem,
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

  it("retains a moved row's generated source identity", () => {
    const source: SupplyListRow = {
      ...staleDelivery,
      id: "source",
      list_key: "delivery:auto:2026-08-03",
      title: "Leverans 3 augusti",
    };
    const target: SupplyListRow = {
      ...source,
      id: "target",
      list_key: "delivery:auto:2026-08-04",
      title: "Leverans 4 augusti",
    };

    expect(deliveryItemOrigin({
      ...items[0]!,
      item_key: "delivery:2026-08-03:ingredient-a",
      manually_moved: true,
    }, [source, target])).toEqual({
      date: "2026-08-03",
      listId: source.id,
      title: source.title,
    });
    expect(deliveryItemSource({
      ...items[0]!,
      item_key: "delivery:2026-08-04:ingredient-a",
    }, [source, target])).toEqual({
      date: "2026-08-04",
      listId: target.id,
      title: target.title,
    });
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
    Object.assign(mocks.offlineState, { online: true, pending: 0, conflicts: [] });
    mocks.fetchCurrentCalculation.mockResolvedValue(null);
    mocks.fetchSupplyExportReadiness.mockResolvedValue({ canFinalize: true, problems: [] });
    mocks.fetchSupplyLists.mockResolvedValue({ lists: [], source: "server", cachedAt: null });
    mocks.generateSupplyLists.mockResolvedValue(undefined);
    mocks.moveDeliveryItem.mockResolvedValue(undefined);
    mocks.changeSupplyListStatus.mockResolvedValue(undefined);
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

  it("opens the first unfinished delivery by default", async () => {
    const complete = {
      ...staleDelivery,
      id: "delivery-complete",
      title: "Redan klar",
      status: "complete" as const,
    };
    const current = {
      ...staleDelivery,
      id: "delivery-current",
      title: "Pågår nu",
      status: "active" as const,
    };
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [complete, current],
      source: "server",
      cachedAt: null,
    });

    renderPage();

    expect(await screen.findByRole("heading", { name: "Pågår nu" })).toBeInTheDocument();
  });

  it("saves the open delivery form in the same operation as a move", async () => {
    const source: SupplyListRow = {
      ...staleDelivery,
      calculation_revisions: { revision_number: 2, status: "current" },
      supply_list_items: [{
        ...items[0]!,
        item_key: "delivery:2026-08-03:a",
      }],
    };
    const target: SupplyListRow = {
      ...source,
      id: "delivery-2",
      list_key: "delivery:auto:2026-08-04",
      title: "Andra leveransen",
      supply_list_items: [],
    };
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [source, target],
      source: "server",
      cachedAt: null,
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Visa detaljer för Aubergine" }));
    fireEvent.change(screen.getByLabelText("Beställt antal för Aubergine"), {
      target: { value: "7,5" },
    });
    fireEvent.change(screen.getByLabelText("Beställd enhet för Aubergine"), {
      target: { value: "kg" },
    });
    fireEvent.change(screen.getByLabelText("Förpackning för denna leverans"), {
      target: { value: "3 lådor" },
    });
    fireEvent.change(screen.getByLabelText("Kommentar"), {
      target: { value: "Till kökstältet" },
    });
    fireEvent.change(screen.getByLabelText("Flytta till leverans"), {
      target: { value: target.id },
    });

    expect(mocks.moveDeliveryItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Spara och flytta" }));

    await waitFor(() => expect(mocks.moveDeliveryItem).toHaveBeenCalledWith(
      source.supply_list_items[0],
      target.id,
      {
        orderedAmount: 7.5,
        orderedUnit: "kg",
        packageNote: "3 lådor",
        comment: "Till kökstältet",
        completed: false,
      },
    ));
  });

  it("distinguishes same-product rows by their source after a move", async () => {
    const original: SupplyListRow = {
      ...staleDelivery,
      id: "delivery-original",
      list_key: "delivery:auto:2026-08-03",
      title: "Leverans 3 augusti",
      status: "complete",
      calculation_revisions: { revision_number: 2, status: "current" },
      supply_list_items: [],
    };
    const target: SupplyListRow = {
      ...original,
      id: "delivery-target",
      list_key: "delivery:auto:2026-08-04",
      title: "Leverans 4 augusti",
      status: "active",
      supply_list_items: [
        {
          ...items[0]!,
          id: "moved",
          item_key: "delivery:2026-08-03:a",
          manually_moved: true,
        },
        {
          ...items[0]!,
          id: "native",
          item_key: "delivery:2026-08-04:a",
        },
      ],
    };
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [original, target],
      source: "server",
      cachedAt: null,
    });

    renderPage();

    expect(await screen.findByText("Ursprung: Leverans 3 augusti")).toBeInTheDocument();
    expect(screen.getByText("Ursprung: Leverans 4 augusti")).toBeInTheDocument();
  });

  it("shows server blockers next to the sticky footer and disables completion", async () => {
    const readyItems = items.map((item) => ({ ...item, completed: true }));
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyExportReadiness.mockResolvedValue({
      canFinalize: false,
      problems: ["1 ICA-träff behöver granskas"],
    });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [{
        ...staleDelivery,
        calculation_revisions: { revision_number: 2, status: "current" },
        supply_list_items: readyItems,
      }],
      source: "server",
      cachedAt: null,
    });

    renderPage();

    expect(await screen.findByText("1 ICA-träff behöver granskas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Markera leverans klar/ })).toBeDisabled();
  });

  it("rechecks readiness immediately before completing the delivery", async () => {
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyExportReadiness
      .mockResolvedValueOnce({ canFinalize: true, problems: [] })
      .mockResolvedValueOnce({
        canFinalize: false,
        problems: ["Beräkningen saknas eller är inaktuell"],
      });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [{
        ...staleDelivery,
        calculation_revisions: { revision_number: 2, status: "current" },
        supply_list_items: items.map((item) => ({ ...item, completed: true })),
      }],
      source: "server",
      cachedAt: null,
    });

    renderPage();

    const button = await screen.findByRole("button", { name: /Markera leverans klar/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    await waitFor(() => expect(mocks.fetchSupplyExportReadiness).toHaveBeenCalledTimes(2));
    expect(mocks.changeSupplyListStatus).not.toHaveBeenCalled();
    expect(await screen.findByText("Beräkningen saknas eller är inaktuell")).toBeInTheDocument();
  });

  it("explains that final status requires the database when offline", async () => {
    Object.assign(mocks.offlineState, { online: false, pending: 0, conflicts: [] });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [{
        ...staleDelivery,
        calculation_revisions: { revision_number: 2, status: "current" },
        supply_list_items: items.map((item) => ({ ...item, completed: true })),
      }],
      source: "cache",
      cachedAt: "2026-07-31T08:00:00Z",
    });

    renderPage();

    expect(await screen.findByText("Anslut till databasen för att slutmarkera leveransen.")).toBeInTheDocument();
    expect(screen.queryByText("Sparas lokalt")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Markera leverans klar/ })).toBeDisabled();
  });

  it("shows the current ICA allocation separately from the whole-camp packaging", async () => {
    const allocatedItem: SupplyItemRow = {
      ...items[1]!,
      ordered_amount: 3,
      ordered_unit: "förpackning",
      package_note: null,
      order_package_note: "15 × 140 g · Bacon skivat 140g (ICA 12345)",
      order_source_kind: "supplier_purchase",
      supplier_order_source_item_id: "purchase-item-1",
      supplier_order_account_id: "ica-sickla",
      supplier_order_product_id: "ica-bacon",
      supplier_order_total_units: 15,
      supplier_order_product_fingerprint: "a".repeat(64),
      supplier_order_synthetic_fixture: true,
    };
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [{ ...staleDelivery, supply_list_items: [allocatedItem] }],
      source: "server",
      cachedAt: null
    });

    renderPage();

    expect(await screen.findByLabelText("Beställt för Bregott")).toHaveTextContent("3 förpackningar");
    expect(screen.getByLabelText("Beställningsförpackning för hela lägret: 15 × 140 g · Bacon skivat 140g (ICA 12345)")).toHaveTextContent("Hela lägret: 15 × 140 g");
    expect(screen.getAllByText("LOKAL SYNTETISK TESTARTIKEL – INTE BUTIKSDATA"))
      .toHaveLength(2);
    expect(screen.getByText(/1 rad bygger på lokal testdata/)).toBeInTheDocument();
    expect(screen.getByText(/Valda inköpsförpackningar fördelas globalt/))
      .toBeInTheDocument();
    expect(screen.queryByText(/Faktiska ICA-förpackningar/))
      .not.toBeInTheDocument();
    expect(screen.queryByText(/3 av totalt 15 förpackningar/)).not.toBeInTheDocument();
  });

  it("preserves a manual whole-camp package description on allocated deliveries", async () => {
    const allocatedItem: SupplyItemRow = {
      ...items[0]!,
      item_name: "Havredryck",
      required_amount: 10.9,
      required_unit: "l",
      ordered_amount: 11,
      ordered_unit: "l",
      package_note: null,
      order_package_note: "45 × 1 l",
      order_source_kind: "manual_purchase",
      manual_order_source_item_id: "purchase-item-1",
      manual_order_total_amount: 45,
      manual_order_unit: "l",
    };
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [{ ...staleDelivery, supply_list_items: [allocatedItem] }],
      source: "server",
      cachedAt: null,
    });

    renderPage();

    expect(await screen.findByLabelText("Beställt för Havredryck")).toHaveTextContent("11 l");
    expect(screen.getByLabelText("Beställningsförpackning för hela lägret: 45 × 1 l")).toHaveTextContent("Hela lägret: 45 × 1 l");
  });

  it("keeps receipt history readable but requires an active checked item to be reopened before editing or moving it", async () => {
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [{
        ...staleDelivery,
        calculation_revisions: { revision_number: 2, status: "current" },
        supply_list_items: [{
          ...items[1]!,
          completed: true,
          package_note: "2 kylbackar",
          comment: "Mottaget av Kim",
        }],
      }],
      source: "server",
      cachedAt: null,
    });

    renderPage();

    expect(await screen.findByText("Kvitterad – markera som kvar för att ändra eller flytta.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Markera som kvar: Bregott" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Visa detaljer för Bregott" }));
    expect(screen.getByLabelText("Sparade leveransuppgifter för Bregott"))
      .toHaveTextContent("2 kylbackar");
    expect(screen.getByLabelText("Sparade leveransuppgifter för Bregott"))
      .toHaveTextContent("Mottaget av Kim");
    expect(screen.queryByRole("button", { name: "Spara beställning" }))
      .not.toBeInTheDocument();
  });

  it("makes every item in a finalised delivery read-only", async () => {
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [{
        ...staleDelivery,
        status: "complete",
        calculation_revisions: { revision_number: 2, status: "current" },
        supply_list_items: [{
          ...items[1]!,
          completed: true,
          package_note: "2 kylbackar",
          comment: "Mottaget av Kim",
        }],
      }],
      source: "server",
      cachedAt: null,
    });

    renderPage();

    expect(await screen.findByText("Leveransen är slutmarkerad och kan inte ändras.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Markera som kvar: Bregott" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Visa detaljer för Bregott" }));
    expect(screen.getByLabelText("Sparade leveransuppgifter för Bregott"))
      .toHaveTextContent("Mottaget av Kim");
    expect(screen.queryByRole("button", { name: "Spara beställning" }))
      .not.toBeInTheDocument();
  });

  it("explains an unallocated whole-camp manual order beside the empty delivery order", async () => {
    const purchase: SupplyListRow = {
      ...staleDelivery,
      id: "purchase",
      list_key: "purchase:all",
      kind: "purchase",
      title: "Hela lägret",
      supply_list_items: [{
        ...items[0]!,
        id: "purchase-tomatoes",
        canonical_key: "ingredient:tomatoes",
        item_name: "Tomatkross",
        required_amount: 14.2,
        required_unit: "kg",
        ordered_amount: 15,
        ordered_unit: "burk",
        order_source_kind: "manual",
      }],
    };
    const delivery: SupplyListRow = {
      ...staleDelivery,
      id: "delivery-tomatoes",
      list_key: "delivery:auto:2026-08-03",
      calculation_revisions: { revision_number: 2, status: "current" },
      supply_list_items: [{
        ...items[0]!,
        id: "delivery-tomatoes-item",
        canonical_key: "ingredient:tomatoes",
        item_name: "Tomatkross",
        required_amount: 7.1,
        required_unit: "kg",
        ordered_amount: null,
        ordered_unit: null,
      }],
    };
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [purchase, delivery],
      source: "server",
      cachedAt: null,
    });

    renderPage();

    expect(await screen.findByLabelText("Beställt för Tomatkross")).toHaveTextContent("Ej angivet");
    expect(screen.getByText(/Hela lägret har 15 burkar beställda/)).toBeInTheDocument();
    expect(screen.getByText(/automatisk fördelning saknas för den här leveransen/)).toBeInTheDocument();
  });

  it("checks every delivery before calling a global manual order allocatable", async () => {
    const purchase: SupplyListRow = {
      ...staleDelivery,
      id: "purchase-volume",
      list_key: "purchase:all",
      kind: "purchase",
      title: "Hela lägret",
      supply_list_items: [{
        ...items[0]!,
        id: "purchase-drink",
        canonical_key: "ingredient:drink",
        item_name: "Havredryck",
        ordered_amount: 45,
        ordered_unit: "l",
        order_source_kind: "manual",
      }],
    };
    const first: SupplyListRow = {
      ...staleDelivery,
      id: "delivery-volume",
      list_key: "delivery:auto:2026-08-03",
      title: "Första leveransen",
      calculation_revisions: { revision_number: 2, status: "current" },
      supply_list_items: [{
        ...items[0]!,
        id: "delivery-drink",
        canonical_key: "ingredient:drink",
        item_name: "Havredryck",
        required_amount: 17.3,
        required_unit: "l",
        ordered_amount: 17,
        ordered_unit: "l",
        order_source_kind: "manual_purchase",
      }],
    };
    const second: SupplyListRow = {
      ...first,
      id: "delivery-incompatible",
      list_key: "delivery:auto:2026-08-04",
      title: "Andra leveransen",
      supply_list_items: [{
        ...first.supply_list_items[0]!,
        id: "delivery-drink-incompatible",
        item_key: "delivery:2026-08-04:drink",
        required_amount: 27.7,
        required_unit: "l",
        ordered_amount: null,
        ordered_unit: null,
        order_source_kind: null,
      }],
    };
    mocks.fetchCurrentCalculation.mockResolvedValue({ id: "calculation-1" });
    mocks.fetchSupplyLists.mockResolvedValue({
      lists: [purchase, first, second],
      source: "server",
      cachedAt: null,
    });

    renderPage();

    expect(await screen.findByText("En global beställning behöver fördelas manuellt.")).toBeInTheDocument();
    expect(screen.getByText(/45 l Havredryck/)).toBeInTheDocument();
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
