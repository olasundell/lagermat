import type { ScoutnetParticipantSnapshot } from "./adapter.ts";

const sourceReference = (character: string): string =>
  `scoutnet:v1:${character.repeat(43)}`;

const fixture: ScoutnetParticipantSnapshot = {
  complete: true,
  participantCount: 3,
  participants: [
    {
      sourceReference: sourceReference("a"),
      displayName: "Syntetisk Scout Ett",
      registrationStatus: "confirmed",
      group: {
        reference: sourceReference("g"),
        name: "Syntetiska lägret",
      },
      division: {
        reference: sourceReference("d"),
        name: "Syntetdivisionen",
      },
      patrol: {
        reference: sourceReference("p"),
        name: "Syntetpatrullen",
      },
      attendance: [{
        startsAt: "2026-08-02T06:00:00.000Z",
        endsAt: "2026-08-05T18:00:00.000Z",
      }],
      attendanceWarnings: [],
      specialDiet: [],
    },
    {
      sourceReference: sourceReference("b"),
      displayName: "Syntetisk Scout Två",
      registrationStatus: "confirmed",
      group: {
        reference: sourceReference("g"),
        name: "Syntetiska lägret",
      },
      division: {
        reference: sourceReference("d"),
        name: "Syntetdivisionen",
      },
      patrol: {
        reference: sourceReference("q"),
        name: "Andra syntetpatrullen",
      },
      attendance: [
        {
          startsAt: "2026-08-02T06:00:00.000Z",
          endsAt: "2026-08-03T18:00:00.000Z",
        },
        {
          startsAt: "2026-08-04T06:00:00.000Z",
          endsAt: "2026-08-05T18:00:00.000Z",
        },
      ],
      attendanceWarnings: [],
      specialDiet: ["Syntetisk glutenuppgift"],
    },
    {
      sourceReference: sourceReference("c"),
      displayName: "Syntetisk Avanmälan",
      registrationStatus: "cancelled",
      group: {
        reference: sourceReference("g"),
        name: "Syntetiska lägret",
      },
      division: {
        reference: sourceReference("d"),
        name: "Syntetdivisionen",
      },
      patrol: {
        reference: null,
        name: null,
      },
      attendance: [],
      attendanceWarnings: [],
      specialDiet: [],
    },
  ],
};

export function localSyntheticReconciliationSnapshot():
  ScoutnetParticipantSnapshot {
  return structuredClone(fixture);
}
