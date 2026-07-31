import type {
  ScoutnetQuestionCatalogueResponse,
  ScoutnetQuestionMapping,
  ScoutnetQuestionRole
} from "./scoutnetApi";

export interface ScoutnetIntervalDraft {
  startsAtQuestionId: string;
  endsAtQuestionId: string;
}

export interface ScoutnetDayDraft {
  questionId: string;
  date: string;
}

export interface ScoutnetQuestionMappingDraft {
  groupQuestionId: string;
  divisionQuestionId: string;
  patrolQuestionId: string;
  specialDietQuestionIds: string[];
  attendanceMode: "intervals" | "days";
  intervals: ScoutnetIntervalDraft[];
  days: ScoutnetDayDraft[];
  usesSuggestions: boolean;
}

export type ScoutnetMappingDraftResult =
  | { valid: true; mapping: ScoutnetQuestionMapping }
  | { valid: false; message: string };

function suggestedQuestionIds(
  catalogue: ScoutnetQuestionCatalogueResponse,
  role: ScoutnetQuestionRole
): string[] {
  return catalogue.suggestions
    .filter((suggestion) => suggestion.role === role)
    .sort((left, right) =>
      right.score - left.score
      || left.questionId.localeCompare(right.questionId, "sv", {
        numeric: true
      })
    )
    .map((suggestion) => suggestion.questionId)
    .filter((questionId, index, values) =>
      values.indexOf(questionId) === index
    );
}

function firstSuggestion(
  catalogue: ScoutnetQuestionCatalogueResponse,
  role: ScoutnetQuestionRole
): string {
  return suggestedQuestionIds(catalogue, role)[0] ?? "";
}

export function createScoutnetQuestionMappingDraft(
  catalogue: ScoutnetQuestionCatalogueResponse
): ScoutnetQuestionMappingDraft {
  const mapping = catalogue.currentMapping;
  const suggestedStarts = suggestedQuestionIds(
    catalogue,
    "attendance_start"
  );
  const suggestedEnds = suggestedQuestionIds(catalogue, "attendance_end");
  const suggestedDays = catalogue.suggestions
    .filter((suggestion) =>
      suggestion.role === "attendance_day" && suggestion.suggestedDate
    )
    .sort((left, right) =>
      String(left.suggestedDate).localeCompare(String(right.suggestedDate))
      || left.questionId.localeCompare(right.questionId, "sv", {
        numeric: true
      })
    )
    .map((suggestion) => ({
      questionId: suggestion.questionId,
      date: suggestion.suggestedDate ?? ""
    }));
  const currentSpecialDiet = [
    ...(mapping.special_diet_question_ids ?? []),
    ...(mapping.special_diet_question_id
      ? [mapping.special_diet_question_id]
      : [])
  ].filter((questionId, index, values) =>
    values.indexOf(questionId) === index
  );
  const hasSavedMapping = Object.keys(mapping).length > 0;

  return {
    groupQuestionId: mapping.group_question_id
      ?? firstSuggestion(catalogue, "group"),
    divisionQuestionId: mapping.division_question_id
      ?? firstSuggestion(catalogue, "division"),
    patrolQuestionId: mapping.patrol_question_id
      ?? firstSuggestion(catalogue, "patrol"),
    specialDietQuestionIds: currentSpecialDiet.length > 0
      ? currentSpecialDiet
      : suggestedQuestionIds(catalogue, "special_diet"),
    attendanceMode: mapping.attendance_days?.length
      ? "days"
      : mapping.attendance_intervals?.length
        ? "intervals"
        : suggestedDays.length > 0
          ? "days"
          : "intervals",
    intervals: mapping.attendance_intervals?.map((interval) => ({
      startsAtQuestionId: interval.starts_at_question_id,
      endsAtQuestionId: interval.ends_at_question_id
    })) ?? Array.from(
      { length: Math.max(suggestedStarts.length, suggestedEnds.length, 1) },
      (_unused, index) => ({
        startsAtQuestionId: suggestedStarts[index] ?? "",
        endsAtQuestionId: suggestedEnds[index] ?? ""
      })
    ),
    days: mapping.attendance_days?.map((day) => ({
      questionId: day.question_id,
      date: day.date
    })) ?? (suggestedDays.length > 0
      ? suggestedDays
      : [{ questionId: "", date: "" }]),
    usesSuggestions: !hasSavedMapping
  };
}

export function mappingFromScoutnetDraft(
  draft: ScoutnetQuestionMappingDraft,
  catalogue: ScoutnetQuestionCatalogueResponse,
  startsOn: string,
  endsOn: string
): ScoutnetMappingDraftResult {
  const available = new Set(
    catalogue.questions.map((question) => question.id)
  );
  const optionalIds = [
    draft.groupQuestionId,
    draft.divisionQuestionId,
    draft.patrolQuestionId
  ].filter(Boolean);
  const specialDietIds = draft.specialDietQuestionIds.filter(Boolean);

  if (specialDietIds.length === 0) {
    return {
      valid: false,
      message: "Välj minst en fråga för specialkost."
    };
  }

  const attendanceIds: string[] = [];
  let attendanceMapping: Pick<
    ScoutnetQuestionMapping,
    "attendance_intervals" | "attendance_days"
  >;
  if (draft.attendanceMode === "intervals") {
    const intervals = draft.intervals.filter((interval) =>
      interval.startsAtQuestionId || interval.endsAtQuestionId
    );
    if (
      intervals.length === 0
      || intervals.some((interval) =>
        !interval.startsAtQuestionId || !interval.endsAtQuestionId
      )
    ) {
      return {
        valid: false,
        message: "Varje närvaroperiod måste ha både ankomst- och avresefråga."
      };
    }
    attendanceIds.push(...intervals.flatMap((interval) => [
      interval.startsAtQuestionId,
      interval.endsAtQuestionId
    ]));
    attendanceMapping = {
      attendance_intervals: intervals.map((interval) => ({
        starts_at_question_id: interval.startsAtQuestionId,
        ends_at_question_id: interval.endsAtQuestionId
      }))
    };
  } else {
    const days = draft.days.filter((day) => day.questionId || day.date);
    if (
      days.length === 0
      || days.some((day) =>
        !day.questionId
        || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)
        || day.date < startsOn
        || day.date > endsOn
      )
    ) {
      return {
        valid: false,
        message: "Varje vald dag måste ha en fråga och ett datum inom lägret."
      };
    }
    attendanceIds.push(...days.map((day) => day.questionId));
    attendanceMapping = {
      attendance_days: days.map((day) => ({
        question_id: day.questionId,
        date: day.date
      }))
    };
  }

  const allIds = [...optionalIds, ...specialDietIds, ...attendanceIds];
  if (allIds.some((questionId) => !available.has(questionId))) {
    return {
      valid: false,
      message: "En vald fråga finns inte längre i Scoutnets frågelista."
    };
  }
  if (new Set(allIds).size !== allIds.length) {
    return {
      valid: false,
      message: "Samma Scoutnet-fråga kan bara användas för ett ändamål."
    };
  }

  return {
    valid: true,
    mapping: {
      ...(draft.groupQuestionId
        ? { group_question_id: draft.groupQuestionId }
        : {}),
      ...(draft.divisionQuestionId
        ? { division_question_id: draft.divisionQuestionId }
        : {}),
      ...(draft.patrolQuestionId
        ? { patrol_question_id: draft.patrolQuestionId }
        : {}),
      special_diet_question_ids: specialDietIds,
      ...attendanceMapping
    }
  };
}
