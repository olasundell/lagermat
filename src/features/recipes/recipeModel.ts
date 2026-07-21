export type IngredientMode = "weighted_portion" | "head" | "fixed_once_per_camp";
export type DietaryRule = "standard" | "exclude" | "only";

export const ingredientModeLabels: Record<IngredientMode, string> = {
  weighted_portion: "Per portion",
  head: "Per person",
  fixed_once_per_camp: "En gång för hela lägret"
};

function dietaryTagLabel(tag: string | null): string {
  if (tag === "Gluten") return "glutenfri kost";
  if (tag === "Vegetarian") return "vegetarisk kost";
  if (tag === "Mjölkprotein") return "mjölkproteinfri kost";
  return tag?.trim() || "angiven specialkost";
}

export function ingredientAppliesToDiet(
  dietaryTags: readonly string[],
  rule: DietaryRule,
  dietaryTagLabel: string | null
): boolean {
  if (rule === "standard") return true;
  if (!dietaryTagLabel?.trim()) return false;

  const expected = dietaryTagLabel.trim().toLocaleLowerCase("sv-SE");
  const matches = dietaryTags.some((tag) => tag.trim().toLocaleLowerCase("sv-SE") === expected);
  return rule === "only" ? matches : !matches;
}

export function dietaryRuleLabel(rule: DietaryRule, tag: string | null): string {
  if (rule === "standard") return "För alla";
  if (rule === "exclude") return `Ingår inte vid ${dietaryTagLabel(tag)}`;
  return `Endast vid ${dietaryTagLabel(tag)}`;
}

export function formatIngredientAmount(amount: number): string {
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 6 }).format(amount);
}
