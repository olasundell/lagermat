import { describe, expect, it } from "vitest";
import {
  parseScoutnetConnectionStatus,
  parseScoutnetQuestionCatalogue,
  parseScoutnetReconciliationApplyResult,
  parseScoutnetReconciliationPreview
} from "./scoutnetApi";

const campId = "caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";

describe("Scoutnet browser response boundary", () => {
  it("parses only the public connection status", () => {
    expect(parseScoutnetConnectionStatus({
      campId,
      connected: true,
      projectId: "7701",
      hasParticipantsApiKey: true,
      hasQuestionsApiKey: true,
      questionMapping: {
        special_diet_question_ids: ["1201"],
        attendance_intervals: [{
          starts_at_question_id: "1101",
          ends_at_question_id: "1102"
        }]
      },
      connectedAt: "2026-07-30T20:00:00.000Z",
      credentialsRotatedAt: null,
      questionMappingUpdatedAt: null,
      lastSuccessfulSyncAt: "2026-07-31T08:00:00.000Z",
      lastSuccessfulSyncParticipantCount: 3
    })).toMatchObject({
      campId,
      connected: true,
      projectId: "7701"
    });

    expect(() => parseScoutnetConnectionStatus({
      campId,
      connected: false,
      projectId: "7701",
      hasParticipantsApiKey: false,
      hasQuestionsApiKey: false,
      questionMapping: {},
      connectedAt: null,
      credentialsRotatedAt: null,
      questionMappingUpdatedAt: null,
      lastSuccessfulSyncAt: null,
      lastSuccessfulSyncParticipantCount: null
    })).toThrow("ogiltigt svar");
  });

  it("rejects raw-form fields and malformed suggestions", () => {
    const valid = {
      campId,
      questions: [{
        id: "1201",
        label: "Specialkost",
        description: null,
        type: "textarea",
        choices: []
      }],
      suggestions: [{
        questionId: "1201",
        role: "special_diet",
        score: 90,
        reason: "test"
      }],
      currentMapping: {},
      mappingValid: false,
      mappingUpdatedAt: null
    };

    expect(parseScoutnetQuestionCatalogue(valid).questions).toHaveLength(1);
    expect(() => parseScoutnetQuestionCatalogue({
      ...valid,
      suggestions: [{
        questionId: "1201",
        role: "raw_member_id",
        score: 90,
        reason: "test"
      }]
    })).toThrow("mappningsförslag");
    expect(() => parseScoutnetQuestionCatalogue({
      ...valid,
      currentMapping: { raw_form_response: "must not pass" }
    })).toThrow("frågemappning");
  });

  it("parses only the minimised fixture reconciliation contract", () => {
    const sourceReference = `scoutnet:v1:${"a".repeat(43)}`;
    const preview = {
      campId,
      snapshotSource: "local_fixture",
      previewDigest: "a".repeat(64),
      complete: true,
      snapshotParticipantCount: 1,
      stateDigest: "b".repeat(64),
      rows: [{
        sourceReference,
        displayName: "Syntetisk Scout",
        category: "new",
        proposedAction: "create",
        existingParticipantId: null,
        registrationStatus: "unconfirmed",
        attendanceWarnings: ["attendance_answer_missing"],
        duplicateCandidates: [],
        changes: [],
        specialDietChange: "added"
      }],
      counts: {
        new: 1,
        changed: 0,
        unchanged: 0,
        reactivated: 0,
        withdrawn: 0,
        possible_duplicate: 0
      }
    };

    expect(parseScoutnetReconciliationPreview(preview)).toMatchObject({
      campId,
      snapshotSource: "local_fixture",
      snapshotParticipantCount: 1
    });
    expect(() => parseScoutnetReconciliationPreview({
      ...preview,
      rawParticipants: [{ memberNo: "must-not-pass" }]
    })).toThrow("ogiltig förhandsgranskning");
    expect(() => parseScoutnetReconciliationPreview({
      ...preview,
      counts: { ...preview.counts, new: 0 }
    })).toThrow("ogiltig förhandsgranskning");
  });

  it("parses a bounded reconciliation result", () => {
    expect(parseScoutnetReconciliationApplyResult({
      campId,
      stateDigest: "c".repeat(64),
      appliedAt: "2026-07-31T08:10:00.000Z",
      snapshotParticipantCount: 3,
      counts: {
        created: 2,
        linked: 0,
        updated: 0,
        reactivated: 0,
        withdrawn: 0,
        skipped: 1
      }
    }).counts.created).toBe(2);
  });
});
