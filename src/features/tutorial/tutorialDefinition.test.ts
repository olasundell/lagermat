import { describe, expect, it } from "vitest";
import {
  INTRO_TUTORIAL_STEPS,
  PAGE_TUTORIALS
} from "./tutorialDefinition";

describe("tutorialDefinition", () => {
  it("beskriver introduktionen i beslutad ordning", () => {
    expect(INTRO_TUTORIAL_STEPS.map(({ title }) => title)).toEqual([
      "Välkommen till ditt demoläger",
      "Du arbetar i demoläget",
      "Organisation och läger",
      "Appens delar",
      "Planera i rätt ordning",
      "Nästa steg"
    ]);
    expect(INTRO_TUTORIAL_STEPS).toHaveLength(6);
  });

  it("har två ankare och två beslutade tips för varje kärnsida", () => {
    expect(PAGE_TUTORIALS.map(({ route }) => route)).toEqual([
      "/deltagare",
      "/specialkost",
      "/recept",
      "/matsedel",
      "/inkop",
      "/leveranser"
    ]);
    expect(PAGE_TUTORIALS.flatMap(({ steps }) => steps)).toHaveLength(12);
    expect(PAGE_TUTORIALS.flatMap(({ steps }) =>
      steps.map(({ id }) => id)
    )).toEqual([
      "participants-foundation",
      "participants-privacy",
      "diets-review",
      "diets-decision",
      "recipes-library",
      "recipes-copy",
      "schedule-grid",
      "schedule-calculate",
      "procurement-list",
      "procurement-review",
      "deliveries-list",
      "deliveries-complete"
    ]);
    for (const tutorial of PAGE_TUTORIALS) {
      expect(tutorial.steps).toHaveLength(2);
      for (const step of tutorial.steps) {
        expect(step.route).toBe(tutorial.route);
        expect(step.primaryAnchor).toBeTruthy();
        expect(step.fallbackAnchor).toBeTruthy();
        expect(step.eligibility).toBe("active-demo");
      }
    }
  });

  it("innehåller den godkända tipstexten utan förbjudna användarord", () => {
    const copy = JSON.stringify({ INTRO_TUTORIAL_STEPS, PAGE_TUTORIALS });
    expect(copy).toContain("Här samlas specialkost som behöver bedömas innan mängderna räknas ut.");
    expect(copy).toContain("Lägermat hjälper till, men du godkänner underlaget.");
    expect(copy).not.toMatch(/\b(?:demot|demoidentitet|demosession|demokopia)\b/i);
    expect(copy).not.toMatch(/\bett demo\b|syntetisk fixture|Nästa att lösa/i);
  });
});
