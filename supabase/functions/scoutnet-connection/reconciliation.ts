import type {
  ScoutnetAttendanceRange,
  ScoutnetAttendanceWarning,
  ScoutnetParticipantSnapshot,
  ScoutnetRegistrationStatus,
} from "./adapter.ts";

export type ScoutnetReconciliationCategory =
  | "new"
  | "changed"
  | "unchanged"
  | "reactivated"
  | "withdrawn"
  | "possible_duplicate";

export type ScoutnetReconciliationAction =
  | "create"
  | "update"
  | "reactivate"
  | "withdraw"
  | "review"
  | "none";

export type ScoutnetParticipantSourceKind =
  | "manual"
  | "import"
  | "scoutnet"
  | "legacy";

export type ParticipantLifecycleStatus = "active" | "withdrawn";

export interface ScoutnetReconciliationGroupState {
  reference: string | null;
  name: string | null;
}

export interface ScoutnetReconciliationParticipantState {
  id: string;
  displayName: string;
  sourceKind: ScoutnetParticipantSourceKind;
  sourceReference: string | null;
  lifecycleStatus: ParticipantLifecycleStatus;
  registrationStatus: ScoutnetRegistrationStatus | null;
  division: ScoutnetReconciliationGroupState;
  patrol: ScoutnetReconciliationGroupState;
  attendance: ScoutnetAttendanceRange[];
  specialDietRaw: string | null;
  dietaryReviewStatus: "unreviewed" | "reviewed" | "resolved" | null;
  dietaryTagCount: number;
}

export interface ScoutnetReconciliationContext {
  campId: string;
  stateDigest: string;
  participants: ScoutnetReconciliationParticipantState[];
}

export type ScoutnetReconciliationChangeField =
  | "display_name"
  | "registration_status"
  | "division"
  | "patrol"
  | "attendance"
  | "special_diet"
  | "lifecycle_status";

export interface ScoutnetReconciliationChange {
  field: ScoutnetReconciliationChangeField;
  previous: string | null;
  next: string | null;
  destructive: boolean;
}

export interface ScoutnetDuplicateCandidate {
  participantId: string;
  displayName: string;
  sourceKind: Exclude<ScoutnetParticipantSourceKind, "scoutnet">;
  lifecycleStatus: ParticipantLifecycleStatus;
}

export interface ScoutnetReconciliationRow {
  sourceReference: string;
  displayName: string;
  category: ScoutnetReconciliationCategory;
  proposedAction: ScoutnetReconciliationAction;
  existingParticipantId: string | null;
  registrationStatus: ScoutnetRegistrationStatus | null;
  attendanceWarnings: ScoutnetAttendanceWarning[];
  duplicateCandidates: ScoutnetDuplicateCandidate[];
  changes: ScoutnetReconciliationChange[];
  specialDietChange: "added" | "changed" | "cleared" | null;
}

export interface ScoutnetReconciliationPreview {
  complete: true;
  snapshotParticipantCount: number;
  stateDigest: string;
  rows: ScoutnetReconciliationRow[];
  counts: Record<ScoutnetReconciliationCategory, number>;
}

export class ScoutnetReconciliationError extends Error {
  readonly code:
    | "empty_snapshot"
    | "duplicate_identity"
    | "too_many_decisions";

  constructor(code: ScoutnetReconciliationError["code"], message: string) {
    super(message);
    this.name = "ScoutnetReconciliationError";
    this.code = code;
  }
}

function normaliseName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("sv-SE");
}

function normaliseOptionalText(value: string | null): string | null {
  const normalised = value?.normalize("NFKC").trim().replace(/\s+/g, " ");
  return normalised ? normalised : null;
}

export function scoutnetSpecialDietRaw(values: string[]): string | null {
  const normalised = values
    .map((value) => normaliseOptionalText(value))
    .filter((value): value is string => value !== null);
  return normalised.length > 0 ? normalised.join("\n") : null;
}

function groupLabel(group: ScoutnetReconciliationGroupState): string | null {
  if (!group.reference && !group.name) return null;
  return `${group.name ?? "Okänd"} [${group.reference ?? "saknar-id"}]`;
}

function canonicalTimestamp(value: string): string {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : value;
}

function attendanceKey(ranges: ScoutnetAttendanceRange[]): string {
  return ranges
    .map((range) => ({
      startsAt: canonicalTimestamp(range.startsAt),
      endsAt: canonicalTimestamp(range.endsAt),
    }))
    .sort((left, right) =>
      left.startsAt.localeCompare(right.startsAt)
      || left.endsAt.localeCompare(right.endsAt)
    )
    .map((range) => `${range.startsAt}/${range.endsAt}`)
    .join("|");
}

function attendanceLabel(ranges: ScoutnetAttendanceRange[]): string | null {
  return ranges.length > 0 ? attendanceKey(ranges) : null;
}

function sameGroup(
  left: ScoutnetReconciliationGroupState,
  right: ScoutnetReconciliationGroupState,
): boolean {
  return left.reference === right.reference
    && normaliseOptionalText(left.name) === normaliseOptionalText(right.name);
}

function specialDietChange(
  previous: string | null,
  next: string | null,
): "added" | "changed" | "cleared" | null {
  const previousValue = normaliseOptionalText(previous);
  const nextValue = normaliseOptionalText(next);
  if (previousValue === nextValue) return null;
  if (!previousValue && nextValue) return "added";
  if (previousValue && !nextValue) return "cleared";
  return "changed";
}

function participantChanges(
  existing: ScoutnetReconciliationParticipantState,
  incoming: ScoutnetParticipantSnapshot["participants"][number],
): {
  changes: ScoutnetReconciliationChange[];
  dietChange: "added" | "changed" | "cleared" | null;
} {
  const changes: ScoutnetReconciliationChange[] = [];
  if (
    normaliseOptionalText(existing.displayName)
      !== normaliseOptionalText(incoming.displayName)
  ) {
    changes.push({
      field: "display_name",
      previous: existing.displayName,
      next: incoming.displayName,
      destructive: false,
    });
  }
  if (existing.registrationStatus !== incoming.registrationStatus) {
    changes.push({
      field: "registration_status",
      previous: existing.registrationStatus,
      next: incoming.registrationStatus,
      destructive: incoming.registrationStatus === "cancelled",
    });
  }
  if (!sameGroup(existing.division, incoming.division)) {
    changes.push({
      field: "division",
      previous: groupLabel(existing.division),
      next: groupLabel(incoming.division),
      destructive: false,
    });
  }
  if (!sameGroup(existing.patrol, incoming.patrol)) {
    changes.push({
      field: "patrol",
      previous: groupLabel(existing.patrol),
      next: groupLabel(incoming.patrol),
      destructive: false,
    });
  }
  if (attendanceKey(existing.attendance) !== attendanceKey(incoming.attendance)) {
    changes.push({
      field: "attendance",
      previous: attendanceLabel(existing.attendance),
      next: attendanceLabel(incoming.attendance),
      destructive: incoming.attendance.length === 0,
    });
  }
  const nextDiet = scoutnetSpecialDietRaw(incoming.specialDiet);
  const dietChange = specialDietChange(existing.specialDietRaw, nextDiet);
  if (dietChange) {
    changes.push({
      field: "special_diet",
      previous: normaliseOptionalText(existing.specialDietRaw),
      next: nextDiet,
      destructive: dietChange === "cleared",
    });
  }
  return { changes, dietChange };
}

function duplicateCandidates(
  incomingName: string,
  participants: ScoutnetReconciliationParticipantState[],
): ScoutnetDuplicateCandidate[] {
  const target = normaliseName(incomingName);
  return participants
    .filter((participant) =>
      participant.sourceKind !== "scoutnet"
      && normaliseName(participant.displayName) === target
    )
    .map((participant) => ({
      participantId: participant.id,
      displayName: participant.displayName,
      sourceKind: participant.sourceKind as Exclude<
        ScoutnetParticipantSourceKind,
        "scoutnet"
      >,
      lifecycleStatus: participant.lifecycleStatus,
    }))
    .sort((left, right) =>
      left.displayName.localeCompare(right.displayName, "sv")
      || left.participantId.localeCompare(right.participantId)
    );
}

function emptyCounts(): Record<ScoutnetReconciliationCategory, number> {
  return {
    new: 0,
    changed: 0,
    unchanged: 0,
    reactivated: 0,
    withdrawn: 0,
    possible_duplicate: 0,
  };
}

export function buildScoutnetReconciliationPreview(
  snapshot: ScoutnetParticipantSnapshot,
  context: ScoutnetReconciliationContext,
): ScoutnetReconciliationPreview {
  if (
    snapshot.complete !== true
    || snapshot.participantCount !== snapshot.participants.length
    || snapshot.participantCount === 0
  ) {
    throw new ScoutnetReconciliationError(
      "empty_snapshot",
      "Ett oväntat tomt eller ofullständigt Scoutnet-svar får inte skapa en avstämning.",
    );
  }

  const exactScoutnetParticipants = new Map(
    context.participants
      .filter((participant) =>
        participant.sourceKind === "scoutnet"
        && participant.sourceReference
      )
      .map((participant) => [participant.sourceReference!, participant]),
  );
  const incomingReferences = new Set<string>();
  const rows: ScoutnetReconciliationRow[] = [];

  for (const incoming of snapshot.participants) {
    if (incomingReferences.has(incoming.sourceReference)) {
      throw new ScoutnetReconciliationError(
        "duplicate_identity",
        "Scoutnet-svaret innehåller dubbla deltagaridentiteter.",
      );
    }
    incomingReferences.add(incoming.sourceReference);
    const existing = exactScoutnetParticipants.get(incoming.sourceReference);

    if (!existing) {
      if (incoming.registrationStatus === "cancelled") {
        rows.push({
          sourceReference: incoming.sourceReference,
          displayName: incoming.displayName,
          category: "withdrawn",
          proposedAction: "none",
          existingParticipantId: null,
          registrationStatus: incoming.registrationStatus,
          attendanceWarnings: incoming.attendanceWarnings,
          duplicateCandidates: [],
          changes: [],
          specialDietChange: null,
        });
        continue;
      }
      const candidates = duplicateCandidates(
        incoming.displayName,
        context.participants,
      );
      rows.push({
        sourceReference: incoming.sourceReference,
        displayName: incoming.displayName,
        category: candidates.length > 0 ? "possible_duplicate" : "new",
        proposedAction: candidates.length > 0 ? "review" : "create",
        existingParticipantId: null,
        registrationStatus: incoming.registrationStatus,
        attendanceWarnings: incoming.attendanceWarnings,
        duplicateCandidates: candidates,
        changes: [],
        specialDietChange: scoutnetSpecialDietRaw(incoming.specialDiet)
          ? "added"
          : null,
      });
      continue;
    }

    const compared = participantChanges(existing, incoming);
    if (incoming.registrationStatus === "cancelled") {
      const alreadyWithdrawn = existing.lifecycleStatus === "withdrawn";
      rows.push({
        sourceReference: incoming.sourceReference,
        displayName: incoming.displayName,
        category: alreadyWithdrawn ? "unchanged" : "withdrawn",
        proposedAction: alreadyWithdrawn ? "none" : "withdraw",
        existingParticipantId: existing.id,
        registrationStatus: incoming.registrationStatus,
        attendanceWarnings: incoming.attendanceWarnings,
        duplicateCandidates: [],
        changes: alreadyWithdrawn
          ? compared.changes
          : [
            ...compared.changes,
            {
              field: "lifecycle_status",
              previous: "active",
              next: "withdrawn",
              destructive: true,
            },
          ],
        specialDietChange: compared.dietChange,
      });
      continue;
    }

    if (existing.lifecycleStatus === "withdrawn") {
      rows.push({
        sourceReference: incoming.sourceReference,
        displayName: incoming.displayName,
        category: "reactivated",
        proposedAction: "reactivate",
        existingParticipantId: existing.id,
        registrationStatus: incoming.registrationStatus,
        attendanceWarnings: incoming.attendanceWarnings,
        duplicateCandidates: [],
        changes: [
          ...compared.changes,
          {
            field: "lifecycle_status",
            previous: "withdrawn",
            next: "active",
            destructive: false,
          },
        ],
        specialDietChange: compared.dietChange,
      });
      continue;
    }

    rows.push({
      sourceReference: incoming.sourceReference,
      displayName: incoming.displayName,
      category: compared.changes.length > 0 ? "changed" : "unchanged",
      proposedAction: compared.changes.length > 0 ? "update" : "none",
      existingParticipantId: existing.id,
      registrationStatus: incoming.registrationStatus,
      attendanceWarnings: incoming.attendanceWarnings,
      duplicateCandidates: [],
      changes: compared.changes,
      specialDietChange: compared.dietChange,
    });
  }

  for (const existing of exactScoutnetParticipants.values()) {
    if (
      existing.lifecycleStatus !== "active"
      || !existing.sourceReference
      || incomingReferences.has(existing.sourceReference)
    ) {
      continue;
    }
    rows.push({
      sourceReference: existing.sourceReference,
      displayName: existing.displayName,
      category: "withdrawn",
      proposedAction: "withdraw",
      existingParticipantId: existing.id,
      registrationStatus: existing.registrationStatus,
      attendanceWarnings: [],
      duplicateCandidates: [],
      changes: [{
        field: "lifecycle_status",
        previous: "active",
        next: "withdrawn",
        destructive: true,
      }],
      specialDietChange: null,
    });
  }

  rows.sort((left, right) =>
    left.category.localeCompare(right.category)
    || left.displayName.localeCompare(right.displayName, "sv")
    || left.sourceReference.localeCompare(right.sourceReference)
  );
  if (rows.length > 5_000) {
    throw new ScoutnetReconciliationError(
      "too_many_decisions",
      "Avstämningen innehåller fler än 5 000 beslut och måste delas upp säkert.",
    );
  }
  const counts = emptyCounts();
  for (const row of rows) counts[row.category] += 1;

  return {
    complete: true,
    snapshotParticipantCount: snapshot.participantCount,
    stateDigest: context.stateDigest,
    rows,
    counts,
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function scoutnetReconciliationPreviewDigest(
  preview: ScoutnetReconciliationPreview,
): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableJson(preview)),
  )));
}
