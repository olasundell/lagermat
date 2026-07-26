import { describe, expect, it } from "vitest";
import { overviewNextAction, type OverviewCounts } from "./overviewModel";

const emptyCounts: OverviewCounts = {
  participants: 0,
  unresolvedDiets: 0,
  recipeCopies: 0,
  meals: 0,
  mealPlanConfirmed: false,
  requiredSlots: 0,
  plannedSlots: 0,
  unplannedSlots: 0,
  noServiceSlots: 0,
  missingRecipes: 0,
  calculationStale: true,
  canFinalize: false,
  deliveries: 0
};

describe("overview next action", () => {
  it("starts an empty camp with participants instead of the schedule", () => {
    expect(overviewNextAction(emptyCounts)).toMatchObject({
      title: "Lägg till deltagare",
      to: "/deltagare"
    });
    expect(overviewNextAction(emptyCounts).note).not.toContain("specialkost");
  });

  it("sends a camp without recipes to the recipe library", () => {
    expect(overviewNextAction({ ...emptyCounts, participants: 12 })).toMatchObject({
      title: "Välj recept för lägret",
      to: "/recept"
    });
  });

  it("uses the shared meal-plan readiness before suggesting calculation", () => {
    const withRecipes = { ...emptyCounts, participants: 12, recipeCopies: 2 };
    expect(overviewNextAction(withRecipes)).toMatchObject({
      title: "Bekräfta lägrets måltidstillfällen",
      to: "/matsedel"
    });
    expect(overviewNextAction({
      ...withRecipes,
      mealPlanConfirmed: true,
      requiredSlots: 6,
      plannedSlots: 5,
      unplannedSlots: 1
    })).toMatchObject({
      title: "Färdigställ matsedeln",
      to: "/matsedel"
    });
  });
});
