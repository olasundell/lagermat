import { describe, expect, it } from "vitest";
import { overviewNextAction, type OverviewCounts } from "./overviewModel";

const emptyCounts: OverviewCounts = {
  participants: 0,
  unresolvedDiets: 0,
  recipeCopies: 0,
  meals: 0,
  missingRecipes: 0,
  calculations: 0,
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
});
