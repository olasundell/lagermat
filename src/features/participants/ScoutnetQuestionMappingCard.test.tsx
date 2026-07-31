import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readScoutnetQuestionCatalogue,
  type ScoutnetQuestionCatalogueResponse
} from "./scoutnetApi";
import { ScoutnetQuestionMappingCard } from "./ScoutnetQuestionMappingCard";

const campId = "caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const catalogue: ScoutnetQuestionCatalogueResponse = {
  campId,
  questions: [
    { id: "1101", label: "Ankomst", description: null, type: "datetime", choices: [] },
    { id: "1102", label: "Avresa", description: null, type: "datetime", choices: [] },
    { id: "1201", label: "Specialkost", description: null, type: "textarea", choices: [] }
  ],
  suggestions: [
    { questionId: "1101", role: "attendance_start", score: 90, reason: "test" },
    { questionId: "1102", role: "attendance_end", score: 90, reason: "test" },
    { questionId: "1201", role: "special_diet", score: 90, reason: "test" }
  ],
  currentMapping: {},
  mappingValid: false,
  mappingUpdatedAt: null
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      campId,
      connected: true,
      projectId: "7701",
      hasParticipantsApiKey: true,
      hasQuestionsApiKey: true,
      questionMapping: {},
      connectedAt: "2026-07-30T20:00:00.000Z",
      credentialsRotatedAt: null,
      questionMappingUpdatedAt: null
    },
    error: null,
    isLoading: false,
    refetch: vi.fn()
  })
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {},
  supabaseConfiguration: { isLocal: false }
}));

vi.mock("../workspace/WorkspaceContext", () => ({
  useWorkspace: () => ({
    activeMembership: {
      organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
      organizationName: "Björkstad scoutkår",
      role: "admin"
    },
    activeCamp: {
      id: campId,
      name: "Sommarläger 2026",
      startsOn: "2026-08-02",
      endsOn: "2026-08-05",
      timezone: "Europe/Stockholm"
    }
  })
}));

vi.mock("./scoutnetApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scoutnetApi")>();
  return {
    ...actual,
    readScoutnetConnectionStatus: vi.fn(),
    readScoutnetQuestionCatalogue: vi.fn(async () => catalogue),
    saveScoutnetQuestionMapping: vi.fn()
  };
});

describe("Scoutnet question-mapping card", () => {
  beforeEach(() => {
    vi.mocked(readScoutnetQuestionCatalogue).mockClear();
  });

  it("does not contact Scoutnet until the administrator asks for the catalogue", async () => {
    const user = userEvent.setup();
    render(<ScoutnetQuestionMappingCard />);

    expect(readScoutnetQuestionCatalogue).not.toHaveBeenCalled();
    await user.click(screen.getByText("Scoutnet-frågemappning"));
    expect(readScoutnetQuestionCatalogue).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", {
      name: "Hämta Scoutnet-frågor"
    }));
    await waitFor(() =>
      expect(readScoutnetQuestionCatalogue).toHaveBeenCalledOnce()
    );
    expect(screen.getByText(/Automatiska förslag har fyllts i/))
      .toBeInTheDocument();
  });
});
