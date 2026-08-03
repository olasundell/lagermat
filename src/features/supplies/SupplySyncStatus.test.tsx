import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PendingMutation } from "../../lib/offlineDb";
import { SupplySyncStatus } from "./SupplySyncStatus";

const mocks = vi.hoisted(() => ({
  resolveConflictWithLocal: vi.fn(),
  resolveConflictWithServer: vi.fn(),
  syncPendingMutations: vi.fn(),
}));

vi.mock("./offlineSync", () => mocks);

const mutation: PendingMutation = {
  id: "mutation-1",
  userId: "user-1",
  organizationId: "org-1",
  campId: "camp-1",
  listId: "delivery-1",
  entityId: "item-1",
  itemName: "Mjölk",
  baseVersion: 1,
  baseValues: {
    ordered_amount: 2,
    ordered_unit: "l",
    package_note: null,
    comment: null,
    completed: true,
  },
  changes: { comment: "Flytta till nästa leverans" },
  status: "conflict",
  conflicts: [{ field: "comment", base: null, server: null, client: "Flytta till nästa leverans" }],
  policyReason: "reopen_required",
  serverVersion: 1,
  serverValues: {
    ordered_amount: 2,
    ordered_unit: "l",
    package_note: null,
    comment: null,
    completed: true,
  },
  createdAt: "2026-07-31T12:00:00Z",
  attempts: 1,
  lastError: null,
};

describe("SupplySyncStatus policy conflicts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets the planner discard an invalid checked-item edit without retrying it forever", async () => {
    const onRefresh = vi.fn();
    render(<SupplySyncStatus
      scope={{ userId: "user-1", organizationId: "org-1", campId: "camp-1" }}
      state={{ online: true, pending: 0, conflicts: [mutation] }}
      cached={false}
      cachedAt={null}
      onRefresh={onRefresh}
    />);

    expect(screen.getByText("Varan är kvitterad. Ta bort den osparade ändringen, markera sedan varan som kvar innan du ändrar den.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spara min version" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ta bort osparad ändring" }));
    await waitFor(() => expect(mocks.resolveConflictWithServer).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", organizationId: "org-1", campId: "camp-1" }),
      mutation,
    ));
    expect(mocks.resolveConflictWithLocal).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
  });
});
