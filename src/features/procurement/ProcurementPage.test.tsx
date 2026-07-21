import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProcurementPage } from "./ProcurementPage";

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => queryKey[0] === "supply-lists"
    ? { data: { lists: [], source: "network", cachedAt: null }, error: null, isLoading: false }
    : { data: { id: "calculation-1", revision_number: 1, status: "current" }, error: null, isPending: false, isFetching: false },
  useQueryClient: () => ({ invalidateQueries: vi.fn() })
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

vi.mock("../workspace/WorkspaceContext", () => ({
  useWorkspace: () => ({
    activeMembership: { organizationId: "organization-1", organizationName: "Björkstad scoutkår" },
    activeCamp: { id: "camp-1", name: "Sommarläger 2026", timezone: "Europe/Stockholm" }
  })
}));

vi.mock("../supplies/useOfflineSupplyState", () => ({
  useOfflineSupplyState: () => ({ online: true, pending: 0, conflicts: [] })
}));

vi.mock("../supplies/SupplyExportActions", () => ({ SupplyExportActions: () => null }));
vi.mock("../supplies/SupplySyncStatus", () => ({ SupplySyncStatus: () => null }));
vi.mock("../supplies/supplyApi", () => ({
  fetchCurrentCalculation: vi.fn(),
  fetchSupplyLists: vi.fn(),
  generateSupplyLists: vi.fn(),
  saveSupplyItem: vi.fn()
}));

describe("ProcurementPage perspective tabs", () => {
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
});
