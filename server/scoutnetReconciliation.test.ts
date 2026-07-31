import { describe, expect, it } from "vitest";
import type {
  ScoutnetParticipantPreview,
  ScoutnetParticipantSnapshot,
} from "../supabase/functions/scoutnet-connection/adapter";
import {
  buildScoutnetReconciliationPreview,
  scoutnetReconciliationPreviewDigest,
  type ScoutnetReconciliationContext,
  type ScoutnetReconciliationParticipantState,
} from "../supabase/functions/scoutnet-connection/reconciliation";

const source = (suffix: string) =>
  `scoutnet:v1:${suffix.padEnd(43, "a").slice(0, 43)}`;

function incoming(
  overrides: Partial<ScoutnetParticipantPreview> = {},
): ScoutnetParticipantPreview {
  return {
    sourceReference: source("member"),
    displayName: "Kim Karlsson",
    registrationStatus: "confirmed",
    group: { reference: source("group"), name: "Lägret" },
    division: { reference: source("division"), name: "Upptäckarna" },
    patrol: { reference: source("patrol"), name: "Räven" },
    attendance: [{
      startsAt: "2026-08-02T06:00:00.000Z",
      endsAt: "2026-08-05T18:00:00.000Z",
    }],
    attendanceWarnings: [],
    specialDiet: ["Gluten"],
    ...overrides,
  };
}

function existing(
  overrides: Partial<ScoutnetReconciliationParticipantState> = {},
): ScoutnetReconciliationParticipantState {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    displayName: "Kim Karlsson",
    sourceKind: "scoutnet",
    sourceReference: source("member"),
    lifecycleStatus: "active",
    registrationStatus: "confirmed",
    division: { reference: source("division"), name: "Upptäckarna" },
    patrol: { reference: source("patrol"), name: "Räven" },
    attendance: [{
      startsAt: "2026-08-02T06:00:00.000Z",
      endsAt: "2026-08-05T18:00:00.000Z",
    }],
    specialDietRaw: "Gluten",
    dietaryReviewStatus: "resolved",
    dietaryTagCount: 1,
    ...overrides,
  };
}

function snapshot(
  participants: ScoutnetParticipantPreview[],
): ScoutnetParticipantSnapshot {
  return {
    complete: true,
    participantCount: participants.length,
    participants,
  };
}

function context(
  participants: ScoutnetReconciliationParticipantState[],
): ScoutnetReconciliationContext {
  return {
    campId: "caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
    stateDigest: "b".repeat(64),
    participants,
  };
}

describe("Scoutnet reconciliation", () => {
  it("classifies exact source identities without matching on the name", () => {
    const preview = buildScoutnetReconciliationPreview(
      snapshot([incoming({ displayName: "Kim Nytt Efternamn" })]),
      context([existing()]),
    );

    expect(preview.rows[0]).toMatchObject({
      category: "changed",
      proposedAction: "update",
      existingParticipantId: "11111111-1111-1111-1111-111111111111",
    });
    expect(preview.rows[0]?.changes.map((change) => change.field))
      .toContain("display_name");
  });

  it("only flags an equal manual name as a possible duplicate", () => {
    const manual = existing({
      sourceKind: "manual",
      sourceReference: "manual:one",
      displayName: "  KIM   KARLSSON ",
    });
    const preview = buildScoutnetReconciliationPreview(
      snapshot([incoming()]),
      context([manual]),
    );

    expect(preview.rows[0]).toMatchObject({
      category: "possible_duplicate",
      proposedAction: "review",
      existingParticipantId: null,
    });
    expect(preview.rows[0]?.duplicateCandidates).toEqual([{
      participantId: manual.id,
      displayName: manual.displayName,
      sourceKind: "manual",
      lifecycleStatus: "active",
    }]);
  });

  it("does not make a fuzzy or partial name match", () => {
    const preview = buildScoutnetReconciliationPreview(
      snapshot([incoming({ displayName: "Ris" })]),
      context([existing({
        sourceKind: "manual",
        sourceReference: "manual:one",
        displayName: "Riskaka",
      })]),
    );

    expect(preview.rows[0]?.category).toBe("new");
  });

  it("shows a destructive cleared dietary note explicitly", () => {
    const preview = buildScoutnetReconciliationPreview(
      snapshot([incoming({ specialDiet: [] })]),
      context([existing()]),
    );

    expect(preview.rows[0]).toMatchObject({
      category: "changed",
      specialDietChange: "cleared",
    });
    expect(preview.rows[0]?.changes).toContainEqual({
      field: "special_diet",
      previous: "Gluten",
      next: null,
      destructive: true,
    });
  });

  it("separates reactivated, cancelled and missing participants", () => {
    const reactivated = existing({
      lifecycleStatus: "withdrawn",
      sourceReference: source("reactivated"),
    });
    const cancelled = existing({ sourceReference: source("cancelled") });
    const missing = existing({ sourceReference: source("missing") });
    const preview = buildScoutnetReconciliationPreview(
      snapshot([
        incoming({ sourceReference: source("reactivated") }),
        incoming({
          sourceReference: source("cancelled"),
          registrationStatus: "cancelled",
        }),
      ]),
      context([reactivated, cancelled, missing]),
    );

    expect(preview.counts).toMatchObject({
      reactivated: 1,
      withdrawn: 2,
    });
    expect(preview.rows.find((row) =>
      row.sourceReference === source("missing")
    )?.proposedAction).toBe("withdraw");
  });

  it("never proposes mass withdrawal for an unexpected empty snapshot", () => {
    expect(() =>
      buildScoutnetReconciliationPreview(
        snapshot([]),
        context([existing()]),
      )
    ).toThrow(/oväntat tomt eller ofullständigt/i);
  });

  it("preserves disjoint attendance ranges and produces a stable digest", async () => {
    const next = incoming({
      attendance: [
        {
          startsAt: "2026-08-04T06:00:00.000Z",
          endsAt: "2026-08-05T18:00:00.000Z",
        },
        {
          startsAt: "2026-08-02T06:00:00.000Z",
          endsAt: "2026-08-03T18:00:00.000Z",
        },
      ],
      attendanceWarnings: ["attendance_answer_incomplete"],
    });
    const first = buildScoutnetReconciliationPreview(
      snapshot([next]),
      context([existing()]),
    );
    const second = buildScoutnetReconciliationPreview(
      snapshot([{ ...next, attendance: [...next.attendance].reverse() }]),
      context([existing()]),
    );

    expect(first.rows[0]?.attendanceWarnings)
      .toEqual(["attendance_answer_incomplete"]);
    expect(await scoutnetReconciliationPreviewDigest(first))
      .toBe(await scoutnetReconciliationPreviewDigest(second));
  });

  it("treats equivalent UTC timestamp spellings as unchanged", () => {
    const preview = buildScoutnetReconciliationPreview(
      snapshot([incoming()]),
      context([existing({
        attendance: [{
          startsAt: "2026-08-02T06:00:00+00:00",
          endsAt: "2026-08-05T18:00:00+00:00",
        }],
      })]),
    );

    expect(preview.rows[0]).toMatchObject({
      category: "unchanged",
      proposedAction: "none",
      changes: [],
    });
  });
});
