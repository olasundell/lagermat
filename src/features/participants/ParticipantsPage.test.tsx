import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { activeParticipantListFilter } from "./participantLifecycle";
import { ParticipantsPage } from "./ParticipantsPage";

const participantData = {
  participants: [
    { id: "adam", display_name: "Adam Jansson", division_id: "spararna", patrol_id: "ekorren", meal_group_id: null, food_factor: 0.75 },
    { id: "beatrice", display_name: "Beatrice Nilsson", division_id: "upptackarna", patrol_id: "ravarna", meal_group_id: null, food_factor: 0.9 }
  ],
  groups: [
    { id: "spararna", name: "Spårarna" },
    { id: "upptackarna", name: "Upptäckarna" },
    { id: "ekorren", name: "Ekorren" },
    { id: "ravarna", name: "Rävarna" }
  ],
  attendances: [],
  batches: []
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: participantData, error: null, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() })
}));

vi.mock("../../lib/supabase", () => ({ supabase: {} }));

vi.mock("../workspace/WorkspaceContext", () => ({
  useWorkspace: () => ({
    activeMembership: { organizationId: "organization-1", organizationName: "Björkstad scoutkår" },
    activeCamp: { id: "camp-1", name: "Sommarläger 2026" }
  })
}));

describe("ParticipantsPage filtering", () => {
  it("uses the canonical participant lifecycle field for the active list", () => {
    expect(activeParticipantListFilter).toEqual({
      column: "lifecycle_status",
      value: "active"
    });
  });

  it("searches names and group names and filters by division", async () => {
    const user = userEvent.setup();
    render(<ParticipantsPage />);

    const search = screen.getByRole("searchbox", { name: "Sök deltagare" });
    await user.type(search, "Ekorren");

    expect(screen.getByText("Adam Jansson")).toBeInTheDocument();
    expect(screen.queryByText("Beatrice Nilsson")).not.toBeInTheDocument();

    await user.clear(search);
    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrera deltagare efter avdelning" }), "upptackarna");

    expect(screen.queryByText("Adam Jansson")).not.toBeInTheDocument();
    expect(screen.getByText("Beatrice Nilsson")).toBeInTheDocument();
  });
});
