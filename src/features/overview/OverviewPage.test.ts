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
  supplierItemsTotal: 0,
  supplierReadyItems: 0,
  supplierSafeSuggestions: 0,
  supplierReviewSuggestions: 0,
  supplierPendingItems: 0,
  supplierNoMatchItems: 0,
  supplierOrderIncompleteItems: 0,
  supplierUnresolvedItems: 0,
  procurementReady: true,
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

  it("keeps procurement actionable while supplier matching or ordering remains", () => {
    const calculated = {
      ...emptyCounts,
      participants: 12,
      recipeCopies: 2,
      mealPlanConfirmed: true,
      requiredSlots: 6,
      plannedSlots: 6,
      calculationStale: false,
      supplierItemsTotal: 10,
      supplierReadyItems: 6,
      supplierReviewSuggestions: 2,
      supplierNoMatchItems: 1,
      supplierOrderIncompleteItems: 1,
      supplierUnresolvedItems: 4,
      procurementReady: false,
    };

    expect(overviewNextAction(calculated)).toMatchObject({
      title: "Färdigställ ICA-underlaget",
      to: "/inkop",
    });
    expect(overviewNextAction(calculated).description).toContain(
      "2 träffar att granska",
    );
    expect(overviewNextAction(calculated).description).toContain(
      "1 råvara utan träff",
    );
  });

  it("tells the planner that ICA searches continue without manual work", () => {
    const nextAction = overviewNextAction({
      ...emptyCounts,
      participants: 12,
      recipeCopies: 2,
      mealPlanConfirmed: true,
      requiredSlots: 6,
      plannedSlots: 6,
      calculationStale: false,
      supplierItemsTotal: 10,
      supplierPendingItems: 4,
      supplierUnresolvedItems: 4,
      procurementReady: false,
    });

    expect(nextAction.description).toContain(
      "Scoutmat söker automatiskt efter 4 råvaror hos ICA",
    );
    expect(nextAction.note).toContain("fortsätta planera på andra sidor");
  });

  it("sends a calculated camp without purchase rows to procurement before deliveries", () => {
    expect(overviewNextAction({
      ...emptyCounts,
      participants: 12,
      recipeCopies: 2,
      mealPlanConfirmed: true,
      requiredSlots: 6,
      plannedSlots: 6,
      calculationStale: false,
    })).toMatchObject({
      title: "Skapa inköpsunderlaget",
      to: "/inkop",
    });
  });
});
