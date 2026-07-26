import { describe, expect, it } from "vitest";
import { userFacingError } from "./userFacingError";

describe("userFacingError", () => {
  it("translates a missing current calculation from a Supabase error object", () => {
    expect(userFacingError(
      { message: "A current calculation revision is required" },
      "Listorna kunde inte skapas."
    )).toBe("Räkna ut mängderna i Matsedel innan du skapar inköpslistor.");
  });

  it("translates the shared final readiness gate", () => {
    expect(userFacingError(
      { message: "Camp readiness must be complete before final status" },
      "Leveransen kunde inte markeras som klar."
    )).toBe("Lägret kan inte slutmarkeras ännu. Lös problemen som visas i Matsedel och försök igen.");
  });
});
