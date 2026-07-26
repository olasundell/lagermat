import { describe, expect, it } from "vitest";
import { createSupplyReadinessProblems } from "./supplyApi";

describe("supply readiness copy", () => {
  it("uses singular grammar for one unresolved dietary need and meal", () => {
    expect(createSupplyReadinessProblems({
      meal_plan_confirmed: true,
      unplanned_slots: 0,
      unresolved_dietary_needs: 1,
      meals_without_recipe: 1,
      calculation_stale: false
    })).toEqual([
      "1 specialkostuppgift återstår",
      "1 måltid saknar recept"
    ]);
  });

  it("keeps plural grammar for several unresolved items", () => {
    expect(createSupplyReadinessProblems({
      meal_plan_confirmed: true,
      unplanned_slots: 0,
      unresolved_dietary_needs: 2,
      meals_without_recipe: 3,
      calculation_stale: true
    })).toEqual([
      "2 specialkostuppgifter återstår",
      "3 måltider saknar recept",
      "Beräkningen saknas eller är inaktuell"
    ]);
  });

  it("uses the same structural readiness copy as the schedule", () => {
    expect(createSupplyReadinessProblems({
      meal_plan_confirmed: false,
      unplanned_slots: 2,
      unresolved_dietary_needs: 0,
      meals_without_recipe: 0,
      calculation_stale: true
    })).toEqual([
      "Lägrets måltidstillfällen är inte bekräftade",
      "2 måltidstillfällen är oplanerade",
      "Beräkningen saknas eller är inaktuell"
    ]);
  });
});
