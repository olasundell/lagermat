import Decimal from "decimal.js";
import type { StagedSupplierCatalogueRow } from "./supplierCatalogueWorkflow";

export const ICA_CATALOGUE_NORMALISATION_VERSION =
  "ica-public-catalogue-v1";

export type IcaPackageDimension = "mass" | "volume" | "count";

export interface IcaCataloguePackaging {
  amount: number;
  unit: "kg" | "l" | "st";
  dimension: IcaPackageDimension;
  innerCount?: number;
}

export type IcaCatalogueRejectionReason =
  | "missing_article_number"
  | "invalid_article_number"
  | "missing_name"
  | "invalid_name"
  | "missing_pack_size"
  | "invalid_pack_size"
  | "conflicting_inner_count"
  | "conflicting_duplicate";

export interface IcaCatalogueRejectedProduct {
  retailerProductId: string | null;
  productId: string | null;
  name: string | null;
  reason: IcaCatalogueRejectionReason;
}

export interface IcaCatalogueNormalisationOptions {
  storeId: string;
  query?: string;
  completedQueries?: readonly string[];
}

export interface IcaCatalogueNormalisationResult {
  rows: StagedSupplierCatalogueRow[];
  rejectedProducts: IcaCatalogueRejectedProduct[];
  duplicateCount: number;
}

interface IcaProductIdentity {
  retailerProductId: string | null;
  productId: string | null;
  name: string | null;
}

interface IcaProductCandidate {
  sourceRow: number;
  product: Record<string, unknown>;
  identity: IcaProductIdentity;
}

interface NormalisedIcaProduct {
  sourceRow: number;
  row: StagedSupplierCatalogueRow;
  identity: IcaProductIdentity;
  comparisonKey: string;
}

interface InnerPackaging {
  count: number | null;
  label: string | null;
  conflict: boolean;
}

const containerLabels: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bburk(?:ar|en|arna)?\b/iu, "burkar"],
  [/\bflask(?:a|or|an|orna)?\b/iu, "flaskor"],
  [/\bpås(?:e|ar|en|arna)?\b/iu, "påsar"],
  [/\bkartong(?:er|en|erna)?\b/iu, "kartonger"],
  [/\btub(?:er|en|erna)?\b/iu, "tuber"],
  [/\bask(?:ar|en|arna)?\b/iu, "askar"],
  [/\bportion(?:er|en|erna)?\b/iu, "portioner"],
  [/\brull(?:e|ar|en|arna)?\b/iu, "rullar"],
  [/\bstyck(?:en)?\b/iu, "stycken"],
];

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function compactString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const compacted = String(value).replace(/\s+/g, " ").trim();
  return compacted || null;
}

function boundedString(value: unknown, maximumLength: number): string | null {
  const compacted = compactString(value);
  return compacted && compacted.length <= maximumLength ? compacted : null;
}

function decimal(value: string): Decimal | null {
  const source = value.replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(source)) return null;
  try {
    const parsed = new Decimal(source);
    return parsed.isFinite() && parsed.greaterThan(0) ? parsed : null;
  } catch {
    return null;
  }
}

function safeAmount(value: Decimal): number | null {
  if (
    value.decimalPlaces() > 6
    || value.greaterThan(Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }
  const amount = value.toNumber();
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/**
 * Parses only complete, fixed package descriptions. Approximate weights,
 * multiplications and mixed dimensions are intentionally refused.
 */
export function parseIcaPackSizeDescription(
  value: unknown,
): IcaCataloguePackaging | null {
  const source = compactString(value)?.toLocaleLowerCase("sv-SE");
  if (!source) return null;

  const countPerPackage = source.match(
    /^(\d+)\s*(?:per|\/)\s*(?:frp|förp|förpackning)\.?$/iu,
  );
  if (countPerPackage?.[1]) {
    const parsed = decimal(countPerPackage[1]);
    if (!parsed?.isInteger()) return null;
    const amount = safeAmount(parsed);
    return amount === null
      ? null
      : { amount, unit: "st", dimension: "count" };
  }

  const multiplication = source.match(
    /^(\d{1,4})\s*(?:x|×)\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl|dl)\.?$/iu,
  );
  if (multiplication?.[1] && multiplication[2] && multiplication[3]) {
    const count = Number(multiplication[1]);
    const inner = parseIcaPackSizeDescription(
      `${multiplication[2]}${multiplication[3]}`,
    );
    if (
      !Number.isSafeInteger(count)
      || count <= 0
      || !inner
      || inner.dimension === "count"
    ) {
      return null;
    }
    const amount = safeAmount(new Decimal(inner.amount).times(count));
    return amount === null
      ? null
      : { ...inner, amount, innerCount: count };
  }

  const direct = source.match(
    /^(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl|dl|st|styck|stycken)\.?$/iu,
  );
  if (!direct?.[1] || !direct[2]) return null;

  const parsed = decimal(direct[1]);
  if (!parsed) return null;

  const sourceUnit = direct[2].toLocaleLowerCase("sv-SE");
  let canonical = parsed;
  let unit: IcaCataloguePackaging["unit"];
  let dimension: IcaPackageDimension;

  if (sourceUnit === "kg" || sourceUnit === "g") {
    canonical = sourceUnit === "g" ? parsed.dividedBy(1000) : parsed;
    unit = "kg";
    dimension = "mass";
  } else if (["l", "ml", "cl", "dl"].includes(sourceUnit)) {
    const divisor = sourceUnit === "ml"
      ? 1000
      : sourceUnit === "cl"
        ? 100
        : sourceUnit === "dl"
          ? 10
          : 1;
    canonical = parsed.dividedBy(divisor);
    unit = "l";
    dimension = "volume";
  } else {
    if (!parsed.isInteger()) return null;
    unit = "st";
    dimension = "count";
  }

  const amount = safeAmount(canonical);
  return amount === null ? null : { amount, unit, dimension };
}

function countFromProductName(name: string): number[] {
  const expressions = [
    /(?:^|\s)(\d{1,4})\s*-\s*p(?:\b|$)/giu,
    /(?:^|\s)(\d{1,4})\s*-\s*pack(?:\b|$)/giu,
    /(?:^|\s)(\d{1,4})\s*pack(?:\b|$)/giu,
    /(?:^|\s)(\d{1,4})\s*st(?:yck(?:en)?)?(?:\b|$)/giu,
  ];
  const counts = new Set<number>();

  for (const expression of expressions) {
    for (const match of name.matchAll(expression)) {
      const count = Number(match[1]);
      if (Number.isSafeInteger(count) && count > 0) counts.add(count);
    }
  }

  return [...counts].sort((left, right) => left - right);
}

function innerUnitLabel(name: string): string {
  for (const [expression, label] of containerLabels) {
    if (expression.test(name)) return label;
  }
  return "stycken";
}

function innerPackaging(
  name: string,
  packaging: IcaCataloguePackaging,
): InnerPackaging {
  const nameCounts = countFromProductName(name);
  const packageCount = packaging.dimension === "count"
    ? packaging.amount
    : null;
  const counts = new Set(nameCounts);
  if (packaging.innerCount !== undefined) counts.add(packaging.innerCount);
  if (packageCount !== null) counts.add(packageCount);

  if (counts.size > 1) {
    return { count: null, label: null, conflict: true };
  }

  const count = [...counts][0] ?? null;
  return {
    count,
    label: count === null ? null : innerUnitLabel(name),
    conflict: false,
  };
}

function categoryPath(value: unknown): string[] {
  if (typeof value === "string") {
    const category = compactString(value);
    return category ? [category] : [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .map(compactString)
    .filter((category): category is string => Boolean(category));
}

function priceDetails(
  value: unknown,
): { amount: number; currency: string } | null {
  const price = record(value);
  const amountSource = price
    ? compactString(price.amount)
    : compactString(value);
  if (!amountSource) return null;

  const parsed = decimal(amountSource);
  const amount = parsed ? safeAmount(parsed) : null;
  const currencySource = price ? compactString(price.currency) : null;
  const currency = currencySource?.toLocaleUpperCase("en-US") ?? "SEK";
  if (amount === null || !/^[A-Z]{3}$/.test(currency)) return null;
  return { amount, currency };
}

function jsonValue(value: unknown): unknown {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (
      typeof value === "number"
      && Number.isFinite(value)
    )
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(jsonValue).filter((entry) => entry !== undefined);
  }
  const source = record(value);
  if (!source) return undefined;
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, entry]) => [key, jsonValue(entry)] as const)
      .filter((entry): entry is readonly [string, Exclude<unknown, undefined>] =>
        entry[1] !== undefined
      ),
  );
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) =>
      entry !== null && entry !== undefined
    ),
  );
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

function identity(product: Record<string, unknown>): IcaProductIdentity {
  return {
    retailerProductId: compactString(product.retailerProductId),
    productId: compactString(product.productId),
    name: compactString(product.name),
  };
}

function rejection(
  candidate: IcaProductCandidate,
  reason: IcaCatalogueRejectionReason,
): IcaCatalogueRejectedProduct {
  return { ...candidate.identity, reason };
}

function normaliseProduct(
  candidate: IcaProductCandidate,
  options: IcaCatalogueNormalisationOptions,
): NormalisedIcaProduct | IcaCatalogueRejectedProduct {
  const { product, identity: productIdentity, sourceRow } = candidate;
  const rawArticleNumber = productIdentity.retailerProductId;
  if (!rawArticleNumber) return rejection(candidate, "missing_article_number");
  const articleNumber = boundedString(rawArticleNumber, 120);
  if (!articleNumber) return rejection(candidate, "invalid_article_number");

  if (!productIdentity.name) return rejection(candidate, "missing_name");
  const name = boundedString(productIdentity.name, 240);
  if (!name) return rejection(candidate, "invalid_name");

  const rawPackSize = compactString(product.packSizeDescription);
  if (!rawPackSize) return rejection(candidate, "missing_pack_size");
  const packaging = parseIcaPackSizeDescription(rawPackSize);
  if (!packaging) return rejection(candidate, "invalid_pack_size");

  const inner = innerPackaging(name, packaging);
  if (inner.conflict) {
    return rejection(candidate, "conflicting_inner_count");
  }

  const brand = boundedString(product.brand, 160);
  const path = categoryPath(product.categoryPath);
  const fullCategory = path.join(" > ");
  const category = fullCategory.length <= 160
    ? fullCategory || null
    : boundedString(path.at(-1), 160);
  const price = priceDetails(product.price);
  const available = typeof product.available === "boolean"
    ? product.available
    : null;
  const productType = compactString(product.type);
  const catchWeight = productType?.toLocaleUpperCase("en-US").includes(
    "CATCHWEIGHT",
  ) === true || record(product.catchweight) !== null;
  const image = record(product.image);
  const imageUrl = boundedString(image?.src, 2000);
  const unitPrice = jsonValue(product.unitPrice);
  const query = compactString(options.query);
  const completedQueries = [...new Map(
    (options.completedQueries ?? [])
      .map((completedQuery) => compactString(completedQuery))
      .filter((completedQuery): completedQuery is string =>
        Boolean(completedQuery && completedQuery.length <= 80)
      )
      .map((completedQuery) => [
        completedQuery.toLocaleLowerCase("sv-SE"),
        completedQuery,
      ]),
  ).values()];
  const productId = boundedString(productIdentity.productId, 240);

  const packagingMetadata = compactRecord({
    normalization_version: ICA_CATALOGUE_NORMALISATION_VERSION,
    source_pack_size_description: rawPackSize,
    package_dimension: packaging.dimension,
    inner_unit_count: inner.count,
    inner_unit_label: inner.label,
  });
  const metadata = compactRecord({
    source: "ica_public_webshop",
    store_id: options.storeId,
    query,
    ica_completed_searches:
      completedQueries.length ? completedQueries : null,
    ica_retailer_product_id: articleNumber,
    ica_product_id: productId,
    ica_unit_price: unitPrice,
    ica_available: available,
    ica_product_type: productType,
    ica_catchweight: jsonValue(product.catchweight),
    ica_category_path: path.length ? path : null,
    ica_image_url: imageUrl,
  });
  const normalizedData = compactRecord({
    supplier_article_number: articleNumber,
    display_name: name,
    purchase_unit: "förpackning",
    package_amount: packaging.amount,
    package_unit: packaging.unit,
    minimum_order_units: 1,
    price: price?.amount,
    currency: price?.currency,
    // ICA's public response exposes `available`, but the public shop asks the
    // customer to sign in for stock information. Preserve the source value in
    // metadata without presenting it as verified store stock.
    availability_status: "unknown",
    category,
    brand,
    catch_weight: catchWeight,
    packaging_metadata: packagingMetadata,
    metadata,
  });
  const rawData = compactRecord({
    source_row: sourceRow,
    store_id: options.storeId,
    query,
    retailer_product_id: articleNumber,
    product_id: productId,
    name,
    brand: compactString(product.brand),
    pack_size_description: rawPackSize,
    price: jsonValue(product.price),
    unit_price: unitPrice,
    available,
    type: productType,
    catchweight: jsonValue(product.catchweight),
    category_path: path.length ? path : null,
    image_url: imageUrl,
  });

  return {
    sourceRow,
    identity: productIdentity,
    comparisonKey: stableJson({
      supplier_article_number: normalizedData.supplier_article_number,
      display_name: normalizedData.display_name,
      purchase_unit: normalizedData.purchase_unit,
      package_amount: normalizedData.package_amount,
      package_unit: normalizedData.package_unit,
      minimum_order_units: normalizedData.minimum_order_units,
      brand: normalizedData.brand,
      category: normalizedData.category,
      catch_weight: normalizedData.catch_weight,
      packaging_metadata: normalizedData.packaging_metadata,
    }),
    row: {
      source_row: sourceRow,
      raw_data: rawData,
      normalized_data: normalizedData,
    },
  };
}

function productCandidates(response: unknown): IcaProductCandidate[] {
  const root = record(response);
  if (!root || !Array.isArray(root.productGroups)) {
    throw new TypeError("ICA-svaret saknar productGroups.");
  }

  const products: IcaProductCandidate[] = [];
  for (const groupValue of root.productGroups) {
    const group = record(groupValue);
    if (!group || !Array.isArray(group.decoratedProducts)) continue;
    for (const productValue of group.decoratedProducts) {
      const product = record(productValue);
      if (!product) continue;
      products.push({
        sourceRow: products.length + 1,
        product,
        identity: identity(product),
      });
    }
  }
  return products;
}

/**
 * Converts a store-scoped ICA webshop search response into rows accepted by
 * Scoutmat's supplier catalogue staging RPC. No network access or fuzzy
 * inference occurs here.
 */
export function normaliseIcaCatalogueResponse(
  response: unknown,
  options: IcaCatalogueNormalisationOptions,
): IcaCatalogueNormalisationResult {
  const storeId = compactString(options.storeId);
  if (!storeId) throw new TypeError("ICA-butikens id saknas.");

  const groups = new Map<string, IcaProductCandidate[]>();
  const ungrouped: IcaProductCandidate[] = [];
  for (const candidate of productCandidates(response)) {
    const key = candidate.identity.retailerProductId;
    if (!key) {
      ungrouped.push(candidate);
      continue;
    }
    const duplicates = groups.get(key) ?? [];
    duplicates.push(candidate);
    groups.set(key, duplicates);
  }

  const rows: NormalisedIcaProduct[] = [];
  const rejectedProducts: IcaCatalogueRejectedProduct[] = [];
  let duplicateCount = 0;

  for (const candidate of ungrouped) {
    const result = normaliseProduct(candidate, { ...options, storeId });
    if ("reason" in result) rejectedProducts.push(result);
    else rows.push(result);
  }

  for (const duplicates of groups.values()) {
    duplicateCount += Math.max(0, duplicates.length - 1);
    const normalised = duplicates.map((candidate) =>
      normaliseProduct(candidate, { ...options, storeId })
    );
    const valid = normalised.filter(
      (candidate): candidate is NormalisedIcaProduct => !("reason" in candidate),
    );
    const variants = new Map(
      valid.map((candidate) => [candidate.comparisonKey, candidate]),
    );

    if (variants.size > 1) {
      const first = duplicates[0]!;
      rejectedProducts.push(rejection(first, "conflicting_duplicate"));
      continue;
    }
    const selected = valid[0];
    if (selected) {
      rows.push(selected);
      continue;
    }
    const firstRejection = normalised[0];
    if (firstRejection && "reason" in firstRejection) {
      rejectedProducts.push(firstRejection);
    }
  }

  rows.sort((left, right) => left.sourceRow - right.sourceRow);
  rejectedProducts.sort((left, right) =>
    (left.retailerProductId ?? "").localeCompare(
      right.retailerProductId ?? "",
      "sv-SE",
    )
    || (left.productId ?? "").localeCompare(right.productId ?? "", "sv-SE")
    || (left.name ?? "").localeCompare(right.name ?? "", "sv-SE")
  );

  return {
    rows: rows.map(({ row }) => row),
    rejectedProducts,
    duplicateCount,
  };
}
