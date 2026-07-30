import Decimal from "decimal.js";
import type {
  IngredientSupplierMatch,
  SupplierAccount,
  SupplierOffer,
  SupplierProduct,
} from "./supplierModel";

export const CATALOGUE_MATCHER_VERSION = "deterministic-v3" as const;
export const CATALOGUE_NORMALIZATION_VERSION = "sv-v2" as const;
export const SAFE_MATCH_SCORE = 96;
export const SAFE_MATCH_MARGIN = 8;
export const REVIEW_MATCH_SCORE = 70;

export interface CatalogueIngredient {
  organization_id: string;
  canonical_key: string;
  display_name: string;
  unit: string;
}

export interface CatalogueSynonym {
  ingredient_name: string;
  supplier_name: string;
}

export interface CatalogueMatcherInput {
  ingredient: CatalogueIngredient;
  accounts: readonly SupplierAccount[];
  products: readonly SupplierProduct[];
  offers?: readonly SupplierOffer[];
  approved_matches?: readonly IngredientSupplierMatch[];
  rejected_fingerprints?: readonly string[];
  synonyms?: readonly CatalogueSynonym[];
  supplier_account_ids?: readonly string[];
  as_of_date: string;
}

export type CatalogueMatchStatus =
  | "approved_exact"
  | "safe"
  | "review"
  | "no_match";

export type CatalogueExplanationKind = "evidence" | "warning" | "blocker";

export type CatalogueExplanationCode =
  | "approved_match"
  | "approved_gtin"
  | "exact_name"
  | "synonym_name"
  | "token_similarity"
  | "exact_unit"
  | "convertible_unit"
  | "verified_package"
  | "approved_manual_conversion"
  | "extra_product_modifier"
  | "stale_approval"
  | "out_of_stock"
  | "inactive_supplier_account"
  | "inactive_supplier_product"
  | "discontinued_product"
  | "catch_weight"
  | "invalid_product_name"
  | "invalid_purchase_unit"
  | "invalid_package"
  | "invalid_minimum_order"
  | "invalid_approved_mapping"
  | "incompatible_unit"
  | "missing_required_modifier"
  | "conflicting_product_form"
  | "rejected_product"
  | "low_name_confidence";

export interface CatalogueMatchExplanation {
  kind: CatalogueExplanationKind;
  code: CatalogueExplanationCode;
  points: number;
  message: string;
}

export interface CatalogueMatchScore {
  name: number;
  unit: number;
  package: number;
  total: number;
}

export interface CatalogueMatchCandidate {
  account: SupplierAccount;
  product: SupplierProduct;
  offer: SupplierOffer | null;
  approved_match: IngredientSupplierMatch | null;
  fingerprint: string;
  score: CatalogueMatchScore;
  amount_per_purchase_unit: number | null;
  explanations: CatalogueMatchExplanation[];
}

export type CatalogueResolutionReason =
  | "single_current_approved_match"
  | "multiple_approved_matches"
  | "approved_match_needs_review"
  | "unique_safe_candidate"
  | "safe_margin_not_met"
  | "candidate_needs_review"
  | "no_eligible_candidate"
  | "confidence_below_review_threshold";

export interface CatalogueMatchResult {
  status: CatalogueMatchStatus;
  matcher_version: typeof CATALOGUE_MATCHER_VERSION;
  normalization_version: typeof CATALOGUE_NORMALIZATION_VERSION;
  selected: CatalogueMatchCandidate | null;
  candidates: CatalogueMatchCandidate[];
  reason: CatalogueResolutionReason;
  margin_to_next: number | null;
}

interface UnitDefinition {
  dimension: "mass" | "volume";
  factor_to_base: string;
}

const UNIT_ALIASES: Readonly<Record<string, string>> = {
  kilogram: "kg",
  kilograms: "kg",
  kilo: "kg",
  gram: "g",
  grams: "g",
  milligram: "mg",
  milligrams: "mg",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  deciliter: "dl",
  deciliters: "dl",
  centiliter: "cl",
  centiliters: "cl",
  milliliter: "ml",
  milliliters: "ml",
  styck: "st",
  stycken: "st",
  st: "st",
};

const UNIT_DEFINITIONS: Readonly<Record<string, UnitDefinition>> = {
  kg: { dimension: "mass", factor_to_base: "1000" },
  hg: { dimension: "mass", factor_to_base: "100" },
  g: { dimension: "mass", factor_to_base: "1" },
  mg: { dimension: "mass", factor_to_base: "0.001" },
  l: { dimension: "volume", factor_to_base: "1000" },
  dl: { dimension: "volume", factor_to_base: "100" },
  cl: { dimension: "volume", factor_to_base: "10" },
  ml: { dimension: "volume", factor_to_base: "1" },
};

const PACKAGING_UNIT_PATTERN =
  "(?:milligrams?|mg|grams?|g|hektogram|hg|kilograms?|kilo|kg|milliliters?|ml|centiliters?|cl|deciliters?|dl|liters?|litres?|l|stycken|styck|st)";

const FORM_MODIFIERS: Readonly<Record<string, readonly string[]>> = {
  fresh: ["färsk", "färska"],
  frozen: ["fryst", "frysta", "djupfryst", "djupfrysta"],
  dried: ["torkad", "torkade"],
  powder: ["pulver"],
  concentrate: ["koncentrat", "koncentrerad", "koncentrerade"],
};

const REQUIREMENT_MODIFIERS: Readonly<Record<string, readonly string[]>> = {
  gluten_free: ["glutenfri", "glutenfritt", "glutenfria"],
  lactose_free: ["laktosfri", "laktosfritt", "laktosfria"],
  milk_free: ["mjölkfri", "mjölkfritt", "mjölkfria"],
  vegan: ["vegansk", "veganskt", "veganska"],
  vegetarian: ["vegetarisk", "vegetariskt", "vegetariska"],
};

const LOW_WEIGHT_TOKENS = new Set(["av", "för", "med", "och", "utan"]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function roundedScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function finitePositiveDecimal(value: number): Decimal | null {
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() && decimal.greaterThan(0) ? decimal : null;
  } catch {
    return null;
  }
}

export function normalizeCatalogueText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("sv-SE")
    .replace(/&/g, " och ")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeSupplierUnit(value: string): string {
  const normalized = normalizeCatalogueText(value).replace(/\s+/g, "");
  return UNIT_ALIASES[normalized] ?? normalized;
}

export function normalizeSupplierProductName(
  value: string,
  brand: string | null = null,
): string {
  const quantityExpression = new RegExp(
    `\\b\\d+(?:[.,]\\d+)?\\s*(?:x|×)\\s*\\d+(?:[.,]\\d+)?\\s*${PACKAGING_UNIT_PATTERN}\\b`,
    "giu",
  );
  const singlePackageExpression = new RegExp(
    `\\b\\d+(?:[.,]\\d+)?\\s*${PACKAGING_UNIT_PATTERN}\\b`,
    "giu",
  );
  const itemCountExpression =
    /\b\d+(?:[.,]\d+)?\s*(?:-\s*)?(?:p|pack|stycken|styck|st)\b/giu;

  const productName = normalizeCatalogueText(
    value
      .replace(quantityExpression, " ")
      .replace(singlePackageExpression, " ")
      .replace(itemCountExpression, " ")
      .replace(/\b(?:kolli|kartong|förpackning|förp|pack|påse|burk)\b/giu, " "),
  );
  const normalizedBrand = normalizeCatalogueText(brand ?? "");
  if (!normalizedBrand || productName === normalizedBrand) return productName;

  if (productName.startsWith(`${normalizedBrand} `)) {
    return productName.slice(normalizedBrand.length).trim();
  }
  if (productName.endsWith(` ${normalizedBrand}`)) {
    return productName.slice(0, -(normalizedBrand.length + 1)).trim();
  }
  return productName;
}

function canonicalDecimal(value: number): string {
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal.toString() : String(value);
  } catch {
    return String(value);
  }
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")
  }}`;
}

function packagingFingerprintMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const metadata = value as Record<string, unknown>;
  return {
    inner_unit_count: metadata.inner_unit_count ?? null,
    inner_unit_label: typeof metadata.inner_unit_label === "string"
      ? normalizeCatalogueText(metadata.inner_unit_label)
      : null,
  };
}

export function createSupplierProductFingerprint(product: SupplierProduct): string {
  const persistedFingerprint = (
    product as SupplierProduct & { product_fingerprint?: unknown }
  ).product_fingerprint;
  if (
    typeof persistedFingerprint === "string"
    && /^[0-9a-f]{64}$/.test(persistedFingerprint)
  ) {
    return persistedFingerprint;
  }

  const signature = [
    CATALOGUE_MATCHER_VERSION,
    product.organization_id,
    product.supplier_account_id,
    normalizeCatalogueText(product.supplier_article_number),
    normalizeCatalogueText(product.display_name),
    product.gtin?.trim() ?? "",
    normalizeSupplierUnit(product.purchase_unit),
    canonicalDecimal(product.package_amount),
    normalizeSupplierUnit(product.package_unit),
    String(product.minimum_order_units),
    String(product.catch_weight),
    stableJson(packagingFingerprintMetadata(product.packaging_metadata)),
  ].join("\u001f");
  return `sp-v2:${fnv1a64(signature)}`;
}

function tokenize(value: string): string[] {
  return value ? [...new Set(value.split(" ").filter(Boolean))] : [];
}

function tokenWeight(token: string): number {
  if (LOW_WEIGHT_TOKENS.has(token)) return 0.25;
  return Math.max(1, Math.min(4, token.length / 3));
}

function weightedTokenF1(ingredientName: string, productName: string): number {
  const ingredientTokens = tokenize(ingredientName);
  const productTokens = tokenize(productName);
  if (ingredientTokens.length === 0 || productTokens.length === 0) return 0;

  const productSet = new Set(productTokens);
  const ingredientSet = new Set(ingredientTokens);
  const ingredientWeight = ingredientTokens.reduce((sum, token) => sum + tokenWeight(token), 0);
  const productWeight = productTokens.reduce((sum, token) => sum + tokenWeight(token), 0);
  const sharedWeight = ingredientTokens
    .filter((token) => productSet.has(token))
    .reduce((sum, token) => sum + tokenWeight(token), 0);

  if (sharedWeight === 0 || ingredientWeight === 0 || productWeight === 0) return 0;
  const recall = sharedWeight / ingredientWeight;
  const precision = productTokens
    .filter((token) => ingredientSet.has(token))
    .reduce((sum, token) => sum + tokenWeight(token), 0) / productWeight;
  return (2 * precision * recall) / (precision + recall);
}

function orderedBigramScore(ingredientName: string, productName: string): number {
  const ingredientTokens = tokenize(ingredientName);
  const productTokens = tokenize(productName);
  if (ingredientTokens.length < 2 || productTokens.length < 2) return 0;

  const productBigrams = new Set(
    productTokens.slice(0, -1).map((token, index) => `${token}\u001f${productTokens[index + 1]}`),
  );
  const ingredientBigrams = ingredientTokens
    .slice(0, -1)
    .map((token, index) => `${token}\u001f${ingredientTokens[index + 1]}`);
  const shared = ingredientBigrams.filter((bigram) => productBigrams.has(bigram)).length;
  return shared / ingredientBigrams.length;
}

function matchesSynonym(
  ingredientName: string,
  productName: string,
  synonyms: readonly CatalogueSynonym[],
): boolean {
  return synonyms.some((synonym) => {
    const synonymIngredient = normalizeCatalogueText(synonym.ingredient_name);
    const synonymProduct = normalizeSupplierProductName(synonym.supplier_name);
    return (
      synonymIngredient === ingredientName
      && synonymProduct === productName
    ) || (
      synonymIngredient === productName
      && synonymProduct === ingredientName
    );
  });
}

function extractModifiers(
  normalizedName: string,
  definitions: Readonly<Record<string, readonly string[]>>,
): Set<string> {
  const tokens = tokenize(normalizedName);
  const modifiers = new Set<string>();
  for (const [modifier, variants] of Object.entries(definitions)) {
    if (variants.some((variant) =>
      tokens.includes(variant)
      || tokens.some((token) => token.length > variant.length && token.endsWith(variant))
    )) {
      modifiers.add(modifier);
    }
  }
  return modifiers;
}

function explanation(
  kind: CatalogueExplanationKind,
  code: CatalogueExplanationCode,
  points: number,
  message: string,
): CatalogueMatchExplanation {
  return { kind, code, points, message };
}

function currentOffer(
  product: SupplierProduct,
  offers: readonly SupplierOffer[],
  asOfDate: string,
): SupplierOffer | null {
  return offers
    .filter((offer) =>
      offer.organization_id === product.organization_id
      && offer.supplier_product_id === product.id
      && (!offer.valid_from || offer.valid_from <= asOfDate)
      && (!offer.valid_to || offer.valid_to >= asOfDate)
    )
    .sort((left, right) => {
      const fetchedDifference = compareText(right.fetched_at, left.fetched_at);
      return fetchedDifference !== 0
        ? fetchedDifference
        : compareText(left.id, right.id);
    })[0] ?? null;
}

function nameAssessment(
  ingredientName: string,
  productName: string,
  synonyms: readonly CatalogueSynonym[],
  approvedGtin: boolean,
): { score: number; code: CatalogueExplanationCode; message: string } {
  if (ingredientName === productName && ingredientName !== "") {
    return { score: 80, code: "exact_name", message: "Exakt normaliserat produktnamn." };
  }
  if (matchesSynonym(ingredientName, productName, synonyms)) {
    return { score: 76, code: "synonym_name", message: "Exakt träff via en explicit synonym." };
  }
  if (approvedGtin) {
    return { score: 78, code: "approved_gtin", message: "Samma GTIN som en tidigare godkänd produkt." };
  }

  const tokenScore = weightedTokenF1(ingredientName, productName) * 70;
  const phraseScore = orderedBigramScore(ingredientName, productName) * 5;
  return {
    score: roundedScore(Math.min(75, tokenScore + phraseScore)),
    code: "token_similarity",
    message: "Poäng från viktad tokenlikhet och stabil ordföljd.",
  };
}

function packageAssessment(
  product: SupplierProduct,
  requiredUnit: string,
  approvedMatch: IngredientSupplierMatch | null,
  explanations: CatalogueMatchExplanation[],
): { unit: number; package: number; amount: number | null } {
  if (!product.purchase_unit.trim()) {
    explanations.push(explanation(
      "blocker",
      "invalid_purchase_unit",
      0,
      "Produkten saknar en beställningsenhet.",
    ));
  }
  if (!Number.isInteger(product.minimum_order_units) || product.minimum_order_units <= 0) {
    explanations.push(explanation(
      "blocker",
      "invalid_minimum_order",
      0,
      "Minsta beställningsantal måste vara ett positivt heltal.",
    ));
  }

  if (approvedMatch) {
    const approvedAmount = finitePositiveDecimal(approvedMatch.amount_per_purchase_unit);
    if (
      normalizeSupplierUnit(approvedMatch.required_unit) !== requiredUnit
      || !approvedAmount
    ) {
      explanations.push(explanation(
        "blocker",
        "invalid_approved_mapping",
        0,
        "Den godkända matchningen har en ogiltig enhet eller mängd.",
      ));
      return { unit: 0, package: 0, amount: null };
    }

    explanations.push(explanation(
      "evidence",
      "exact_unit",
      15,
      "Den godkända matchningen använder ingrediensens behovsenhet.",
    ));
    explanations.push(explanation(
      "evidence",
      "approved_manual_conversion",
      5,
      "Mängden per inköpsenhet är uttryckligen godkänd.",
    ));
    return { unit: 15, package: 5, amount: approvedAmount.toNumber() };
  }

  const packageAmount = finitePositiveDecimal(product.package_amount);
  const packageUnit = normalizeSupplierUnit(product.package_unit);
  if (!packageAmount || !packageUnit) {
    explanations.push(explanation(
      "blocker",
      "invalid_package",
      0,
      "Produkten saknar en verifierbar totalmängd per inköpsenhet.",
    ));
    return { unit: 0, package: 0, amount: null };
  }

  let unitScore = 0;
  let amountPerPurchaseUnit: Decimal | null = null;
  if (packageUnit === requiredUnit) {
    unitScore = 15;
    amountPerPurchaseUnit = packageAmount;
    explanations.push(explanation(
      "evidence",
      "exact_unit",
      15,
      "Förpackningsenheten är samma som behovsenheten.",
    ));
  } else {
    const packageDefinition = UNIT_DEFINITIONS[packageUnit];
    const requiredDefinition = UNIT_DEFINITIONS[requiredUnit];
    if (
      packageDefinition
      && requiredDefinition
      && packageDefinition.dimension === requiredDefinition.dimension
    ) {
      unitScore = 12;
      amountPerPurchaseUnit = packageAmount
        .times(packageDefinition.factor_to_base)
        .dividedBy(requiredDefinition.factor_to_base);
      explanations.push(explanation(
        "evidence",
        "convertible_unit",
        12,
        `Exakt ${packageDefinition.dimension === "mass" ? "vikt" : "volym"}konvertering mellan ${packageUnit} och ${requiredUnit}.`,
      ));
    } else {
      explanations.push(explanation(
        "blocker",
        "incompatible_unit",
        0,
        `Förpackningsenheten ${packageUnit || "saknas"} kan inte konverteras säkert till ${requiredUnit}.`,
      ));
    }
  }

  if (!amountPerPurchaseUnit || !amountPerPurchaseUnit.greaterThan(0)) {
    return { unit: unitScore, package: 0, amount: null };
  }

  explanations.push(explanation(
    "evidence",
    "verified_package",
    5,
    "Total mängd per beställningsbar inköpsenhet är strukturerad.",
  ));
  return {
    unit: unitScore,
    package: 5,
    amount: amountPerPurchaseUnit.toNumber(),
  };
}

function hasKind(
  candidate: CatalogueMatchCandidate,
  kind: CatalogueExplanationKind,
): boolean {
  return candidate.explanations.some((item) => item.kind === kind);
}

function compareCandidates(
  left: CatalogueMatchCandidate,
  right: CatalogueMatchCandidate,
): number {
  const blockerDifference = Number(hasKind(left, "blocker")) - Number(hasKind(right, "blocker"));
  if (blockerDifference !== 0) return blockerDifference;

  const scoreDifference = right.score.total - left.score.total;
  if (scoreDifference !== 0) return scoreDifference;

  const approvedDifference = Number(Boolean(right.approved_match)) - Number(Boolean(left.approved_match));
  if (approvedDifference !== 0) return approvedDifference;

  const warningDifference =
    left.explanations.filter((item) => item.kind === "warning").length
    - right.explanations.filter((item) => item.kind === "warning").length;
  if (warningDifference !== 0) return warningDifference;

  const availabilityRank = (candidate: CatalogueMatchCandidate): number => {
    const status = candidate.offer?.availability_status
      .trim()
      .toLocaleLowerCase("sv-SE");
    if (status === "available") return 0;
    if (!status || status === "unknown") return 1;
    if (status === "out_of_stock") return 2;
    return 3;
  };
  const availabilityDifference = availabilityRank(left) - availabilityRank(right);
  if (availabilityDifference !== 0) return availabilityDifference;

  const unitPriceRank = (
    candidate: CatalogueMatchCandidate,
  ): { currency: string; value: Decimal } | null => {
    const price = candidate.offer?.price;
    const amount = candidate.amount_per_purchase_unit;
    const currency = candidate.offer?.currency.trim().toLocaleUpperCase("en-US");
    if (
      typeof price !== "number"
      || !Number.isFinite(price)
      || price <= 0
      || typeof amount !== "number"
      || !Number.isFinite(amount)
      || amount <= 0
      || !currency
    ) {
      return null;
    }
    return {
      currency,
      value: new Decimal(price).dividedBy(amount),
    };
  };
  const leftUnitPrice = unitPriceRank(left);
  const rightUnitPrice = unitPriceRank(right);
  if (leftUnitPrice && rightUnitPrice) {
    if (leftUnitPrice.currency === rightUnitPrice.currency) {
      const unitPriceDifference = leftUnitPrice.value.comparedTo(
        rightUnitPrice.value,
      );
      if (unitPriceDifference !== 0) return unitPriceDifference;
    }
  } else if (leftUnitPrice || rightUnitPrice) {
    return leftUnitPrice ? -1 : 1;
  }

  const providerDifference = compareText(left.account.provider_key, right.account.provider_key);
  if (providerDifference !== 0) return providerDifference;
  const articleDifference = compareText(
    left.product.supplier_article_number,
    right.product.supplier_article_number,
  );
  return articleDifference !== 0
    ? articleDifference
    : compareText(left.product.id, right.product.id);
}

function assessCandidate(
  ingredient: CatalogueIngredient,
  account: SupplierAccount,
  product: SupplierProduct,
  offer: SupplierOffer | null,
  approvedMatch: IngredientSupplierMatch | null,
  approvedGtins: ReadonlySet<string>,
  synonyms: readonly CatalogueSynonym[],
  rejectedFingerprints: ReadonlySet<string>,
): CatalogueMatchCandidate {
  const explanations: CatalogueMatchExplanation[] = [];
  const fingerprint = createSupplierProductFingerprint(product);
  const ingredientName = normalizeCatalogueText(ingredient.display_name);
  const productName = normalizeSupplierProductName(
    product.display_name,
    product.brand,
  );
  const requiredUnit = normalizeSupplierUnit(ingredient.unit);

  if (!account.active) {
    explanations.push(explanation(
      "blocker",
      "inactive_supplier_account",
      0,
      "Leverantörskontot är inaktivt.",
    ));
  }
  if (!product.active) {
    explanations.push(explanation(
      "blocker",
      "inactive_supplier_product",
      0,
      "Leverantörsprodukten är inaktiv.",
    ));
  }
  const catchWeight = (
    product as SupplierProduct & {
      catch_weight?: unknown;
      source_metadata?: unknown;
    }
  ).catch_weight ?? (
    (
      product as SupplierProduct & {
        source_metadata?: { catch_weight?: unknown };
      }
    ).source_metadata?.catch_weight
  );
  if (catchWeight === true) {
    explanations.push(explanation(
      "blocker",
      "catch_weight",
      0,
      "Produkten är en viktvara och saknar en säker fast kollistorlek.",
    ));
  }
  const availability = offer?.availability_status.trim().toLocaleLowerCase("sv-SE");
  if (availability === "discontinued") {
    explanations.push(explanation(
      "blocker",
      "discontinued_product",
      0,
      "Leverantören har markerat produkten som utgången.",
    ));
  } else if (availability === "out_of_stock") {
    explanations.push(explanation(
      "warning",
      "out_of_stock",
      0,
      "Produkten är för närvarande slut i lager.",
    ));
  }
  if (rejectedFingerprints.has(fingerprint)) {
    explanations.push(explanation(
      "blocker",
      "rejected_product",
      0,
      "Samma produktversion har tidigare avvisats.",
    ));
  }
  if (!productName) {
    explanations.push(explanation(
      "blocker",
      "invalid_product_name",
      0,
      "Produktnamnet saknar semantiskt innehåll efter normalisering.",
    ));
  }

  if (approvedMatch) {
    explanations.push(explanation(
      "evidence",
      "approved_match",
      80,
      "Produkten är uttryckligen godkänd för ingrediensen.",
    ));
    const approvedFingerprint = (
      approvedMatch as IngredientSupplierMatch & {
        approved_product_fingerprint?: unknown;
      }
    ).approved_product_fingerprint;
    const staleApproval = typeof approvedFingerprint === "string"
      ? approvedFingerprint !== fingerprint
      : Boolean(
          approvedMatch.approved_at
          && product.updated_at > approvedMatch.approved_at
        );
    if (staleApproval) {
      explanations.push(explanation(
        "warning",
        "stale_approval",
        0,
        "Produkten har ändrats efter att matchningen godkändes.",
      ));
    }
  }

  const approvedGtin = Boolean(product.gtin && approvedGtins.has(product.gtin));
  const assessedName = nameAssessment(
    ingredientName,
    productName,
    synonyms,
    approvedGtin,
  );
  let nameScore = approvedMatch ? 80 : assessedName.score;
  if (!approvedMatch) {
    explanations.push(explanation(
      "evidence",
      assessedName.code,
      assessedName.score,
      assessedName.message,
    ));
  }

  if (!approvedMatch) {
    const ingredientRequirements = extractModifiers(ingredientName, REQUIREMENT_MODIFIERS);
    const productRequirements = extractModifiers(productName, REQUIREMENT_MODIFIERS);
    const missingRequirements = [...ingredientRequirements]
      .filter((modifier) => !productRequirements.has(modifier));
    if (missingRequirements.length > 0) {
      explanations.push(explanation(
        "blocker",
        "missing_required_modifier",
        0,
        `Produkten saknar krav: ${missingRequirements.join(", ")}.`,
      ));
    }

    const ingredientForms = extractModifiers(ingredientName, FORM_MODIFIERS);
    const productForms = extractModifiers(productName, FORM_MODIFIERS);
    if (ingredientForms.size > 0 && productForms.size === 0) {
      explanations.push(explanation(
        "blocker",
        "missing_required_modifier",
        0,
        `Produkten saknar produktform: ${[...ingredientForms].sort(compareText).join(", ")}.`,
      ));
    } else if (
      ingredientForms.size > 0
      && ![...ingredientForms].some((form) => productForms.has(form))
    ) {
      explanations.push(explanation(
        "blocker",
        "conflicting_product_form",
        0,
        "Ingrediens och produkt har oförenliga produktformer.",
      ));
    }

    const extraModifiers = new Set(
      [...productRequirements, ...productForms].filter((modifier) =>
        !ingredientRequirements.has(modifier) && !ingredientForms.has(modifier)
      ),
    );
    if (extraModifiers.size > 0) {
      const penalty = Math.min(20, extraModifiers.size * 8);
      nameScore = Math.max(0, nameScore - penalty);
      explanations.push(explanation(
        "warning",
        "extra_product_modifier",
        -penalty,
        `Produkten har ytterligare egenskaper: ${[...extraModifiers].sort(compareText).join(", ")}.`,
      ));
    }
  }

  const assessedPackage = packageAssessment(
    product,
    requiredUnit,
    approvedMatch,
    explanations,
  );

  let score: CatalogueMatchScore = {
    name: roundedScore(nameScore),
    unit: assessedPackage.unit,
    package: assessedPackage.package,
    total: roundedScore(nameScore + assessedPackage.unit + assessedPackage.package),
  };
  if (approvedMatch) {
    score = { name: 80, unit: 15, package: 5, total: 100 };
  } else if (score.total < REVIEW_MATCH_SCORE) {
    explanations.push(explanation(
      "warning",
      "low_name_confidence",
      0,
      "Den sammanlagda matchningspoängen är för låg för granskning.",
    ));
  }

  return {
    account,
    product,
    offer,
    approved_match: approvedMatch,
    fingerprint,
    score,
    amount_per_purchase_unit: assessedPackage.amount,
    explanations,
  };
}

function stableCandidates(candidates: readonly CatalogueMatchCandidate[]): CatalogueMatchCandidate[] {
  return [...candidates].sort(compareCandidates);
}

export function matchSupplierCatalogue(
  input: CatalogueMatcherInput,
): CatalogueMatchResult {
  const parsedAsOfDate = new Date(`${input.as_of_date}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.as_of_date)
    || Number.isNaN(parsedAsOfDate.valueOf())
    || parsedAsOfDate.toISOString().slice(0, 10) !== input.as_of_date
  ) {
    throw new TypeError("as_of_date must be an explicit ISO date");
  }

  const selectedAccountIds = input.supplier_account_ids
    ? new Set(input.supplier_account_ids)
    : null;
  const rejectedFingerprints = new Set(input.rejected_fingerprints ?? []);
  const approvedMatches = (input.approved_matches ?? []).filter((match) =>
    match.organization_id === input.ingredient.organization_id
    && match.canonical_key === input.ingredient.canonical_key
    && Boolean(match.approved_by)
    && Boolean(match.approved_at)
  );
  const approvedByProductId = new Map(
    approvedMatches.map((match) => [match.supplier_product_id, match]),
  );
  const productsById = new Map(input.products.map((product) => [product.id, product]));
  const approvedGtins = new Set(
    approvedMatches
      .map((match) => productsById.get(match.supplier_product_id)?.gtin)
      .filter((gtin): gtin is string => Boolean(gtin)),
  );
  const accountsById = new Map(
    input.accounts
      .filter((account) => account.organization_id === input.ingredient.organization_id)
      .map((account) => [account.id, account]),
  );

  const assessed = input.products.flatMap((product) => {
    if (
      product.organization_id !== input.ingredient.organization_id
      || (selectedAccountIds && !selectedAccountIds.has(product.supplier_account_id))
    ) {
      return [];
    }
    const account = accountsById.get(product.supplier_account_id);
    if (!account) return [];

    return [assessCandidate(
      input.ingredient,
      account,
      product,
      currentOffer(product, input.offers ?? [], input.as_of_date),
      approvedByProductId.get(product.id) ?? null,
      approvedGtins,
      input.synonyms ?? [],
      rejectedFingerprints,
    )];
  });
  const candidates = stableCandidates(assessed);
  const eligible = candidates.filter((candidate) => !hasKind(candidate, "blocker"));
  const approvedEligible = eligible.filter((candidate) => candidate.approved_match);
  const freshApproved = approvedEligible.filter((candidate) => !hasKind(candidate, "warning"));

  if (approvedEligible.length === 1 && freshApproved.length === 1) {
    return {
      status: "approved_exact",
      matcher_version: CATALOGUE_MATCHER_VERSION,
      normalization_version: CATALOGUE_NORMALIZATION_VERSION,
      selected: freshApproved[0] ?? null,
      candidates: candidates.slice(0, 5),
      reason: "single_current_approved_match",
      margin_to_next: null,
    };
  }
  if (approvedEligible.length > 1) {
    return {
      status: "review",
      matcher_version: CATALOGUE_MATCHER_VERSION,
      normalization_version: CATALOGUE_NORMALIZATION_VERSION,
      selected: null,
      candidates: candidates.slice(0, 5),
      reason: "multiple_approved_matches",
      margin_to_next: 0,
    };
  }
  if (approvedEligible.length === 1) {
    return {
      status: "review",
      matcher_version: CATALOGUE_MATCHER_VERSION,
      normalization_version: CATALOGUE_NORMALIZATION_VERSION,
      selected: null,
      candidates: candidates.slice(0, 5),
      reason: "approved_match_needs_review",
      margin_to_next: null,
    };
  }

  const top = eligible[0];
  const runnerUp = eligible[1];
  if (!top) {
    return {
      status: "no_match",
      matcher_version: CATALOGUE_MATCHER_VERSION,
      normalization_version: CATALOGUE_NORMALIZATION_VERSION,
      selected: null,
      candidates: candidates.slice(0, 5),
      reason: "no_eligible_candidate",
      margin_to_next: null,
    };
  }

  const margin = runnerUp
    ? roundedScore(top.score.total - runnerUp.score.total)
    : null;
  const safeMargin = margin === null || margin >= SAFE_MATCH_MARGIN;
  if (
    top.score.total >= SAFE_MATCH_SCORE
    && safeMargin
    && !hasKind(top, "warning")
  ) {
    return {
      status: "safe",
      matcher_version: CATALOGUE_MATCHER_VERSION,
      normalization_version: CATALOGUE_NORMALIZATION_VERSION,
      selected: top,
      candidates: candidates.slice(0, 5),
      reason: "unique_safe_candidate",
      margin_to_next: margin,
    };
  }
  if (top.score.total >= REVIEW_MATCH_SCORE) {
    return {
      status: "review",
      matcher_version: CATALOGUE_MATCHER_VERSION,
      normalization_version: CATALOGUE_NORMALIZATION_VERSION,
      selected: null,
      candidates: candidates.slice(0, 5),
      reason: top.score.total >= SAFE_MATCH_SCORE && !safeMargin
        ? "safe_margin_not_met"
        : "candidate_needs_review",
      margin_to_next: margin,
    };
  }

  return {
    status: "no_match",
    matcher_version: CATALOGUE_MATCHER_VERSION,
    normalization_version: CATALOGUE_NORMALIZATION_VERSION,
    selected: null,
    candidates: candidates.slice(0, 5),
    reason: "confidence_below_review_threshold",
    margin_to_next: margin,
  };
}
