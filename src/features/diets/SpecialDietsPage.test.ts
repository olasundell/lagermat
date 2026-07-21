import { describe, expect, it } from "vitest";
import { specialDietSummary } from "./specialDietSummary";

describe("special-diet summary", () => {
  it("uses a neutral empty state when no dietary information exists", () => {
    expect(specialDietSummary(0, 0)).toEqual({
      kind: "empty",
      heading: "Ingen specialkost registrerad",
      detail: "Det finns inga uppgifter att granska för lägret.",
      reviewMessage: "Inga specialkostuppgifter finns för lägret."
    });
  });

  it("only calls the gate clear when at least one need was reviewed", () => {
    expect(specialDietSummary(2, 0).kind).toBe("clear");
  });
});
