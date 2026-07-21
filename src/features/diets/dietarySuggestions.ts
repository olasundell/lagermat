const suggestionRules: Array<{ label: string; patterns: RegExp[] }> = [
  { label: "Gluten", patterns: [/\bgluten\b/i, /\bceliaki/i] },
  { label: "Laktos", patterns: [/\blaktos/i] },
  { label: "Mjölkprotein", patterns: [/mj[oö]lkprotein/i, /komj[oö]lk/i] },
  { label: "Ägg", patterns: [/\b[aä]gg\b/i] },
  { label: "Jordnötter", patterns: [/jordn[oö]t/i] },
  { label: "Nötter", patterns: [/(?:^|\s)n[oö]tter?\b/i, /mandel/i, /hasseln[oö]t/i] },
  { label: "Soja", patterns: [/\bsoja/i] },
  { label: "Fisk", patterns: [/\bfisk\b/i] },
  { label: "Skaldjur", patterns: [/skaldjur/i, /r[aä]k/i] },
  { label: "Baljväxter", patterns: [/baljv[aä]xt/i, /\bb[oö]nor?\b/i, /\b[aä]rtor?\b/i, /linser/i] },
  { label: "Vegan", patterns: [/\bvegan/i] },
  { label: "Vegetarian", patterns: [/\bvegetari/i] }
];

export function dietaryTagDisplayLabel(label: string): string {
  if (label === "Gluten") return "Glutenfri kost";
  if (label === "Vegetarian") return "Vegetarisk kost";
  if (label === "Vegan") return "Vegansk kost";
  if (label === "Mjölkprotein") return "Mjölkproteinfri kost";
  return label;
}

export function suggestDietaryTags(rawFoodNote: string | null): string[] {
  if (!rawFoodNote) return [];
  return suggestionRules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(rawFoodNote)))
    .map((rule) => rule.label);
}

export function normalizeSelectedTags(tags: string[]): string[] {
  const byNormalizedLabel = new Map<string, string>();
  for (const tag of tags) {
    const trimmed = tag.trim().replace(/\s+/g, " ");
    const key = trimmed.toLocaleLowerCase("sv-SE");
    if (trimmed && trimmed.length <= 80 && !byNormalizedLabel.has(key)) byNormalizedLabel.set(key, trimmed);
  }
  return [...byNormalizedLabel.values()].sort((left, right) => left.localeCompare(right, "sv-SE"));
}
