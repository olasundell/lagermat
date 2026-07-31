import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";

export interface ScoutnetAttendanceIntervalMapping {
  starts_at_question_id: string;
  ends_at_question_id: string;
}

export interface ScoutnetAttendanceDayMapping {
  question_id: string;
  date: string;
}

export interface ScoutnetQuestionMapping {
  group_question_id?: string;
  division_question_id?: string;
  patrol_question_id?: string;
  special_diet_question_id?: string;
  special_diet_question_ids?: string[];
  attendance_intervals?: ScoutnetAttendanceIntervalMapping[];
  attendance_days?: ScoutnetAttendanceDayMapping[];
}

export interface ScoutnetConnectionStatus {
  campId: string;
  connected: boolean;
  projectId: string | null;
  hasParticipantsApiKey: boolean;
  hasQuestionsApiKey: boolean;
  questionMapping: ScoutnetQuestionMapping;
  connectedAt: string | null;
  credentialsRotatedAt: string | null;
  questionMappingUpdatedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastSuccessfulSyncParticipantCount: number | null;
}

export type ScoutnetQuestionRole =
  | "group"
  | "division"
  | "patrol"
  | "attendance_start"
  | "attendance_end"
  | "attendance_day"
  | "special_diet";

export interface ScoutnetQuestionDescriptor {
  id: string;
  label: string;
  description: string | null;
  type: string | null;
  choices: Array<{ id: string; label: string }>;
}

export interface ScoutnetQuestionSuggestion {
  questionId: string;
  role: ScoutnetQuestionRole;
  score: number;
  reason: string;
  suggestedDate?: string;
}

export interface ScoutnetQuestionCatalogueResponse {
  campId: string;
  questions: ScoutnetQuestionDescriptor[];
  suggestions: ScoutnetQuestionSuggestion[];
  currentMapping: ScoutnetQuestionMapping;
  mappingValid: boolean;
  mappingUpdatedAt: string | null;
}

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

export type ScoutnetRegistrationStatus =
  | "confirmed"
  | "unconfirmed"
  | "cancelled";

export type ScoutnetAttendanceWarning =
  | "attendance_mapping_missing"
  | "attendance_answer_missing"
  | "attendance_answer_incomplete"
  | "attendance_answer_invalid"
  | "attendance_no_days_selected";

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
  sourceKind: "manual" | "import" | "legacy";
  lifecycleStatus: "active" | "withdrawn";
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
  campId: string;
  snapshotSource: "local_fixture";
  previewDigest: string;
  complete: true;
  snapshotParticipantCount: number;
  stateDigest: string;
  rows: ScoutnetReconciliationRow[];
  counts: Record<ScoutnetReconciliationCategory, number>;
}

export type ScoutnetReconciliationDecision =
  | {
      sourceReference: string;
      action: "apply" | "skip";
    }
  | {
      sourceReference: string;
      action: "link";
      participantId: string;
    };

export interface ScoutnetReconciliationApplyResult {
  campId: string;
  stateDigest: string;
  appliedAt: string;
  snapshotParticipantCount: number;
  counts: {
    created: number;
    linked: number;
    updated: number;
    reactivated: number;
    withdrawn: number;
    skipped: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function isQuestionId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{1,20}$/.test(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[]
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key))
    && keys.every((key) => required.includes(key));
}

function isSourceReference(value: unknown): value is string {
  return typeof value === "string"
    && /^scoutnet:v1:[A-Za-z0-9_-]{43}$/.test(value);
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isBoundedTextOrNull(value: unknown): value is string | null {
  return value === null
    || (typeof value === "string" && value.length <= 2_000);
}

function isBoundedInteger(
  value: unknown,
  minimum = 0,
  maximum = 5_000
): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function isTimestampOrNull(value: unknown): value is string | null {
  return value === null
    || (
      typeof value === "string"
      && value.length <= 64
      && Number.isFinite(Date.parse(value))
    );
}

function parseQuestionMapping(value: unknown): ScoutnetQuestionMapping {
  if (!isRecord(value)) throw new Error("Scoutnet gav en ogiltig frågemappning.");
  const allowedKeys = new Set([
    "group_question_id",
    "division_question_id",
    "patrol_question_id",
    "special_diet_question_id",
    "special_diet_question_ids",
    "attendance_intervals",
    "attendance_days"
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("Scoutnet gav en ogiltig frågemappning.");
  }

  const mapping: ScoutnetQuestionMapping = {};
  for (const [source, target] of [
    ["group_question_id", "group_question_id"],
    ["division_question_id", "division_question_id"],
    ["patrol_question_id", "patrol_question_id"],
    ["special_diet_question_id", "special_diet_question_id"]
  ] as const) {
    const questionId = value[source];
    if (questionId !== undefined) {
      if (!isQuestionId(questionId)) {
        throw new Error("Scoutnet gav en ogiltig frågemappning.");
      }
      mapping[target] = questionId;
    }
  }

  if (value.special_diet_question_ids !== undefined) {
    if (
      !Array.isArray(value.special_diet_question_ids)
      || !value.special_diet_question_ids.every(isQuestionId)
    ) {
      throw new Error("Scoutnet gav en ogiltig frågemappning.");
    }
    mapping.special_diet_question_ids = [...value.special_diet_question_ids];
  }
  if (value.attendance_intervals !== undefined) {
    if (
      !Array.isArray(value.attendance_intervals)
      || !value.attendance_intervals.every((interval) =>
        isRecord(interval)
        && Object.keys(interval).length === 2
        && isQuestionId(interval.starts_at_question_id)
        && isQuestionId(interval.ends_at_question_id)
      )
    ) {
      throw new Error("Scoutnet gav en ogiltig frågemappning.");
    }
    mapping.attendance_intervals = value.attendance_intervals.map((interval) => ({
      starts_at_question_id: String(
        (interval as Record<string, unknown>).starts_at_question_id
      ),
      ends_at_question_id: String(
        (interval as Record<string, unknown>).ends_at_question_id
      )
    }));
  }
  if (value.attendance_days !== undefined) {
    if (
      !Array.isArray(value.attendance_days)
      || !value.attendance_days.every((day) =>
        isRecord(day)
        && Object.keys(day).length === 2
        && isQuestionId(day.question_id)
        && isIsoDate(day.date)
      )
    ) {
      throw new Error("Scoutnet gav en ogiltig frågemappning.");
    }
    mapping.attendance_days = value.attendance_days.map((day) => ({
      question_id: String((day as Record<string, unknown>).question_id),
      date: String((day as Record<string, unknown>).date)
    }));
  }

  return mapping;
}

function parseQuestion(value: unknown): ScoutnetQuestionDescriptor {
  if (
    !isRecord(value)
    || !isQuestionId(value.id)
    || typeof value.label !== "string"
    || value.label.length > 2_000
    || !(value.description === null
      || (typeof value.description === "string" && value.description.length <= 2_000))
    || !(value.type === null || (typeof value.type === "string" && value.type.length <= 100))
    || !Array.isArray(value.choices)
    || !value.choices.every((choice) =>
      isRecord(choice)
      && isQuestionId(choice.id)
      && typeof choice.label === "string"
      && choice.label.length <= 2_000
    )
  ) {
    throw new Error("Scoutnet gav en ogiltig frågelista.");
  }
  return {
    id: value.id,
    label: value.label,
    description: value.description,
    type: value.type,
    choices: value.choices.map((choice) => ({
      id: String((choice as Record<string, unknown>).id),
      label: String((choice as Record<string, unknown>).label)
    }))
  };
}

function isQuestionRole(value: unknown): value is ScoutnetQuestionRole {
  return [
    "group",
    "division",
    "patrol",
    "attendance_start",
    "attendance_end",
    "attendance_day",
    "special_diet"
  ].includes(String(value));
}

function parseSuggestion(value: unknown): ScoutnetQuestionSuggestion {
  if (
    !isRecord(value)
    || !isQuestionId(value.questionId)
    || !isQuestionRole(value.role)
    || typeof value.score !== "number"
    || !Number.isFinite(value.score)
    || value.score < 0
    || value.score > 100
    || typeof value.reason !== "string"
    || value.reason.length > 500
    || !(value.suggestedDate === undefined || isIsoDate(value.suggestedDate))
  ) {
    throw new Error("Scoutnet gav ett ogiltigt mappningsförslag.");
  }
  return {
    questionId: value.questionId,
    role: value.role,
    score: value.score,
    reason: value.reason,
    ...(value.suggestedDate === undefined
      ? {}
      : { suggestedDate: value.suggestedDate })
  };
}

export function parseScoutnetConnectionStatus(
  value: unknown
): ScoutnetConnectionStatus {
  if (
    !isRecord(value)
    || !isUuid(value.campId)
    || typeof value.connected !== "boolean"
    || !(value.projectId === null
      || (typeof value.projectId === "string" && /^[0-9]{1,32}$/.test(value.projectId)))
    || typeof value.hasParticipantsApiKey !== "boolean"
    || typeof value.hasQuestionsApiKey !== "boolean"
    || !isTimestampOrNull(value.connectedAt)
    || !isTimestampOrNull(value.credentialsRotatedAt)
    || !isTimestampOrNull(value.questionMappingUpdatedAt)
    || !isTimestampOrNull(value.lastSuccessfulSyncAt)
    || !(value.lastSuccessfulSyncParticipantCount === null
      || isBoundedInteger(value.lastSuccessfulSyncParticipantCount, 1))
  ) {
    throw new Error("Scoutnet-anslutningen gav ett ogiltigt svar.");
  }
  const questionMapping = parseQuestionMapping(value.questionMapping);
  if (value.connected
    ? (
      value.projectId === null
      || !value.hasParticipantsApiKey
      || !value.hasQuestionsApiKey
    )
    : (
      value.projectId !== null
      || value.hasParticipantsApiKey
      || value.hasQuestionsApiKey
      || value.lastSuccessfulSyncAt !== null
      || value.lastSuccessfulSyncParticipantCount !== null
    )) {
    throw new Error("Scoutnet-anslutningen gav ett ogiltigt svar.");
  }
  if (
    (value.lastSuccessfulSyncAt === null)
      !== (value.lastSuccessfulSyncParticipantCount === null)
  ) {
    throw new Error("Scoutnet-anslutningen gav ett ogiltigt svar.");
  }
  return {
    campId: value.campId,
    connected: value.connected,
    projectId: value.projectId,
    hasParticipantsApiKey: value.hasParticipantsApiKey,
    hasQuestionsApiKey: value.hasQuestionsApiKey,
    questionMapping,
    connectedAt: value.connectedAt,
    credentialsRotatedAt: value.credentialsRotatedAt,
    questionMappingUpdatedAt: value.questionMappingUpdatedAt,
    lastSuccessfulSyncAt: value.lastSuccessfulSyncAt,
    lastSuccessfulSyncParticipantCount:
      value.lastSuccessfulSyncParticipantCount
  };
}

export function parseScoutnetQuestionCatalogue(
  value: unknown
): ScoutnetQuestionCatalogueResponse {
  if (
    !isRecord(value)
    || !isUuid(value.campId)
    || !Array.isArray(value.questions)
    || value.questions.length > 500
    || !Array.isArray(value.suggestions)
    || value.suggestions.length > 3_500
    || typeof value.mappingValid !== "boolean"
    || !isTimestampOrNull(value.mappingUpdatedAt)
  ) {
    throw new Error("Scoutnet gav en ogiltig frågelista.");
  }
  return {
    campId: value.campId,
    questions: value.questions.map(parseQuestion),
    suggestions: value.suggestions.map(parseSuggestion),
    currentMapping: parseQuestionMapping(value.currentMapping),
    mappingValid: value.mappingValid,
    mappingUpdatedAt: value.mappingUpdatedAt
  };
}

const reconciliationCategories: ScoutnetReconciliationCategory[] = [
  "new",
  "changed",
  "unchanged",
  "reactivated",
  "withdrawn",
  "possible_duplicate"
];
const reconciliationActions: ScoutnetReconciliationAction[] = [
  "create",
  "update",
  "reactivate",
  "withdraw",
  "review",
  "none"
];
const registrationStatuses: ScoutnetRegistrationStatus[] = [
  "confirmed",
  "unconfirmed",
  "cancelled"
];
const attendanceWarnings: ScoutnetAttendanceWarning[] = [
  "attendance_mapping_missing",
  "attendance_answer_missing",
  "attendance_answer_incomplete",
  "attendance_answer_invalid",
  "attendance_no_days_selected"
];
const reconciliationChangeFields: ScoutnetReconciliationChangeField[] = [
  "display_name",
  "registration_status",
  "division",
  "patrol",
  "attendance",
  "special_diet",
  "lifecycle_status"
];

function includesValue<T extends string>(
  values: readonly T[],
  value: unknown
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function parseReconciliationChange(
  value: unknown
): ScoutnetReconciliationChange {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["field", "previous", "next", "destructive"])
    || !includesValue(reconciliationChangeFields, value.field)
    || !isBoundedTextOrNull(value.previous)
    || !isBoundedTextOrNull(value.next)
    || typeof value.destructive !== "boolean"
  ) {
    throw new Error("Scoutnet gav en ogiltig deltagardiff.");
  }
  return {
    field: value.field,
    previous: value.previous,
    next: value.next,
    destructive: value.destructive
  };
}

function parseDuplicateCandidate(value: unknown): ScoutnetDuplicateCandidate {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "participantId",
      "displayName",
      "sourceKind",
      "lifecycleStatus"
    ])
    || !isUuid(value.participantId)
    || typeof value.displayName !== "string"
    || value.displayName.length === 0
    || value.displayName.length > 2_000
    || !includesValue(["manual", "import", "legacy"] as const, value.sourceKind)
    || !includesValue(["active", "withdrawn"] as const, value.lifecycleStatus)
  ) {
    throw new Error("Scoutnet gav en ogiltig dubblettkandidat.");
  }
  return {
    participantId: value.participantId,
    displayName: value.displayName,
    sourceKind: value.sourceKind,
    lifecycleStatus: value.lifecycleStatus
  };
}

function validCategoryAction(
  category: ScoutnetReconciliationCategory,
  action: ScoutnetReconciliationAction
): boolean {
  return (
    (category === "new" && action === "create")
    || (category === "changed" && action === "update")
    || (category === "unchanged" && action === "none")
    || (category === "reactivated" && action === "reactivate")
    || (
      category === "withdrawn"
      && (action === "withdraw" || action === "none")
    )
    || (category === "possible_duplicate" && action === "review")
  );
}

function parseReconciliationRow(value: unknown): ScoutnetReconciliationRow {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "sourceReference",
      "displayName",
      "category",
      "proposedAction",
      "existingParticipantId",
      "registrationStatus",
      "attendanceWarnings",
      "duplicateCandidates",
      "changes",
      "specialDietChange"
    ])
    || !isSourceReference(value.sourceReference)
    || typeof value.displayName !== "string"
    || value.displayName.length === 0
    || value.displayName.length > 2_000
    || !includesValue(reconciliationCategories, value.category)
    || !includesValue(reconciliationActions, value.proposedAction)
    || !validCategoryAction(value.category, value.proposedAction)
    || !(value.existingParticipantId === null
      || isUuid(value.existingParticipantId))
    || !(value.registrationStatus === null
      || includesValue(registrationStatuses, value.registrationStatus))
    || !Array.isArray(value.attendanceWarnings)
    || value.attendanceWarnings.length > attendanceWarnings.length
    || !value.attendanceWarnings.every((warning) =>
      includesValue(attendanceWarnings, warning)
    )
    || new Set(value.attendanceWarnings).size
      !== value.attendanceWarnings.length
    || !Array.isArray(value.duplicateCandidates)
    || value.duplicateCandidates.length > 5_000
    || !Array.isArray(value.changes)
    || value.changes.length > reconciliationChangeFields.length
    || !(value.specialDietChange === null
      || includesValue(["added", "changed", "cleared"] as const,
        value.specialDietChange))
  ) {
    throw new Error("Scoutnet gav en ogiltig deltagardiff.");
  }

  const duplicateCandidates = value.duplicateCandidates.map(
    parseDuplicateCandidate
  );
  const changes = value.changes.map(parseReconciliationChange);
  if (
    value.category === "possible_duplicate"
      !== (duplicateCandidates.length > 0)
    || new Set(
      duplicateCandidates.map((candidate) => candidate.participantId)
    ).size !== duplicateCandidates.length
    || new Set(changes.map((change) => change.field)).size !== changes.length
  ) {
    throw new Error("Scoutnet gav en ogiltig deltagardiff.");
  }

  return {
    sourceReference: value.sourceReference,
    displayName: value.displayName,
    category: value.category,
    proposedAction: value.proposedAction,
    existingParticipantId: value.existingParticipantId,
    registrationStatus: value.registrationStatus,
    attendanceWarnings: [...value.attendanceWarnings],
    duplicateCandidates,
    changes,
    specialDietChange: value.specialDietChange
  };
}

function parseReconciliationCounts(
  value: unknown
): Record<ScoutnetReconciliationCategory, number> {
  if (
    !isRecord(value)
    || !hasExactKeys(value, reconciliationCategories)
    || reconciliationCategories.some((category) =>
      !isBoundedInteger(value[category])
    )
  ) {
    throw new Error("Scoutnet gav en ogiltig sammanfattning.");
  }
  return Object.fromEntries(
    reconciliationCategories.map((category) => [category, value[category]])
  ) as Record<ScoutnetReconciliationCategory, number>;
}

export function parseScoutnetReconciliationPreview(
  value: unknown
): ScoutnetReconciliationPreview {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "campId",
      "snapshotSource",
      "previewDigest",
      "complete",
      "snapshotParticipantCount",
      "stateDigest",
      "rows",
      "counts"
    ])
    || !isUuid(value.campId)
    || value.snapshotSource !== "local_fixture"
    || !isDigest(value.previewDigest)
    || value.complete !== true
    || !isBoundedInteger(value.snapshotParticipantCount, 1)
    || !isDigest(value.stateDigest)
    || !Array.isArray(value.rows)
    || value.rows.length < 1
    || value.rows.length > 5_000
  ) {
    throw new Error("Scoutnet gav en ogiltig förhandsgranskning.");
  }

  const rows = value.rows.map(parseReconciliationRow);
  const counts = parseReconciliationCounts(value.counts);
  const actualCounts = Object.fromEntries(
    reconciliationCategories.map((category) => [
      category,
      rows.filter((row) => row.category === category).length
    ])
  ) as Record<ScoutnetReconciliationCategory, number>;
  if (
    new Set(rows.map((row) => row.sourceReference)).size !== rows.length
    || reconciliationCategories.some((category) =>
      counts[category] !== actualCounts[category]
    )
  ) {
    throw new Error("Scoutnet gav en ogiltig förhandsgranskning.");
  }

  return {
    campId: value.campId,
    snapshotSource: value.snapshotSource,
    previewDigest: value.previewDigest,
    complete: true,
    snapshotParticipantCount: value.snapshotParticipantCount,
    stateDigest: value.stateDigest,
    rows,
    counts
  };
}

export function parseScoutnetReconciliationApplyResult(
  value: unknown
): ScoutnetReconciliationApplyResult {
  const countKeys = [
    "created",
    "linked",
    "updated",
    "reactivated",
    "withdrawn",
    "skipped"
  ] as const;
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "campId",
      "stateDigest",
      "appliedAt",
      "snapshotParticipantCount",
      "counts"
    ])
    || !isUuid(value.campId)
    || !isDigest(value.stateDigest)
    || !isTimestampOrNull(value.appliedAt)
    || value.appliedAt === null
    || !isBoundedInteger(value.snapshotParticipantCount, 1)
  ) {
    throw new Error("Scoutnet gav ett ogiltigt synkresultat.");
  }
  const counts = value.counts;
  if (
    !isRecord(counts)
    || !hasExactKeys(counts, countKeys)
    || countKeys.some((key) => !isBoundedInteger(counts[key]))
  ) {
    throw new Error("Scoutnet gav ett ogiltigt synkresultat.");
  }
  return {
    campId: value.campId,
    stateDigest: value.stateDigest,
    appliedAt: value.appliedAt,
    snapshotParticipantCount: value.snapshotParticipantCount,
    counts: {
      created: counts.created as number,
      linked: counts.linked as number,
      updated: counts.updated as number,
      reactivated: counts.reactivated as number,
      withdrawn: counts.withdrawn as number,
      skipped: counts.skipped as number
    }
  };
}

async function functionErrorMessage(
  error: unknown,
  fallback: string
): Promise<string> {
  if (!isRecord(error) || !(error.context instanceof Response)) return fallback;
  try {
    const body = await error.context.clone().json() as unknown;
    const code = isRecord(body)
      && isRecord(body.error)
      && typeof body.error.code === "string"
      ? body.error.code
      : null;
    if (code === "aal2_required") {
      return "Tvåfaktorsautentisering krävs för att ändra Scoutnet-anslutningen.";
    }
    if (code === "forbidden") {
      return "Endast en organisationsadministratör får hantera Scoutnet.";
    }
    if (code === "question_mapping_required") {
      return "Kontrollera att närvaro och minst en specialkostfråga är mappade.";
    }
    if (code === "scoutnet_rate_limited") {
      return "Scoutnet begränsar anrop just nu. Försök igen senare.";
    }
    if (code === "reconciliation_stale") {
      return "Deltagarna har ändrats sedan förhandsgranskningen. Hämta underlaget igen.";
    }
    if (code === "credentials_rejected") {
      return "Scoutnet avvisade projekt-id eller någon av nycklarna.";
    }
    if (code === "scoutnet_response_invalid") {
      return "Scoutnet-underlaget var tomt, ofullständigt eller ogiltigt. Inget ändrades.";
    }
    if (code === "scoutnet_unavailable") {
      return "Scoutnet kunde inte nås just nu. Inget ändrades.";
    }
  } catch {
    return fallback;
  }
  return fallback;
}

async function invokeScoutnet(
  client: SupabaseClient<Database>,
  body: Record<string, unknown>,
  fallback: string
): Promise<unknown> {
  const { data, error } = await client.functions.invoke(
    "scoutnet-connection",
    { body }
  );
  if (error) throw new Error(await functionErrorMessage(error, fallback));
  return data;
}

export async function readScoutnetConnectionStatus(
  client: SupabaseClient<Database>,
  campId: string
): Promise<ScoutnetConnectionStatus> {
  return parseScoutnetConnectionStatus(await invokeScoutnet(
    client,
    { action: "status", campId },
    "Scoutnet-anslutningen kunde inte läsas."
  ));
}

export async function readScoutnetQuestionCatalogue(
  client: SupabaseClient<Database>,
  campId: string
): Promise<ScoutnetQuestionCatalogueResponse> {
  return parseScoutnetQuestionCatalogue(await invokeScoutnet(
    client,
    { action: "question-catalogue", campId },
    "Scoutnets frågelista kunde inte hämtas."
  ));
}

export async function saveScoutnetQuestionMapping(
  client: SupabaseClient<Database>,
  campId: string,
  questionMapping: ScoutnetQuestionMapping
): Promise<ScoutnetConnectionStatus> {
  return parseScoutnetConnectionStatus(await invokeScoutnet(
    client,
    { action: "update-question-mapping", campId, questionMapping },
    "Scoutnet-mappningen kunde inte sparas."
  ));
}

export async function readScoutnetReconciliationPreview(
  client: SupabaseClient<Database>,
  campId: string
): Promise<ScoutnetReconciliationPreview> {
  return parseScoutnetReconciliationPreview(await invokeScoutnet(
    client,
    { action: "reconciliation-preview", campId },
    "Scoutnet-underlaget kunde inte förhandsgranskas."
  ));
}

export async function applyScoutnetReconciliation(
  client: SupabaseClient<Database>,
  preview: ScoutnetReconciliationPreview,
  decisions: ScoutnetReconciliationDecision[],
  idempotencyKey: string
): Promise<ScoutnetReconciliationApplyResult> {
  return parseScoutnetReconciliationApplyResult(await invokeScoutnet(
    client,
    {
      action: "reconciliation-apply",
      campId: preview.campId,
      stateDigest: preview.stateDigest,
      previewDigest: preview.previewDigest,
      idempotencyKey,
      decisions
    },
    "Scoutnet-avstämningen kunde inte tillämpas."
  ));
}
