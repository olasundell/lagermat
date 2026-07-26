import { describe, expect, it } from "vitest";
import { emptyReserveDrafts, inclusiveCampDates, scheduleCalculationLabel, scheduleIssueParts, visibleReserves } from "./scheduleViewModel";

const ready = {
  meal_plan_confirmed: true,
  required_slots: 3,
  planned_slots: 3,
  unplanned_slots: 0,
  no_service_slots: 0,
  unresolved_dietary_needs: 0,
  meals_without_recipe: 0,
  calculation_stale: false,
  can_finalize: true
};

describe("schedule empty and reserve states", () => {
  it("does not invent a zero standard-food reserve row", () => {
    expect(emptyReserveDrafts()).toEqual([]);
  });

  it("does not call a calculation stale before any meals exist", () => {
    expect(scheduleCalculationLabel(false, 0)).toBeNull();
    expect(scheduleCalculationLabel(false, 1)).toBe("mängderna är inte uträknade");
  });

  it("shows structural gaps before dietary and calculation problems", () => {
    expect(scheduleIssueParts({
      ...ready,
      meal_plan_confirmed: false,
      required_slots: 4,
      planned_slots: 2,
      unplanned_slots: 2,
      unresolved_dietary_needs: 1,
      calculation_stale: true,
      can_finalize: false
    })).toEqual([
      "bekräfta lägrets måltidstillfällen",
      "2 måltidstillfällen är oplanerade",
      "1 specialkostuppgift",
      "beräkningen saknas eller är inaktuell"
    ]);
  });

  it("builds every inclusive camp date independently of planned meals", () => {
    expect(inclusiveCampDates("2026-08-02", "2026-08-04")).toEqual([
      "2026-08-02",
      "2026-08-03",
      "2026-08-04"
    ]);
  });

  it("hides zero-value reserves from the meal summary", () => {
    expect(visibleReserves([
      { id: "zero", dietary_label: "Standardkost", portions: 0 },
      { id: "one", dietary_label: "Glutenfri", portions: 1 }
    ])).toEqual([{ id: "one", dietary_label: "Glutenfri", portions: 1 }]);
  });
});
