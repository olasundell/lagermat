import { describe, expect, it } from "vitest";
import type { EditableSupplyValues } from "../../lib/offlineDb";
import { changedValues } from "./offlineSync";

const base: EditableSupplyValues = {
  ordered_amount: 12,
  ordered_unit: "kg",
  package_note: null,
  comment: "Ta med kärra",
  completed: false
};

describe("changedValues", () => {
  it("köar bara fält som användaren faktiskt ändrat", () => {
    expect(changedValues(base, { ...base, ordered_amount: 14, completed: true })).toEqual({
      ordered_amount: 14,
      completed: true
    });
  });

  it("bevarar null som en avsiktlig lokal ändring", () => {
    expect(changedValues(base, { ...base, comment: null })).toEqual({ comment: null });
  });

  it("skapar ingen mutation när värdena är oförändrade", () => {
    expect(changedValues(base, { ...base })).toEqual({});
  });
});
