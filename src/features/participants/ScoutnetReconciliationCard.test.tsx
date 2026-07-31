import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyScoutnetReconciliation,
  readScoutnetReconciliationPreview,
  type ScoutnetReconciliationPreview
} from "./scoutnetApi";
import { ScoutnetReconciliationCard } from "./ScoutnetReconciliationCard";
import { humanChangeValue } from "./scoutnetReconciliationPresentation";

const campId = "caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const sourceReference = (character: string) =>
  `scoutnet:v1:${character.repeat(43)}`;
const duplicateParticipantId =
  "81000000-0000-0000-0000-000000000001";

const preview: ScoutnetReconciliationPreview = {
  campId,
  snapshotSource: "local_fixture",
  previewDigest: "a".repeat(64),
  complete: true,
  snapshotParticipantCount: 2,
  stateDigest: "b".repeat(64),
  rows: [
    {
      sourceReference: sourceReference("a"),
      displayName: "Syntetisk Scout Ett",
      category: "new",
      proposedAction: "create",
      existingParticipantId: null,
      registrationStatus: "unconfirmed",
      attendanceWarnings: ["attendance_answer_missing"],
      duplicateCandidates: [],
      changes: [],
      specialDietChange: "added"
    },
    {
      sourceReference: sourceReference("b"),
      displayName: "Syntetisk Dubblett",
      category: "possible_duplicate",
      proposedAction: "review",
      existingParticipantId: null,
      registrationStatus: "confirmed",
      attendanceWarnings: [],
      duplicateCandidates: [{
        participantId: duplicateParticipantId,
        displayName: "Syntetisk Dubblett",
        sourceKind: "manual",
        lifecycleStatus: "active"
      }],
      changes: [],
      specialDietChange: null
    },
    {
      sourceReference: sourceReference("c"),
      displayName: "Syntetisk Återtagning",
      category: "withdrawn",
      proposedAction: "withdraw",
      existingParticipantId:
        "82000000-0000-0000-0000-000000000002",
      registrationStatus: "cancelled",
      attendanceWarnings: [],
      duplicateCandidates: [],
      changes: [{
        field: "lifecycle_status",
        previous: "active",
        next: "withdrawn",
        destructive: true
      }],
      specialDietChange: null
    }
  ],
  counts: {
    new: 1,
    changed: 0,
    unchanged: 0,
    reactivated: 0,
    withdrawn: 1,
    possible_duplicate: 1
  }
};

const invalidateQueries = vi.fn();

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
      questionMappingUpdatedAt: null,
      lastSuccessfulSyncAt: null,
      lastSuccessfulSyncParticipantCount: null
    },
    error: null,
    isLoading: false
  }),
  useQueryClient: () => ({ invalidateQueries })
}));

vi.mock("../../lib/supabase", () => ({ supabase: {} }));

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
      timezone: "Europe/Stockholm"
    }
  })
}));

vi.mock("./scoutnetApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scoutnetApi")>();
  return {
    ...actual,
    readScoutnetConnectionStatus: vi.fn(),
    readScoutnetReconciliationPreview: vi.fn(async () => preview),
    applyScoutnetReconciliation: vi.fn(async () => ({
      campId,
      stateDigest: "c".repeat(64),
      appliedAt: "2026-07-31T08:00:00.000Z",
      snapshotParticipantCount: 2,
      counts: {
        created: 1,
        linked: 1,
        updated: 0,
        reactivated: 0,
        withdrawn: 0,
        skipped: 1
      }
    }))
  };
});

describe("Scoutnet reconciliation card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires explicit human choices for duplicates and destructive changes", async () => {
    const user = userEvent.setup();
    render(<ScoutnetReconciliationCard />);

    await user.click(screen.getByRole("button", { name: "Synka nu" }));
    expect(await screen.findByText("Syntetisk Scout Ett"))
      .toBeInTheDocument();
    expect(screen.getByText(/Anmälan är ännu inte bekräftad/))
      .toBeInTheDocument();
    expect(screen.getByText(/länkar aldrig automatiskt på namn/))
      .toBeInTheDocument();
    expect(screen.getByText("2 beslut återstår")).toBeInTheDocument();

    const applyButton = screen.getByRole("button", {
      name: "Tillämpa granskad avstämning"
    });
    expect(applyButton).toBeDisabled();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Beslut för Syntetisk Dubblett" }),
      `link:${duplicateParticipantId}`
    );
    await user.selectOptions(
      screen.getByRole("combobox", {
        name: "Beslut för Syntetisk Återtagning"
      }),
      "skip"
    );
    expect(screen.getByText("Alla rader har ett beslut")).toBeInTheDocument();
    expect(applyButton).toBeEnabled();

    await user.click(applyButton);
    await waitFor(() =>
      expect(applyScoutnetReconciliation).toHaveBeenCalledOnce()
    );
    expect(vi.mocked(applyScoutnetReconciliation).mock.calls[0]?.[2])
      .toEqual([
        { sourceReference: sourceReference("a"), action: "apply" },
        {
          sourceReference: sourceReference("b"),
          action: "link",
          participantId: duplicateParticipantId
        },
        { sourceReference: sourceReference("c"), action: "skip" }
      ]);
    expect(screen.getByText(/1 skapade · 1 länkade/)).toBeInTheDocument();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["participants-page"]
    });
  });

  it("does not read the preview before the administrator chooses Synka nu", () => {
    render(<ScoutnetReconciliationCard />);
    expect(readScoutnetReconciliationPreview).not.toHaveBeenCalled();
  });

  it("renders attendance intervals as local human-readable dates", () => {
    expect(humanChangeValue(
      "attendance",
      "2026-08-02T06:00:00.000Z/2026-08-05T18:00:00.000Z",
      "Europe/Stockholm"
    )).toMatch(/2 aug.*08:00.*5 aug.*20:00/u);
  });
});
