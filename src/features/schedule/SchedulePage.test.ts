import { describe, expect, it } from "vitest";
import { emptyReserveDrafts, scheduleCalculationLabel, scheduleIssueParts, visibleReserves } from "./scheduleViewModel";

describe("schedule empty and reserve states", () => {
  it("does not invent a zero standard-food reserve row", () => {
    expect(emptyReserveDrafts()).toEqual([]);
  });

  it("does not call a calculation stale before any meals exist", () => {
    expect(scheduleIssueParts({ unresolved_dietary_needs: 0, meals_without_recipe: 0, calculation_stale: true, can_finalize: false }, 0)).toEqual([]);
    expect(scheduleCalculationLabel(false, 0)).toBeNull();
    expect(scheduleCalculationLabel(false, 1)).toBe("mängderna är inte uträknade");
  });

  it("hides zero-value reserves from the meal summary", () => {
    expect(visibleReserves([
      { id: "zero", dietary_label: "Standardkost", portions: 0 },
      { id: "one", dietary_label: "Glutenfri", portions: 1 }
    ])).toEqual([{ id: "one", dietary_label: "Glutenfri", portions: 1 }]);
  });
});
