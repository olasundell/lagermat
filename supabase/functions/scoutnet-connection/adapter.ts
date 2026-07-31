import { createAuthorizationHeader } from "@scouterna/scoutnet";

const MAX_QUESTIONS = 500;
const MAX_PARTICIPANTS = 5_000;
const MAX_CHOICES_PER_QUESTION = 500;
const MAX_TEXT_LENGTH = 2_000;
const MIN_SOURCE_REFERENCE_SECRET_BYTES = 32;

export const SCOUTNET_PROJECT_API_BASE_URL = "https://scoutnet.se/api";
export const SCOUTNET_PROJECT_PARTICIPANTS_PATH =
  "/project/get/participants";
export const SCOUTNET_PROJECT_QUESTIONS_PATH = "/project/get/questions";

export type ScoutnetProjectEndpoint = "participants" | "questions";

export interface ScoutnetAttendanceQuestionMapping {
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
  /**
   * Kept for backwards compatibility with the secure-connection foundation.
   * New mappings use special_diet_question_ids.
   */
  special_diet_question_id?: string;
  special_diet_question_ids?: string[];
  attendance_intervals?: ScoutnetAttendanceQuestionMapping[];
  attendance_days?: ScoutnetAttendanceDayMapping[];
}

export type ScoutnetQuestionRole =
  | "group"
  | "division"
  | "patrol"
  | "attendance_start"
  | "attendance_end"
  | "attendance_day"
  | "special_diet";

export interface ScoutnetQuestionChoice {
  id: string;
  label: string;
}

export interface ScoutnetQuestionDescriptor {
  id: string;
  label: string;
  description: string | null;
  type: string | null;
  choices: ScoutnetQuestionChoice[];
}

export interface ScoutnetQuestionSuggestion {
  questionId: string;
  role: ScoutnetQuestionRole;
  score: number;
  reason: string;
  suggestedDate?: string;
}

export interface ScoutnetQuestionCatalogue {
  questions: ScoutnetQuestionDescriptor[];
  suggestions: ScoutnetQuestionSuggestion[];
}

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

export interface ScoutnetAttendanceRange {
  startsAt: string;
  endsAt: string;
}

export interface ScoutnetParticipantPreview {
  sourceReference: string;
  displayName: string;
  registrationStatus: ScoutnetRegistrationStatus;
  group: { reference: string | null; name: string | null };
  division: { reference: string | null; name: string | null };
  patrol: { reference: string | null; name: string | null };
  attendance: ScoutnetAttendanceRange[];
  attendanceWarnings: ScoutnetAttendanceWarning[];
  specialDiet: string[];
}

export interface ScoutnetParticipantSnapshot {
  complete: true;
  participantCount: number;
  participants: ScoutnetParticipantPreview[];
}

export interface ScoutnetProjectAdapterContext {
  organizationId: string;
  projectId: string;
  startsOn: string;
  endsOn: string;
  timezone: string;
  questionMapping: ScoutnetQuestionMapping;
  sourceReferenceSecret: string;
}

export interface ScoutnetProjectFetchInput {
  projectId: string;
  endpoint: ScoutnetProjectEndpoint;
  apiKey: string;
}

export interface ScoutnetProjectFetcherOptions {
  fetch?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export type ScoutnetProjectFetchErrorKind =
  | "rejected"
  | "rate_limited"
  | "unavailable"
  | "invalid_response";

export class ScoutnetProjectFetchError extends Error {
  readonly kind: ScoutnetProjectFetchErrorKind;
  readonly retryAfterSeconds: number | null;

  constructor(
    kind: ScoutnetProjectFetchErrorKind,
    retryAfterSeconds: number | null = null,
  ) {
    super(`Scoutnet project request failed: ${kind}`);
    this.name = "ScoutnetProjectFetchError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ScoutnetProjectAdapterError extends Error {
  readonly code:
    | "invalid_questions"
    | "invalid_participants"
    | "invalid_mapping"
    | "invalid_context";

  constructor(
    code: ScoutnetProjectAdapterError["code"],
    message: string,
  ) {
    super(message);
    this.name = "ScoutnetProjectAdapterError";
    this.code = code;
  }
}

interface ParsedQuestion extends ScoutnetQuestionDescriptor {
  choiceLabels: Map<string, string>;
}

interface ParsedMembership {
  groupId: string | null;
  groupName: string | null;
  divisionId: string | null;
  divisionName: string | null;
  patrolId: string | null;
  patrolName: string | null;
}

interface ParsedParticipant {
  memberNumber: string;
  displayName: string;
  registrationStatus: ScoutnetRegistrationStatus;
  membership: ParsedMembership;
  answers: Record<string, string | null>;
}

interface ParticipantWithMappedValues extends ParsedParticipant {
  groupName: string | null;
  divisionName: string | null;
  patrolName: string | null;
  groupIdentity: string | null;
  divisionIdentity: string | null;
  patrolIdentity: string | null;
  attendance: ScoutnetAttendanceRange[];
  attendanceWarnings: ScoutnetAttendanceWarning[];
  specialDiet: string[];
}

interface AttendanceDateRange {
  startsOn: string;
  endsOn: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isQuestionId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{1,20}$/.test(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime())
    && date.toISOString().slice(0, 10) === value;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === required.length
    && required.every((key) => Object.hasOwn(value, key));
}

function encodedSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function hasDisallowedControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      (code >= 0x00 && code <= 0x08)
      || code === 0x0b
      || code === 0x0c
      || (code >= 0x0e && code <= 0x1f)
    ) {
      return true;
    }
  }
  return false;
}

export function isScoutnetQuestionMapping(
  value: unknown,
): value is ScoutnetQuestionMapping {
  if (!isRecord(value) || encodedSize(value) > 16_384) return false;

  const scalarKeys = [
    "group_question_id",
    "division_question_id",
    "patrol_question_id",
    "special_diet_question_id",
  ] as const;
  const allowedKeys = new Set([
    ...scalarKeys,
    "special_diet_question_ids",
    "attendance_intervals",
    "attendance_days",
  ]);
  if (!Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (
    scalarKeys.some((key) =>
      Object.hasOwn(value, key) && !isQuestionId(value[key])
    )
  ) {
    return false;
  }

  if (
    Object.hasOwn(value, "special_diet_question_ids")
    && (
      !Array.isArray(value.special_diet_question_ids)
      || value.special_diet_question_ids.length === 0
      || value.special_diet_question_ids.length > 8
      || !value.special_diet_question_ids.every(isQuestionId)
      || new Set(value.special_diet_question_ids).size
        !== value.special_diet_question_ids.length
    )
  ) {
    return false;
  }
  if (
    Object.hasOwn(value, "special_diet_question_id")
    && Object.hasOwn(value, "special_diet_question_ids")
  ) {
    return false;
  }

  if (
    Object.hasOwn(value, "attendance_intervals")
    && (
      !Array.isArray(value.attendance_intervals)
      || value.attendance_intervals.length === 0
      || value.attendance_intervals.length > 8
      || !value.attendance_intervals.every((interval) =>
        isRecord(interval)
        && exactKeys(
          interval,
          ["starts_at_question_id", "ends_at_question_id"],
        )
        && isQuestionId(interval.starts_at_question_id)
        && isQuestionId(interval.ends_at_question_id)
        && interval.starts_at_question_id !== interval.ends_at_question_id
      )
    )
  ) {
    return false;
  }

  if (
    Object.hasOwn(value, "attendance_days")
    && (
      !Array.isArray(value.attendance_days)
      || value.attendance_days.length === 0
      || value.attendance_days.length > 62
      || !value.attendance_days.every((day) =>
        isRecord(day)
        && exactKeys(day, ["question_id", "date"])
        && isQuestionId(day.question_id)
        && isIsoDate(day.date)
      )
      || new Set(
        value.attendance_days.map((day) => day.question_id),
      ).size !== value.attendance_days.length
      || new Set(
        value.attendance_days.map((day) => day.date),
      ).size !== value.attendance_days.length
    )
  ) {
    return false;
  }

  if (
    Object.hasOwn(value, "attendance_intervals")
    && Object.hasOwn(value, "attendance_days")
  ) {
    return false;
  }

  const mapping = value as ScoutnetQuestionMapping;
  const allQuestionIds = [
    ...scalarKeys
      .filter((key) => key !== "special_diet_question_id")
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => value[key] as string),
    ...(mapping.special_diet_question_ids ?? []),
    ...(mapping.attendance_intervals ?? []).flatMap((interval) => [
      interval.starts_at_question_id,
      interval.ends_at_question_id,
    ]),
    ...(mapping.attendance_days ?? []).map((day) => day.question_id),
  ];
  return new Set(allQuestionIds).size === allQuestionIds.length;
}

export function isCompleteScoutnetQuestionMapping(
  value: unknown,
): value is ScoutnetQuestionMapping {
  if (!isScoutnetQuestionMapping(value)) return false;
  const dietQuestionIds = scoutnetSpecialDietQuestionIds(value);
  const hasAttendance = Boolean(
    value.attendance_intervals?.length || value.attendance_days?.length,
  );
  return dietQuestionIds.length > 0 && hasAttendance;
}

export function scoutnetSpecialDietQuestionIds(
  mapping: ScoutnetQuestionMapping,
): string[] {
  if (mapping.special_diet_question_ids) {
    return [...mapping.special_diet_question_ids];
  }
  return mapping.special_diet_question_id
    ? [mapping.special_diet_question_id]
    : [];
}

function normaliseMap(
  value: unknown,
  code: ScoutnetProjectAdapterError["code"],
  field: string,
): Record<string, unknown> {
  if (value === null) return {};
  if (Array.isArray(value)) {
    if (value.length === 0) return {};
    throw new ScoutnetProjectAdapterError(
      code,
      `${field} must not be a populated array`,
    );
  }
  if (!isRecord(value)) {
    throw new ScoutnetProjectAdapterError(
      code,
      `${field} must be an object, empty array or null`,
    );
  }
  return value;
}

function requiredMap(
  body: unknown,
  field: string,
  code: ScoutnetProjectAdapterError["code"],
): Record<string, unknown> {
  if (!isRecord(body) || !Object.hasOwn(body, field)) {
    throw new ScoutnetProjectAdapterError(
      code,
      `Scoutnet response is missing ${field}`,
    );
  }
  return normaliseMap(body[field], code, field);
}

function boundedNullableString(
  value: unknown,
  field: string,
  code: ScoutnetProjectAdapterError["code"],
): string | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "string"
    || value.length > MAX_TEXT_LENGTH
    || hasDisallowedControlCharacter(value)
  ) {
    throw new ScoutnetProjectAdapterError(code, `${field} is invalid`);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function optionalBoolean(
  value: unknown,
  field: string,
): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") {
    throw new ScoutnetProjectAdapterError(
      "invalid_participants",
      `${field} must be boolean or null`,
    );
  }
  return value;
}

function optionalIdentifier(
  value: unknown,
  field: string,
): string | null {
  if (value === null || value === undefined) return null;
  if (
    (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    && (typeof value !== "string" || !/^[0-9]{1,32}$/.test(value))
  ) {
    throw new ScoutnetProjectAdapterError(
      "invalid_participants",
      `${field} is not a numeric identifier`,
    );
  }
  return String(value);
}

function parseQuestionChoices(
  value: unknown,
  questionId: string,
): {
  choices: ScoutnetQuestionChoice[];
  labels: Map<string, string>;
} {
  const source = normaliseMap(
    value ?? null,
    "invalid_questions",
    `questions.${questionId}.choices`,
  );
  const entries = Object.entries(source);
  if (entries.length > MAX_CHOICES_PER_QUESTION) {
    throw new ScoutnetProjectAdapterError(
      "invalid_questions",
      `questions.${questionId}.choices is too large`,
    );
  }

  const choices = entries.map(([choiceId, rawChoice]) => {
    if (!/^[0-9]{1,32}$/.test(choiceId) || !isRecord(rawChoice)) {
      throw new ScoutnetProjectAdapterError(
        "invalid_questions",
        `questions.${questionId}.choices contains an invalid record`,
      );
    }
    const label = boundedNullableString(
      rawChoice.option,
      `questions.${questionId}.choices.${choiceId}.option`,
      "invalid_questions",
    );
    if (!label) {
      throw new ScoutnetProjectAdapterError(
        "invalid_questions",
        `questions.${questionId}.choices.${choiceId} has no label`,
      );
    }
    return { id: choiceId, label };
  }).sort((left, right) =>
    left.label.localeCompare(right.label, "sv", { numeric: true })
  );
  return {
    choices,
    labels: new Map(choices.map((choice) => [choice.id, choice.label])),
  };
}

function parseQuestions(raw: unknown): ParsedQuestion[] {
  const source = requiredMap(raw, "questions", "invalid_questions");
  const entries = Object.entries(source);
  if (entries.length > MAX_QUESTIONS) {
    throw new ScoutnetProjectAdapterError(
      "invalid_questions",
      "Scoutnet returned too many questions",
    );
  }

  return entries.map(([questionId, rawQuestion]) => {
    if (!isQuestionId(questionId) || !isRecord(rawQuestion)) {
      throw new ScoutnetProjectAdapterError(
        "invalid_questions",
        "Scoutnet returned an invalid question record",
      );
    }
    const label = boundedNullableString(
      rawQuestion.question,
      `questions.${questionId}.question`,
      "invalid_questions",
    );
    if (!label) {
      throw new ScoutnetProjectAdapterError(
        "invalid_questions",
        `questions.${questionId} has no label`,
      );
    }
    const description = boundedNullableString(
      rawQuestion.description,
      `questions.${questionId}.description`,
      "invalid_questions",
    );
    const type = boundedNullableString(
      rawQuestion.type,
      `questions.${questionId}.type`,
      "invalid_questions",
    );
    const { choices, labels } = parseQuestionChoices(
      rawQuestion.choices,
      questionId,
    );
    return {
      id: questionId,
      label,
      description,
      type,
      choices,
      choiceLabels: labels,
    };
  }).sort((left, right) =>
    left.label.localeCompare(right.label, "sv", { numeric: true })
      || left.id.localeCompare(right.id, "sv", { numeric: true })
  );
}

function normalisedSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("sv-SE")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreSuggestion(
  question: ParsedQuestion,
  role: ScoutnetQuestionRole,
): { score: number; reason: string } | null {
  const text = normalisedSearchText(
    `${question.label} ${question.description ?? ""}`,
  );
  const label = normalisedSearchText(question.label);
  const patterns: Record<
    Exclude<ScoutnetQuestionRole, "attendance_day">,
    RegExp[]
  > = {
    group: [/\bscoutkar\b/, /\bkar\b/, /\bgrupp\b/],
    division: [/\bavdelning\b/, /\btroop\b/],
    patrol: [/\bpatrull\b/],
    attendance_start: [
      /\bankomst\b/,
      /\banlander\b/,
      /\bstarttid\b/,
      /\bfran och med\b/,
    ],
    attendance_end: [
      /\bavresa\b/,
      /\bhemresa\b/,
      /\bsluttid\b/,
      /\btill och med\b/,
    ],
    special_diet: [
      /\bspecialkost\b/,
      /\ballerg/,
      /\bmatpreferens/,
      /\bkostbehov\b/,
    ],
  };
  if (role === "attendance_day") return null;
  const matchIndex = patterns[role].findIndex((pattern) => pattern.test(text));
  if (matchIndex < 0) return null;
  const labelOnly = patterns[role].some((pattern) => pattern.test(label));
  return {
    score: (labelOnly ? 90 : 75) - matchIndex * 5,
    reason: labelOnly
      ? "Frågans etikett innehåller ett tydligt nyckelord."
      : "Frågans beskrivning innehåller ett tydligt nyckelord.",
  };
}

function suggestedDate(
  question: ParsedQuestion,
): string | null {
  const text = `${question.label} ${question.description ?? ""}`;
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text)?.[1];
  if (iso && isIsoDate(iso)) return iso;
  return null;
}

function questionSuggestions(
  questions: ParsedQuestion[],
): ScoutnetQuestionSuggestion[] {
  const suggestions: ScoutnetQuestionSuggestion[] = [];
  const roles: Exclude<ScoutnetQuestionRole, "attendance_day">[] = [
    "group",
    "division",
    "patrol",
    "attendance_start",
    "attendance_end",
    "special_diet",
  ];
  for (const question of questions) {
    for (const role of roles) {
      const scored = scoreSuggestion(question, role);
      if (scored) {
        suggestions.push({
          questionId: question.id,
          role,
          score: scored.score,
          reason: scored.reason,
        });
      }
    }
    const date = suggestedDate(question);
    if (date) {
      suggestions.push({
        questionId: question.id,
        role: "attendance_day",
        score: 95,
        reason: "Frågans etikett eller beskrivning innehåller ett ISO-datum.",
        suggestedDate: date,
      });
    }
  }
  return suggestions.sort((left, right) =>
    right.score - left.score
      || left.role.localeCompare(right.role)
      || left.questionId.localeCompare(right.questionId, "sv", {
        numeric: true,
      })
  );
}

export function buildScoutnetQuestionCatalogue(
  rawQuestions: unknown,
): ScoutnetQuestionCatalogue {
  const parsed = parseQuestions(rawQuestions);
  return {
    questions: parsed.map(publicQuestionDescriptor),
    suggestions: questionSuggestions(parsed),
  };
}

function publicQuestionDescriptor(
  question: ParsedQuestion,
): ScoutnetQuestionDescriptor {
  return {
    id: question.id,
    label: question.label,
    description: question.description,
    type: question.type,
    choices: question.choices,
  };
}

function mappingQuestionIds(mapping: ScoutnetQuestionMapping): string[] {
  return [
    ...[
      mapping.group_question_id,
      mapping.division_question_id,
      mapping.patrol_question_id,
    ].filter((value): value is string => Boolean(value)),
    ...scoutnetSpecialDietQuestionIds(mapping),
    ...(mapping.attendance_intervals ?? []).flatMap((interval) => [
      interval.starts_at_question_id,
      interval.ends_at_question_id,
    ]),
    ...(mapping.attendance_days ?? []).map((day) => day.question_id),
  ];
}

export function validateScoutnetQuestionMappingAgainstCatalogue(
  mapping: unknown,
  catalogue: ScoutnetQuestionCatalogue,
  context?: Pick<ScoutnetProjectAdapterContext, "startsOn" | "endsOn">,
): asserts mapping is ScoutnetQuestionMapping {
  if (!isCompleteScoutnetQuestionMapping(mapping)) {
    throw new ScoutnetProjectAdapterError(
      "invalid_mapping",
      "Question mapping must include special diet and one attendance mode",
    );
  }
  const available = new Set(catalogue.questions.map((question) => question.id));
  if (mappingQuestionIds(mapping).some((id) => !available.has(id))) {
    throw new ScoutnetProjectAdapterError(
      "invalid_mapping",
      "Question mapping references an unavailable question",
    );
  }
  if (
    context
    && mapping.attendance_days?.some((day) =>
      day.date < context.startsOn || day.date > context.endsOn
    )
  ) {
    throw new ScoutnetProjectAdapterError(
      "invalid_mapping",
      "Attendance-day mapping falls outside the camp",
    );
  }
}

function parseMembership(
  value: unknown,
  field: string,
): ParsedMembership {
  const source = normaliseMap(
    value ?? null,
    "invalid_participants",
    field,
  );
  return {
    groupId: optionalIdentifier(
      source.group_id,
      `${field}.group_id`,
    ),
    groupName: boundedNullableString(
      source.group_name,
      `${field}.group_name`,
      "invalid_participants",
    ),
    divisionId: optionalIdentifier(
      source.troop_id,
      `${field}.troop_id`,
    ),
    divisionName: boundedNullableString(
      source.troop_name,
      `${field}.troop_name`,
      "invalid_participants",
    ),
    patrolId: optionalIdentifier(
      source.patrol_id,
      `${field}.patrol_id`,
    ),
    patrolName: boundedNullableString(
      source.patrol_name,
      `${field}.patrol_name`,
      "invalid_participants",
    ),
  };
}

function parseAnswers(
  value: unknown,
  participantKey: string,
): Record<string, string | null> {
  const source = normaliseMap(
    value ?? null,
    "invalid_participants",
    `participants.${participantKey}.questions`,
  );
  const answers: Record<string, string | null> = {};
  for (const [questionId, answer] of Object.entries(source)) {
    if (
      !isQuestionId(questionId)
      || !(
        answer === null
        || (
          typeof answer === "string"
          && answer.length <= MAX_TEXT_LENGTH
          && !hasDisallowedControlCharacter(answer)
        )
      )
    ) {
      throw new ScoutnetProjectAdapterError(
        "invalid_participants",
        `participants.${participantKey}.questions contains invalid data`,
      );
    }
    answers[questionId] = answer;
  }
  return answers;
}

function parseParticipants(raw: unknown): ParsedParticipant[] {
  const source = requiredMap(raw, "participants", "invalid_participants");
  const entries = Object.entries(source);
  if (entries.length > MAX_PARTICIPANTS) {
    throw new ScoutnetProjectAdapterError(
      "invalid_participants",
      "Scoutnet returned more than 5000 participants",
    );
  }

  return entries.map(([participantKey, rawParticipant]) => {
    if (!/^[0-9]{1,32}$/.test(participantKey) || !isRecord(rawParticipant)) {
      throw new ScoutnetProjectAdapterError(
        "invalid_participants",
        "Scoutnet returned an invalid participant record",
      );
    }
    const memberNumber = optionalIdentifier(
      rawParticipant.member_no,
      `participants.${participantKey}.member_no`,
    );
    if (!memberNumber || memberNumber !== participantKey) {
      throw new ScoutnetProjectAdapterError(
        "invalid_participants",
        `participants.${participantKey} has an inconsistent member number`,
      );
    }
    const firstName = boundedNullableString(
      rawParticipant.first_name,
      `participants.${participantKey}.first_name`,
      "invalid_participants",
    );
    const lastName = boundedNullableString(
      rawParticipant.last_name,
      `participants.${participantKey}.last_name`,
      "invalid_participants",
    );
    const displayName = [firstName, lastName].filter(Boolean).join(" ");
    if (!displayName) {
      throw new ScoutnetProjectAdapterError(
        "invalid_participants",
        `participants.${participantKey} has no name`,
      );
    }

    const cancelled = optionalBoolean(
      rawParticipant.cancelled,
      `participants.${participantKey}.cancelled`,
    );
    const confirmed = optionalBoolean(
      rawParticipant.confirmed,
      `participants.${participantKey}.confirmed`,
    );
    const primaryMembership = parseMembership(
      rawParticipant.primary_membership_info,
      `participants.${participantKey}.primary_membership_info`,
    );
    const groupRegistrationMembership = parseMembership(
      rawParticipant.group_registration_info,
      `participants.${participantKey}.group_registration_info`,
    );
    const hasGroupRegistration = Object.values(
      groupRegistrationMembership,
    ).some((value) => value !== null);

    return {
      memberNumber,
      displayName,
      registrationStatus: cancelled
        ? "cancelled"
        : confirmed
          ? "confirmed"
          : "unconfirmed",
      membership: hasGroupRegistration
        ? groupRegistrationMembership
        : primaryMembership,
      answers: parseAnswers(rawParticipant.questions, participantKey),
    };
  });
}

function questionMap(
  questions: ParsedQuestion[],
): Map<string, ParsedQuestion> {
  return new Map(questions.map((question) => [question.id, question]));
}

function mappedAnswer(
  answers: Record<string, string | null>,
  questionId: string | undefined,
  questions: Map<string, ParsedQuestion>,
): string | null {
  if (!questionId) return null;
  const raw = answers[questionId]?.trim();
  if (!raw) return null;
  const question = questions.get(questionId);
  if (!question) return null;
  if (question.choiceLabels.size === 0) return raw;
  const choiceLabel = question.choiceLabels.get(raw);
  if (!choiceLabel) {
    throw new ScoutnetProjectAdapterError(
      "invalid_participants",
      `Mapped question ${questionId} contains an unknown choice`,
    );
  }
  return choiceLabel;
}

function dateInTimezone(value: string, timezone: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(parsed);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    const date = year && month && day ? `${year}-${month}-${day}` : null;
    return date && isIsoDate(date) ? date : null;
  } catch {
    return null;
  }
}

function addIsoDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function zonedDateTimeParts(
  timestamp: number,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} | null {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const result = {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

function startOfDayInTimezone(date: string, timezone: string): string | null {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return null;
  const targetAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = targetAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = zonedDateTimeParts(candidate, timezone);
    if (!observed) return null;
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    candidate += targetAsUtc - observedAsUtc;
  }
  const verified = zonedDateTimeParts(candidate, timezone);
  if (
    !verified
    || verified.year !== year
    || verified.month !== month
    || verified.day !== day
    || verified.hour !== 0
    || verified.minute !== 0
    || verified.second !== 0
  ) {
    return null;
  }
  return new Date(candidate).toISOString();
}

function attendanceForDateRange(
  range: AttendanceDateRange,
  context: Pick<ScoutnetProjectAdapterContext, "timezone">,
): ScoutnetAttendanceRange | null {
  const startsAt = startOfDayInTimezone(range.startsOn, context.timezone);
  const endsAt = startOfDayInTimezone(
    addIsoDays(range.endsOn, 1),
    context.timezone,
  );
  return startsAt && endsAt ? { startsAt, endsAt } : null;
}

function fullCampAttendance(
  context: Pick<
    ScoutnetProjectAdapterContext,
    "startsOn" | "endsOn" | "timezone"
  >,
  warning: ScoutnetAttendanceWarning,
): {
  attendance: ScoutnetAttendanceRange[];
  attendanceWarnings: ScoutnetAttendanceWarning[];
} {
  const interval = attendanceForDateRange({
    startsOn: context.startsOn,
    endsOn: context.endsOn,
  }, context);
  if (!interval) {
    throw new ScoutnetProjectAdapterError(
      "invalid_context",
      "Camp dates cannot be represented in the configured timezone",
    );
  }
  return {
    attendance: [interval],
    attendanceWarnings: [warning],
  };
}

function dateOrdinal(value: string): number {
  return Math.floor(
    Date.parse(`${value}T00:00:00.000Z`) / 86_400_000,
  );
}

function mergeAttendanceRanges(
  ranges: AttendanceDateRange[],
  mergeAdjacent: boolean,
): AttendanceDateRange[] {
  const sorted = [...ranges].sort((left, right) =>
    left.startsOn.localeCompare(right.startsOn)
      || left.endsOn.localeCompare(right.endsOn)
  );
  const merged: AttendanceDateRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (
      previous
      && dateOrdinal(range.startsOn) <= dateOrdinal(previous.endsOn)
        + (mergeAdjacent ? 1 : 0)
    ) {
      if (range.endsOn > previous.endsOn) previous.endsOn = range.endsOn;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function attendanceFromIntervals(
  participant: ParsedParticipant,
  mapping: ScoutnetAttendanceQuestionMapping[],
  context: ScoutnetProjectAdapterContext,
): {
  attendance: ScoutnetAttendanceRange[];
  attendanceWarnings: ScoutnetAttendanceWarning[];
} {
  const ranges: ScoutnetAttendanceRange[] = [];
  for (const interval of mapping) {
    const rawStart = participant.answers[interval.starts_at_question_id];
    const rawEnd = participant.answers[interval.ends_at_question_id];
    const startMissing = rawStart === null || rawStart === undefined
      || rawStart.trim() === "";
    const endMissing = rawEnd === null || rawEnd === undefined
      || rawEnd.trim() === "";
    if (startMissing && endMissing) continue;
    if (startMissing || endMissing) {
      return fullCampAttendance(context, "attendance_answer_incomplete");
    }
    const startsOn = dateInTimezone(rawStart, context.timezone);
    const endsOn = dateInTimezone(rawEnd, context.timezone);
    const startsAtValue = new Date(rawStart);
    const endsAtValue = new Date(rawEnd);
    if (
      !startsOn
      || !endsOn
      || Number.isNaN(startsAtValue.getTime())
      || Number.isNaN(endsAtValue.getTime())
      || startsAtValue >= endsAtValue
      || startsOn > endsOn
      || startsOn < context.startsOn
      || endsOn > context.endsOn
    ) {
      return fullCampAttendance(context, "attendance_answer_invalid");
    }
    ranges.push({
      startsAt: startsAtValue.toISOString(),
      endsAt: endsAtValue.toISOString(),
    });
  }
  if (ranges.length === 0) {
    return fullCampAttendance(context, "attendance_answer_missing");
  }
  ranges.sort((left, right) =>
    left.startsAt.localeCompare(right.startsAt)
      || left.endsAt.localeCompare(right.endsAt)
  );
  if (ranges.some((range, index) =>
    index > 0 && range.startsAt < ranges[index - 1]!.endsAt
  )) {
    return fullCampAttendance(context, "attendance_answer_invalid");
  }
  return { attendance: ranges, attendanceWarnings: [] };
}

function answerMeansSelected(value: string | null): boolean {
  if (value === null) return false;
  const normalised = normalisedSearchText(value);
  return !["", "0", "false", "nej", "no", "off"].includes(normalised);
}

function attendanceFromDays(
  participant: ParsedParticipant,
  mapping: ScoutnetAttendanceDayMapping[],
  context: ScoutnetProjectAdapterContext,
): {
  attendance: ScoutnetAttendanceRange[];
  attendanceWarnings: ScoutnetAttendanceWarning[];
} {
  if (mapping.some((day) => !Object.hasOwn(participant.answers, day.question_id))) {
    return fullCampAttendance(context, "attendance_answer_missing");
  }
  const selectedDates = mapping
    .filter((day) => answerMeansSelected(participant.answers[day.question_id]))
    .map((day) => ({ startsOn: day.date, endsOn: day.date }));
  if (selectedDates.length === 0) {
    return {
      attendance: [],
      attendanceWarnings: ["attendance_no_days_selected"],
    };
  }
  const attendance = mergeAttendanceRanges(selectedDates, true)
    .map((range) => attendanceForDateRange(range, context));
  if (attendance.some((range) => range === null)) {
    throw new ScoutnetProjectAdapterError(
      "invalid_context",
      "Selected attendance days cannot be represented in the camp timezone",
    );
  }
  return {
    attendance: attendance as ScoutnetAttendanceRange[],
    attendanceWarnings: [],
  };
}

function participantAttendance(
  participant: ParsedParticipant,
  context: ScoutnetProjectAdapterContext,
): {
  attendance: ScoutnetAttendanceRange[];
  attendanceWarnings: ScoutnetAttendanceWarning[];
} {
  if (context.questionMapping.attendance_intervals?.length) {
    return attendanceFromIntervals(
      participant,
      context.questionMapping.attendance_intervals,
      context,
    );
  }
  if (context.questionMapping.attendance_days?.length) {
    return attendanceFromDays(
      participant,
      context.questionMapping.attendance_days,
      context,
    );
  }
  return fullCampAttendance(context, "attendance_mapping_missing");
}

function participantSpecialDiet(
  participant: ParsedParticipant,
  context: ScoutnetProjectAdapterContext,
  questions: Map<string, ParsedQuestion>,
): string[] {
  const values = scoutnetSpecialDietQuestionIds(context.questionMapping)
    .map((questionId) =>
      mappedAnswer(participant.answers, questionId, questions)
    )
    .filter((value): value is string => Boolean(value));
  return [...new Set(values)];
}

function mappedParticipant(
  participant: ParsedParticipant,
  context: ScoutnetProjectAdapterContext,
  questions: Map<string, ParsedQuestion>,
): ParticipantWithMappedValues {
  const groupAnswer = mappedAnswer(
    participant.answers,
    context.questionMapping.group_question_id,
    questions,
  );
  const divisionAnswer = mappedAnswer(
    participant.answers,
    context.questionMapping.division_question_id,
    questions,
  );
  const patrolAnswer = mappedAnswer(
    participant.answers,
    context.questionMapping.patrol_question_id,
    questions,
  );
  const attendance = participantAttendance(participant, context);
  return {
    ...participant,
    groupName: groupAnswer ?? participant.membership.groupName,
    divisionName: divisionAnswer ?? participant.membership.divisionName,
    patrolName: patrolAnswer ?? participant.membership.patrolName,
    groupIdentity: groupAnswer
      ? `question:${context.questionMapping.group_question_id}:${groupAnswer}`
      : participant.membership.groupId,
    divisionIdentity: divisionAnswer
      ? `question:${context.questionMapping.division_question_id}:${divisionAnswer}`
      : participant.membership.divisionId,
    patrolIdentity: patrolAnswer
      ? `question:${context.questionMapping.patrol_question_id}:${patrolAnswer}`
      : participant.membership.patrolId,
    ...attendance,
    specialDiet: participantSpecialDiet(participant, context, questions),
  };
}

function validateContext(context: ScoutnetProjectAdapterContext): void {
  if (
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
      context.organizationId,
    )
    || !/^[0-9]{1,32}$/.test(context.projectId)
    || !isIsoDate(context.startsOn)
    || !isIsoDate(context.endsOn)
    || context.startsOn > context.endsOn
    || typeof context.timezone !== "string"
    || context.timezone.length > 100
    || !isScoutnetQuestionMapping(context.questionMapping)
    || new TextEncoder().encode(context.sourceReferenceSecret).byteLength
      < MIN_SOURCE_REFERENCE_SECRET_BYTES
    || new TextEncoder().encode(context.sourceReferenceSecret).byteLength
      > 4_096
  ) {
    throw new ScoutnetProjectAdapterError(
      "invalid_context",
      "Scoutnet adapter context is invalid",
    );
  }
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: context.timezone });
  } catch {
    throw new ScoutnetProjectAdapterError(
      "invalid_context",
      "Camp timezone is invalid",
    );
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sourceReferenceSigner(
  context: ScoutnetProjectAdapterContext,
): Promise<(kind: string, rawId: string) => Promise<string>> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(context.sourceReferenceSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return async (kind, rawId) => {
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(
        `scoutmat-scoutnet-v1|${context.organizationId}|${context.projectId}|${kind}|${rawId}`,
      ),
    );
    return `scoutnet:v1:${base64Url(new Uint8Array(signature))}`;
  };
}

export async function buildScoutnetParticipantSnapshot(
  rawParticipants: unknown,
  rawQuestions: unknown,
  context: ScoutnetProjectAdapterContext,
): Promise<ScoutnetParticipantSnapshot> {
  validateContext(context);
  const questions = parseQuestions(rawQuestions);
  const catalogue: ScoutnetQuestionCatalogue = {
    questions: questions.map(publicQuestionDescriptor),
    suggestions: questionSuggestions(questions),
  };
  validateScoutnetQuestionMappingAgainstCatalogue(
    context.questionMapping,
    catalogue,
    context,
  );

  // Parse and validate every record before signing or returning a single row.
  const participants = parseParticipants(rawParticipants);
  const byId = questionMap(questions);
  const mapped = participants.map((participant) =>
    mappedParticipant(participant, context, byId)
  );
  const sign = await sourceReferenceSigner(context);
  const previews = await Promise.all(mapped.map(async (participant) => ({
    sourceReference: await sign("member", participant.memberNumber),
    displayName: participant.displayName,
    registrationStatus: participant.registrationStatus,
    group: {
      reference: participant.groupIdentity
        ? await sign("group", participant.groupIdentity)
        : null,
      name: participant.groupName,
    },
    division: {
      reference: participant.divisionIdentity
        ? await sign("division", participant.divisionIdentity)
        : null,
      name: participant.divisionName,
    },
    patrol: {
      reference: participant.patrolIdentity
        ? await sign("patrol", participant.patrolIdentity)
        : null,
      name: participant.patrolName,
    },
    attendance: participant.attendance,
    attendanceWarnings: participant.attendanceWarnings,
    specialDiet: participant.specialDiet,
  } satisfies ScoutnetParticipantPreview)));

  return {
    complete: true,
    participantCount: previews.length,
    participants: previews,
  };
}

function endpointPath(endpoint: ScoutnetProjectEndpoint): string {
  return endpoint === "participants"
    ? SCOUTNET_PROJECT_PARTICIPANTS_PATH
    : SCOUTNET_PROJECT_QUESTIONS_PATH;
}

function retryAfterSeconds(value: string | null): number | null {
  if (!value || !/^\d{1,6}$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 86_400
    ? seconds
    : null;
}

async function boundedResponseBody(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  if (!response.body) {
    throw new ScoutnetProjectFetchError("invalid_response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel("Scoutnet response too large");
        throw new ScoutnetProjectFetchError("invalid_response");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ScoutnetProjectFetchError("invalid_response");
  }
}

export function createScoutnetProjectFetcher(
  options: ScoutnetProjectFetcherOptions = {},
): (input: ScoutnetProjectFetchInput) => Promise<unknown> {
  const fetcher = options.fetch ?? fetch;
  const baseUrl = (
    options.baseUrl ?? SCOUTNET_PROJECT_API_BASE_URL
  ).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maximumBytes = options.maxResponseBytes ?? 8_388_608;

  return async (input): Promise<unknown> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(
        `${baseUrl}${endpointPath(input.endpoint)}`,
        {
          method: "GET",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "Accept": "application/json",
            "Authorization": createAuthorizationHeader({
              resourceId: input.projectId,
              key: input.apiKey,
            }),
          },
        },
      );
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel().catch(() => undefined);
        throw new ScoutnetProjectFetchError("rejected");
      }
      if (response.status === 429) {
        const retryAfter = retryAfterSeconds(
          response.headers.get("Retry-After"),
        );
        await response.body?.cancel().catch(() => undefined);
        throw new ScoutnetProjectFetchError("rate_limited", retryAfter);
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        throw new ScoutnetProjectFetchError("unavailable");
      }
      const contentType = response.headers.get("Content-Type") ?? "";
      if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        throw new ScoutnetProjectFetchError("invalid_response");
      }
      const rawBody = await boundedResponseBody(response, maximumBytes);
      if (!rawBody.trim()) {
        throw new ScoutnetProjectFetchError("invalid_response");
      }
      try {
        return JSON.parse(rawBody) as unknown;
      } catch {
        throw new ScoutnetProjectFetchError("invalid_response");
      }
    } catch (error) {
      if (error instanceof ScoutnetProjectFetchError) throw error;
      throw new ScoutnetProjectFetchError("unavailable");
    } finally {
      clearTimeout(timeout);
    }
  };
}
