import { describe, expect, it } from "vitest";
import {
  dietaryRuleLabel,
  formatIngredientAmount,
  ingredientAppliesToDiet,
  ingredientModeLabels
} from "./recipeModel";

describe("recipe ingredient semantics", () => {
  it("exposes all three explicit amount modes", () => {
    expect(Object.keys(ingredientModeLabels)).toEqual([
      "weighted_portion",
      "head",
      "fixed_once_per_camp"
    ]);
  });

  it("applies standard, exclude and only without conflating diet tags", () => {
    expect(ingredientAppliesToDiet(["Gluten"], "standard", null)).toBe(true);
    expect(ingredientAppliesToDiet(["Gluten"], "exclude", "Gluten")).toBe(false);
    expect(ingredientAppliesToDiet(["Mjölkprotein"], "exclude", "Gluten")).toBe(true);
    expect(ingredientAppliesToDiet(["gluten"], "only", "Gluten")).toBe(true);
    expect(ingredientAppliesToDiet(["Laktos"], "only", "Mjölkprotein")).toBe(false);
    expect(ingredientAppliesToDiet([], "only", null)).toBe(false);
  });

  it("renders exact source decimals and readable rules", () => {
    expect(formatIngredientAmount(0.0025)).toBe("0,0025");
    expect(dietaryRuleLabel("exclude", "Gluten")).toBe("Ingår inte vid glutenfri kost");
    expect(dietaryRuleLabel("only", "Gluten")).toBe("Endast vid glutenfri kost");
  });
});
