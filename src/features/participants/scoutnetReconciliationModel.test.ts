import { describe, expect, it } from "vitest";
import type {
  ScoutnetReconciliationPreview,
  ScoutnetReconciliationRow
} from "./scoutnetApi";
import {
  createScoutnetDecisionDraft,
  scoutnetDecisionsFromDraft,
  scoutnetRowNeedsExplicitDecision
} from "./scoutnetReconciliationModel";

const sourceReference = (character: string) =>
  `scoutnet:v1:${character.repeat(43)}`;

function row(
  overrides: Partial<ScoutnetReconciliationRow> = {}
): ScoutnetReconciliationRow {
  return {
    sourceReference: sourceReference("a"),
    displayName: "Syntetisk Scout",
    category: "new",
    proposedAction: "create",
    existingParticipantId: null,
    registrationStatus: "confirmed",
    attendanceWarnings: [],
    duplicateCandidates: [],
    changes: [],
    specialDietChange: null,
    ...overrides
  };
}

function preview(
  rows: ScoutnetReconciliationRow[]
): ScoutnetReconciliationPreview {
  return {
    campId: "caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
    snapshotSource: "local_fixture",
    previewDigest: "a".repeat(64),
    complete: true,
    snapshotParticipantCount: 1,
    stateDigest: "b".repeat(64),
    rows,
    counts: {
      new: rows.filter((value) => value.category === "new").length,
      changed: rows.filter((value) => value.category === "changed").length,
      unchanged: rows.filter((value) => value.category === "unchanged").length,
      reactivated: rows.filter((value) =>
        value.category === "reactivated"
      ).length,
      withdrawn: rows.filter((value) =>
        value.category === "withdrawn"
      ).length,
      possible_duplicate: rows.filter((value) =>
        value.category === "possible_duplicate"
      ).length
    }
  };
}

describe("Scoutnet reconciliation decisions", () => {
  it("defaults safe changes but requires a choice for destructive changes", () => {
    const safe = row();
    const destructive = row({
      sourceReference: sourceReference("b"),
      category: "withdrawn",
      proposedAction: "withdraw",
      changes: [{
        field: "lifecycle_status",
        previous: "active",
        next: "withdrawn",
        destructive: true
      }]
    });
    const draft = createScoutnetDecisionDraft(preview([safe, destructive]));

    expect(draft[safe.sourceReference]).toBe("apply");
    expect(draft[destructive.sourceReference]).toBe("");
    expect(scoutnetRowNeedsExplicitDecision(destructive)).toBe(true);
  });

  it("accepts only an explicit candidate link from the preview", () => {
    const participantId = "81000000-0000-0000-0000-000000000001";
    const duplicate = row({
      category: "possible_duplicate",
      proposedAction: "review",
      duplicateCandidates: [{
        participantId,
        displayName: "Syntetisk Scout",
        sourceKind: "manual",
        lifecycleStatus: "active"
      }]
    });
    const targetPreview = preview([duplicate]);

    expect(scoutnetDecisionsFromDraft(targetPreview, {
      [duplicate.sourceReference]: `link:${participantId}`
    })).toEqual([{
      sourceReference: duplicate.sourceReference,
      action: "link",
      participantId
    }]);
    expect(scoutnetDecisionsFromDraft(targetPreview, {
      [duplicate.sourceReference]:
        "link:82000000-0000-0000-0000-000000000002"
    })).toBeNull();
  });
});
