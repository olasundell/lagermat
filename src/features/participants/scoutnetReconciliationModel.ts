import type {
  ScoutnetReconciliationDecision,
  ScoutnetReconciliationPreview,
  ScoutnetReconciliationRow
} from "./scoutnetApi";

export type ScoutnetDecisionDraft = Record<string, string>;

export function scoutnetRowNeedsExplicitDecision(
  row: ScoutnetReconciliationRow
): boolean {
  return row.category === "possible_duplicate"
    || row.changes.some((change) => change.destructive);
}

export function createScoutnetDecisionDraft(
  preview: ScoutnetReconciliationPreview
): ScoutnetDecisionDraft {
  return Object.fromEntries(preview.rows.map((row) => {
    if (scoutnetRowNeedsExplicitDecision(row)) {
      return [row.sourceReference, ""];
    }
    return [
      row.sourceReference,
      row.proposedAction === "none" ? "skip" : "apply"
    ];
  }));
}

function decisionFromValue(
  sourceReference: string,
  value: string
): ScoutnetReconciliationDecision | null {
  if (value === "apply" || value === "skip") {
    return { sourceReference, action: value };
  }
  if (value.startsWith("link:")) {
    const participantId = value.slice("link:".length);
    if (
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(participantId)
    ) {
      return { sourceReference, action: "link", participantId };
    }
  }
  return null;
}

export function scoutnetDecisionsFromDraft(
  preview: ScoutnetReconciliationPreview,
  draft: ScoutnetDecisionDraft
): ScoutnetReconciliationDecision[] | null {
  const decisions = preview.rows.map((row) =>
    decisionFromValue(row.sourceReference, draft[row.sourceReference] ?? "")
  );
  if (decisions.some((decision) => decision === null)) return null;

  const resolved = decisions as ScoutnetReconciliationDecision[];
  for (let index = 0; index < resolved.length; index += 1) {
    const decision = resolved[index];
    const row = preview.rows[index];
    if (
      !decision
      || !row
      || (
        decision.action === "link"
        && !row.duplicateCandidates.some((candidate) =>
          candidate.participantId === decision.participantId
        )
      )
    ) {
      return null;
    }
  }
  return resolved;
}
