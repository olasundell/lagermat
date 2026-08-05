import { describe, expect, it } from "vitest";
import {
  ALL_PAGE_TUTORIALS,
  INTRO_TUTORIAL_STEPS,
  PAGE_TUTORIALS,
  PROCUREMENT_MATCHING_TUTORIAL
} from "./tutorialDefinition";

describe("tutorialDefinition", () => {
  it("beskriver introduktionen i beslutad ordning", () => {
    expect(INTRO_TUTORIAL_STEPS.map(({ title }) => title)).toEqual([
      "Välkommen till ditt demoläger",
      "Du arbetar i demoläget",
      "Organisation och läger",
      "Appens delar",
      "Planera i rätt ordning",
      "Börja med deltagarna"
    ]);
    expect(INTRO_TUTORIAL_STEPS).toHaveLength(6);
    expect(INTRO_TUTORIAL_STEPS.at(-1)).toMatchObject({
      id: "participants-handoff",
      primaryAnchor: "overview-participants-step"
    });
  });

  it("har beslutade ankare och en sammanhängande avslutning", () => {
    expect(PAGE_TUTORIALS.map(({ route }) => route)).toEqual([
      "/deltagare",
      "/specialkost",
      "/recept",
      "/matsedel",
      "/inkop",
      "/leveranser"
    ]);
    expect(PAGE_TUTORIALS.flatMap(({ steps }) => steps)).toHaveLength(14);
    expect(PAGE_TUTORIALS.flatMap(({ steps }) =>
      steps.map(({ id }) => id)
    )).toEqual([
      "participants-foundation",
      "participants-privacy",
      "diets-review",
      "diets-decision",
      "recipes-library",
      "recipes-copy",
      "schedule-overview",
      "schedule-edit-meal",
      "schedule-status",
      "schedule-calculate",
      "procurement-list",
      "procurement-review",
      "deliveries-list",
      "deliveries-complete"
    ]);
    expect(PAGE_TUTORIALS.map(({ id, steps }) => [id, steps.length])).toEqual([
      ["participants", 2],
      ["special-diets", 2],
      ["recipes", 2],
      ["schedule", 4],
      ["procurement", 2],
      ["deliveries", 2]
    ]);
    expect(PAGE_TUTORIALS.map(({ id, continuation }) => [
      id,
      continuation?.route ?? null
    ])).toEqual([
      ["participants", "/specialkost"],
      ["special-diets", "/recept"],
      ["recipes", "/matsedel"],
      ["schedule", "/inkop"],
      ["procurement", "/leveranser"],
      ["deliveries", null]
    ]);
    expect(PAGE_TUTORIALS.flatMap(({ steps }) =>
      steps.map(({ primaryAnchor }) => primaryAnchor)
    )).toEqual([
      "participants-heading",
      "participants-privacy",
      "diets-review",
      "diets-decision-card",
      "recipes-library",
      "recipes-copy-heading",
      "schedule-heading",
      "schedule-meal-example",
      "schedule-status",
      "schedule-calculate",
      "procurement-create",
      "procurement-review",
      "deliveries-list",
      "deliveries-complete"
    ]);

    for (const tutorial of PAGE_TUTORIALS) {
      for (const step of tutorial.steps) {
        expect(step.route).toBe(tutorial.route);
        expect(step.primaryAnchor).toBeTruthy();
        expect(step.fallbackAnchor).toBeTruthy();
        expect(step.eligibility).toBe("active-demo");
      }
    }
  });

  it("visar den fördjupade ICA-guiden först som ett eget tillståndsstyrt flöde", () => {
    expect(PROCUREMENT_MATCHING_TUTORIAL).toMatchObject({
      id: "procurement-matching",
      route: "/inkop"
    });
    expect(PROCUREMENT_MATCHING_TUTORIAL.steps.map(({ title }) => title)).toEqual([
      "Från råvara till ICA-artikel",
      "Granska förslagen",
      "Kontrollera förpackning och köpantal"
    ]);
    expect(PROCUREMENT_MATCHING_TUTORIAL.steps.map(({ primaryAnchor }) =>
      primaryAnchor
    )).toEqual([
      "procurement-matching-overview",
      "procurement-matching-decisions",
      "procurement-order-details"
    ]);
    expect(ALL_PAGE_TUTORIALS).toContain(PROCUREMENT_MATCHING_TUTORIAL);
  });

  it("innehåller den godkända tipstexten utan förbjudna användarord", () => {
    const copy = JSON.stringify({ INTRO_TUTORIAL_STEPS, ALL_PAGE_TUTORIALS });
    expect(copy).toContain("Här samlas specialkost som behöver bedömas innan mängderna räknas ut.");
    expect(copy).toContain("Välj en måltidsruta för att byta recept");
    expect(copy).toContain("Gå vidare till leveranser");
    expect(copy).toContain("Ingen order skickas automatiskt");
    expect(copy).toContain("När det finns faktiska matchningsresultat visas en separat genomgång");
    expect(copy).not.toMatch(/\b(?:demot|demoidentitet|demosession|demokopia)\b/i);
    expect(copy).not.toMatch(/\bett demo\b|syntetisk fixture|Nästa att lösa/i);
  });
});
