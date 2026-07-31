import { describe, expect, it } from "vitest";
import type { ScoutnetQuestionCatalogueResponse } from "./scoutnetApi";
import {
  createScoutnetQuestionMappingDraft,
  mappingFromScoutnetDraft
} from "./scoutnetQuestionMappingModel";

const campId = "caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const catalogue: ScoutnetQuestionCatalogueResponse = {
  campId,
  questions: [
    { id: "1101", label: "Ankomst", description: null, type: "datetime", choices: [] },
    { id: "1102", label: "Avresa", description: null, type: "datetime", choices: [] },
    { id: "1201", label: "Specialkost", description: null, type: "textarea", choices: [] },
    { id: "1301", label: "Avdelning", description: null, type: "select", choices: [] }
  ],
  suggestions: [
    { questionId: "1201", role: "special_diet", score: 90, reason: "test" },
    { questionId: "1101", role: "attendance_start", score: 90, reason: "test" },
    { questionId: "1102", role: "attendance_end", score: 90, reason: "test" },
    { questionId: "1301", role: "division", score: 90, reason: "test" }
  ],
  currentMapping: {},
  mappingValid: false,
  mappingUpdatedAt: null
};

describe("Scoutnet question-mapping draft", () => {
  it("turns deterministic suggestions into an explicitly reviewable draft", () => {
    const draft = createScoutnetQuestionMappingDraft(catalogue);

    expect(draft).toMatchObject({
      divisionQuestionId: "1301",
      specialDietQuestionIds: ["1201"],
      attendanceMode: "intervals",
      intervals: [{
        startsAtQuestionId: "1101",
        endsAtQuestionId: "1102"
      }],
      usesSuggestions: true
    });
    expect(mappingFromScoutnetDraft(
      draft,
      catalogue,
      "2026-08-02",
      "2026-08-05"
    )).toEqual({
      valid: true,
      mapping: {
        division_question_id: "1301",
        special_diet_question_ids: ["1201"],
        attendance_intervals: [{
          starts_at_question_id: "1101",
          ends_at_question_id: "1102"
        }]
      }
    });
  });

  it("rejects duplicate roles and incomplete interval pairs", () => {
    const draft = createScoutnetQuestionMappingDraft(catalogue);

    expect(mappingFromScoutnetDraft(
      { ...draft, specialDietQuestionIds: ["1101"] },
      catalogue,
      "2026-08-02",
      "2026-08-05"
    )).toMatchObject({
      valid: false,
      message: expect.stringContaining("bara användas")
    });
    expect(mappingFromScoutnetDraft(
      {
        ...draft,
        intervals: [{
          startsAtQuestionId: "1101",
          endsAtQuestionId: ""
        }]
      },
      catalogue,
      "2026-08-02",
      "2026-08-05"
    )).toMatchObject({
      valid: false,
      message: expect.stringContaining("både ankomst")
    });
  });

  it("preserves non-contiguous selected-day mappings inside the camp", () => {
    const dayCatalogue: ScoutnetQuestionCatalogueResponse = {
      ...catalogue,
      suggestions: [
        ...catalogue.suggestions,
        {
          questionId: "1101",
          role: "attendance_day",
          score: 95,
          reason: "test",
          suggestedDate: "2026-08-02"
        },
        {
          questionId: "1102",
          role: "attendance_day",
          score: 95,
          reason: "test",
          suggestedDate: "2026-08-04"
        }
      ]
    };
    const draft = createScoutnetQuestionMappingDraft(dayCatalogue);

    expect(mappingFromScoutnetDraft(
      {
        ...draft,
        attendanceMode: "days",
        intervals: [],
        specialDietQuestionIds: ["1201"],
        divisionQuestionId: "1301"
      },
      dayCatalogue,
      "2026-08-02",
      "2026-08-05"
    )).toMatchObject({
      valid: true,
      mapping: {
        attendance_days: [
          { question_id: "1101", date: "2026-08-02" },
          { question_id: "1102", date: "2026-08-04" }
        ]
      }
    });
  });
});
