import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import fixture from "./goldenLagermat.json";

function total(components: ReadonlyArray<{ amount: string; multiplier: string }>) {
  return components.reduce(
    (sum, component) => sum.plus(new Decimal(component.amount).times(component.multiplier)),
    new Decimal(0),
  );
}

describe("golden Lägermat fixture", () => {
  it.each(fixture.calculationScenarios)(
    "reproduces $expected $unit $ingredient without binary floating-point rounding",
    (scenario) => {
      expect(total(scenario.components).equals(scenario.expected)).toBe(true);
    },
  );

  it("keeps calculated need and ordered amount as separate exact values", () => {
    expect(total(fixture.procurementScenario.components).toString()).toBe(
      fixture.procurementScenario.required,
    );
    expect(fixture.procurementScenario.ordered).toBe("6");
    expect(fixture.procurementScenario.ordered).not.toBe(fixture.procurementScenario.required);
  });

  it("pins the extracted workbook and records the unavailable public-sheet URL honestly", () => {
    expect(fixture.sources.localWorkbook.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.sources.acceptanceOracle.publicSheetUrl).toBeNull();
    expect(fixture.sources.acceptanceOracle.criterionId).toBe(
      "dcaf97ec-a04f-4999-a901-9f43f01bb2c2",
    );
  });
});
