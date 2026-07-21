import { describe, expect, it } from "vitest";
import { createSupplyReadinessProblems } from "./supplyApi";

describe("supply readiness copy", () => {
  it("uses singular grammar for one unresolved dietary need and meal", () => {
    expect(createSupplyReadinessProblems({
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
      unresolved_dietary_needs: 2,
      meals_without_recipe: 3,
      calculation_stale: true
    })).toEqual([
      "2 specialkostuppgifter återstår",
      "3 måltider saknar recept",
      "Beräkningen saknas eller är inaktuell"
    ]);
  });
});
