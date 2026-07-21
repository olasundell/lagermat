import { dietaryTagDisplayLabel, normalizeSelectedTags, suggestDietaryTags } from "./dietarySuggestions";

describe("specialkostförslag", () => {
  it("föreslår separata etiketter utan att slå ihop medicinskt olika behov", () => {
    expect(suggestDietaryTags("Laktos, gluten och jordnötter")).toEqual(["Gluten", "Laktos", "Jordnötter"]);
    expect(suggestDietaryTags("Allergisk mot mjölkprotein")).toEqual(["Mjölkprotein"]);
    expect(suggestDietaryTags("Vegetarisk kost")).toEqual(["Vegetarian"]);
    expect(dietaryTagDisplayLabel("Vegetarian")).toBe("Vegetarisk kost");
  });

  it("normaliserar användarens uttryckliga urval men hittar inte på etiketter", () => {
    expect(normalizeSelectedTags([" Gluten ", "gluten", "Soja", ""])).toEqual(["Gluten", "Soja"]);
    expect(suggestDietaryTags("Kontakta köksansvarig")).toEqual([]);
  });
});
