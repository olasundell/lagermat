import { describe, expect, it } from "vitest";
import { recurringExtraMealPreview } from "./recurringExtraMealModel";

describe("recurring extra-meal preview", () => {
  const slots = [
    {
      id: "slot-open",
      service_date: "2026-08-03",
      starts_at: "2026-08-03T18:00:00.000Z",
      meal_type: "evening",
      service_status: "required" as const,
    },
    {
      id: "slot-skipped",
      service_date: "2026-08-04",
      starts_at: "2026-08-04T18:00:00.000Z",
      meal_type: "evening",
      service_status: "no_service" as const,
    },
  ];

  it("previews the selected days and exposes reusable versus conflicting slots", () => {
    expect(recurringExtraMealPreview({
      dates: ["2026-08-02", "2026-08-03", "2026-08-04"],
      mealType: "evening",
      time: "20:00",
      slots,
      plannedSlotIds: new Set(["slot-skipped"]),
      timeForSlot: () => "20:00",
    })).toEqual([
      { date: "2026-08-02", state: "new" },
      { date: "2026-08-03", state: "reuse" },
      { date: "2026-08-04", state: "conflict", reason: "Tillfället är markerat som ingen servering." },
    ]);
  });

  it("treats an already planned slot as a conflict rather than silently adding a duplicate meal", () => {
    expect(recurringExtraMealPreview({
      dates: ["2026-08-03"],
      mealType: "evening",
      time: "20:00",
      slots,
      plannedSlotIds: new Set(["slot-open"]),
      timeForSlot: () => "20:00",
    })).toEqual([
      { date: "2026-08-03", state: "conflict", reason: "En måltid är redan planerad vid den här tiden." },
    ]);
  });

  it("uses the selected meal type when checking a repeating series", () => {
    expect(recurringExtraMealPreview({
      dates: ["2026-08-03"],
      mealType: "other",
      time: "20:00",
      slots,
      plannedSlotIds: new Set(["slot-open"]),
      timeForSlot: () => "20:00",
    })).toEqual([
      { date: "2026-08-03", state: "new" },
    ]);
  });
});
