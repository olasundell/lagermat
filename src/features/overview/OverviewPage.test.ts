import { describe, expect, it } from "vitest";
import { overviewDeliveryProgress, overviewNextAction, type OverviewCounts } from "./overviewModel";

const emptyCounts: OverviewCounts = {
  participants: 0,
  unresolvedDiets: 0,
  recipeCopies: 0,
  meals: 0,
  mealPlanConfirmed: false,
  requiredSlots: 0,
  plannedSlots: 0,
  unplannedSlots: 0,
  zeroAttendanceSlots: 0,
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
    expect(overviewNextAction({
      ...withRecipes,
      mealPlanConfirmed: true,
      requiredSlots: 6,
      plannedSlots: 6,
      zeroAttendanceSlots: 1,
      calculationStale: true,
    })).toMatchObject({
      title: "Färdigställ matsedeln",
      to: "/matsedel",
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

describe("overview delivery progress", () => {
  it("shows the current and next delivery with operational blockers", () => {
    const progress = overviewDeliveryProgress([
      {
        id: "complete",
        title: "Leverans 1",
        rangeStart: "2026-08-01T08:00:00Z",
        status: "complete",
        items: [
          { completed: true, sourcePresent: true },
          { completed: true, sourcePresent: true },
        ],
      },
      {
        id: "current",
        title: "Leverans 2",
        rangeStart: "2026-08-03T08:00:00Z",
        status: "active",
        items: [
          { completed: true, sourcePresent: true },
          { completed: false, sourcePresent: true },
          { completed: false, sourcePresent: true },
          { completed: false, sourcePresent: false },
        ],
      },
      {
        id: "next",
        title: "Leverans 3",
        rangeStart: "2026-08-05T08:00:00Z",
        status: "draft",
        items: [
          { completed: false, sourcePresent: true },
          { completed: false, sourcePresent: true },
        ],
      },
    ], {
      ...emptyCounts,
      participants: 24,
      recipeCopies: 3,
      mealPlanConfirmed: true,
      requiredSlots: 6,
      plannedSlots: 6,
      calculationStale: false,
      supplierItemsTotal: 20,
      supplierReadyItems: 19,
      supplierReviewSuggestions: 1,
      supplierUnresolvedItems: 1,
      procurementReady: false,
      deliveries: 3,
    });

    expect(progress).toMatchObject({
      complete: 1,
      total: 3,
      current: {
        id: "current",
        title: "Leverans 2",
        doneItems: 1,
        totalItems: 3,
      },
      next: {
        id: "next",
        title: "Leverans 3",
      },
      to: "/leveranser",
    });
    expect(progress.blockers).toEqual([
      "2 varor återstår i Leverans 2",
      "1 ICA-träff behöver granskas",
    ]);
  });

  it("shows zero attendance as a delivery blocker", () => {
    const progress = overviewDeliveryProgress([{
      id: "current",
      title: "Leverans 1",
      rangeStart: "2026-08-01T08:00:00Z",
      status: "active",
      items: [{ completed: true, sourcePresent: true }],
    }], {
      ...emptyCounts,
      mealPlanConfirmed: true,
      calculationStale: false,
      zeroAttendanceSlots: 1,
      deliveries: 1,
    });

    expect(progress.blockers).toContain(
      "1 måltid saknar närvarande deltagare eller reserver",
    );
  });

  it("reports a fully completed delivery sequence", () => {
    const progress = overviewDeliveryProgress([{
      id: "complete",
      title: "Leverans 1",
      rangeStart: null,
      status: "complete",
      items: [{ completed: true, sourcePresent: true }],
    }], {
      ...emptyCounts,
      deliveries: 1,
      mealPlanConfirmed: true,
      calculationStale: false,
    });

    expect(progress).toMatchObject({
      complete: 1,
      total: 1,
      current: null,
      next: null,
      blockers: [],
      to: "/leveranser",
    });
  });
});
