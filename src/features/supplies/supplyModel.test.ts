import { describe, expect, it } from "vitest";
import {
  formatCountedAmount,
  formatExactAmount,
  isPurchasePackagingUnit,
  practicalSupplyAmount,
} from "./supplyModel";

describe("human-facing distribution amounts", () => {
  it("pluralises counted supplier units without changing invariant units", () => {
    expect(formatCountedAmount(1, "förpackning")).toBe("1 förpackning");
    expect(formatCountedAmount(15, "förpackning")).toBe("15 förpackningar");
    expect(formatCountedAmount(2, "burk")).toBe("2 burkar");
    expect(formatCountedAmount(6, "paket")).toBe("6 paket");
  });

  it("rounds measured amounts upwards to practical kitchen precision", () => {
    expect(practicalSupplyAmount(1.925, "l")).toEqual({
      amount: "2",
      unit: "l",
      display: "2 l",
      rounded: true,
      issue: null,
    });
    expect(practicalSupplyAmount(0.9, "dl")).toEqual({
      amount: "0,9",
      unit: "dl",
      display: "0,9 dl",
      rounded: false,
      issue: null,
    });
    expect(practicalSupplyAmount(0.344, "kg")).toEqual({
      amount: "350",
      unit: "g",
      display: "350 g",
      rounded: true,
      issue: null,
    });
    expect(practicalSupplyAmount(0.258, "kg")).toEqual({
      amount: "260",
      unit: "g",
      display: "260 g",
      rounded: true,
      issue: null,
    });
  });

  it("uses whole pieces", () => {
    expect(practicalSupplyAmount(7.7, "skivor")).toEqual({
      amount: "8",
      unit: "skivor",
      display: "8 skivor",
      rounded: true,
      issue: null,
    });
    expect(practicalSupplyAmount(17.2, "skivor")).toEqual({
      amount: "18",
      unit: "skivor",
      display: "18 skivor",
      rounded: true,
      issue: null,
    });
    expect(practicalSupplyAmount(6.45, "st")).toEqual({
      amount: "7",
      unit: "st",
      display: "7 st",
      rounded: true,
      issue: null,
    });
  });

  it("rounds every cooking team's indivisible pieces upwards", () => {
    expect(practicalSupplyAmount(7.1, "skivor").display).toBe("8 skivor");
    expect(practicalSupplyAmount(17.2, "skivor").display).toBe("18 skivor");
  });

  it("shows small weights in grams instead of decimal kilograms", () => {
    expect(practicalSupplyAmount(0.00225, "kg")).toEqual({
      amount: "10",
      unit: "g",
      display: "10 g",
      rounded: true,
      issue: null,
    });
  });

  it("rejects purchase packaging as a recipe measurement", () => {
    expect(isPurchasePackagingUnit(" paket ")).toBe(true);
    expect(isPurchasePackagingUnit("kg")).toBe(false);
    expect(practicalSupplyAmount(0.00225, "paket")).toEqual({
      amount: "Ange vikt, volym eller antal i receptet",
      unit: "",
      display: "Ange vikt, volym eller antal i receptet",
      rounded: false,
      issue: "purchase_packaging_unit",
    });
  });

  it("keeps the exact formatter lossless for calculations and order fields", () => {
    expect(formatExactAmount(1.925)).toBe("1,925");
    expect(formatExactAmount(0.00225)).toBe("0,00225");
  });
});
