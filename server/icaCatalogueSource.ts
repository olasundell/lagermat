// Shared by the local and hosted Node runtimes. It has no platform dependencies.
export const ICA_SICKLA_STORE_ID = "1004021";
export const ICA_SICKLA_STORE_NAME = "ICA Kvantum Sickla";
export const MAX_QUERY_COUNT = 10;
export const MAX_QUERY_LENGTH = 80;
export const MAX_TOTAL_QUERY_LENGTH = 600;
export const MAX_PRODUCTS_PER_SEARCH = 100;

const ICA_SEARCH_URL =
  `https://handlaprivatkund.ica.se/stores/${ICA_SICKLA_STORE_ID}`
  + "/api/webproductpagews/v6/product-pages/search";
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

type JsonObject = Record<string, unknown>;

export interface CatalogueRequestBody {
  organizationId: string;
  storeId: typeof ICA_SICKLA_STORE_ID;
  queries: string[];
}

export interface Money {
  amount: string;
  currency: string;
}

export interface UnitPrice {
  unit: string;
  price: Money;
  pricePerSuffix: string | null;
}

export interface CatchweightQuantity {
  value: string;
  uom: string;
}

export interface IcaCatalogueProduct {
  productId: string;
  retailerProductId: string;
  name: string;
  brand: string | null;
  packSizeDescription: string | null;
  type: string | null;
  price: Money | null;
  promoPrice: Money | null;
  unitPrice: UnitPrice | null;
  available: boolean | null;
  catchweight: {
    typicalQuantity: CatchweightQuantity | null;
  } | null;
  categoryPath: string[];
  countryOfOrigin: string | null;
}

export class IcaPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IcaPayloadError";
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function requiredString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new IcaPayloadError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed || codePointLength(trimmed) > maxLength) {
    throw new IcaPayloadError(`${field} has an invalid length`);
  }
  return trimmed;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, field, maxLength);
}

function parseProductId(value: unknown, field: string): string {
  const id = requiredString(value, field, 80);
  if (!PRODUCT_ID_PATTERN.test(id)) {
    throw new IcaPayloadError(`${field} has an invalid format`);
  }
  return id;
}

function parseMoney(value: unknown, field: string): Money | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) {
    throw new IcaPayloadError(`${field} must be an object`);
  }

  const rawAmount = value.amount;
  const amount = typeof rawAmount === "number" && Number.isFinite(rawAmount)
    ? String(rawAmount)
    : requiredString(rawAmount, `${field}.amount`, 32);
  const currency = requiredString(value.currency, `${field}.currency`, 8);

  if (!/^-?\d+(?:[.,]\d+)?$/.test(amount) || !/^[A-Z]{3}$/.test(currency)) {
    throw new IcaPayloadError(`${field} has an invalid monetary value`);
  }
  return { amount, currency };
}

function parseUnitPrice(value: unknown): UnitPrice | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) {
    throw new IcaPayloadError("unitPrice must be an object");
  }
  const price = parseMoney(value.price, "unitPrice.price");
  if (!price) {
    throw new IcaPayloadError("unitPrice.price is required");
  }
  return {
    unit: requiredString(value.unit, "unitPrice.unit", 32),
    price,
    pricePerSuffix: optionalString(
      value.pricePerSuffix,
      "unitPrice.pricePerSuffix",
      80,
    ),
  };
}

function parseCatchweightQuantity(
  value: unknown,
): CatchweightQuantity | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) {
    throw new IcaPayloadError("catchweight.typicalQuantity must be an object");
  }
  return {
    value: requiredString(
      value.value,
      "catchweight.typicalQuantity.value",
      32,
    ),
    uom: requiredString(value.uom, "catchweight.typicalQuantity.uom", 16),
  };
}

function parseCatchweight(
  value: unknown,
): IcaCatalogueProduct["catchweight"] {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) {
    throw new IcaPayloadError("catchweight must be an object");
  }
  return {
    typicalQuantity: parseCatchweightQuantity(value.typicalQuantity),
  };
}

function parseCategoryPath(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new IcaPayloadError("categoryPath must be a bounded array");
  }
  return value.map((item, index) =>
    requiredString(item, `categoryPath[${index}]`, 160)
  );
}

function parseProduct(value: unknown): IcaCatalogueProduct {
  if (!isObject(value)) {
    throw new IcaPayloadError("decorated product must be an object");
  }

  const available = value.available === undefined || value.available === null
    ? null
    : value.available;
  if (available !== null && typeof available !== "boolean") {
    throw new IcaPayloadError("available must be a boolean");
  }

  return {
    productId: parseProductId(value.productId, "productId"),
    retailerProductId: parseProductId(
      value.retailerProductId,
      "retailerProductId",
    ),
    name: requiredString(value.name, "name", 300),
    brand: optionalString(value.brand, "brand", 160),
    packSizeDescription: optionalString(
      value.packSizeDescription,
      "packSizeDescription",
      160,
    ),
    type: optionalString(value.type, "type", 40),
    price: parseMoney(value.price, "price"),
    promoPrice: parseMoney(value.promoPrice, "promoPrice"),
    unitPrice: parseUnitPrice(value.unitPrice),
    available,
    catchweight: parseCatchweight(value.catchweight),
    categoryPath: parseCategoryPath(value.categoryPath),
    countryOfOrigin: optionalString(
      value.countryOfOrigin,
      "countryOfOrigin",
      120,
    ),
  };
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export function parseCatalogueRequest(value: unknown): CatalogueRequestBody {
  if (!isObject(value)) {
    throw new TypeError("Request body must be an object");
  }
  if (!isUuid(value.organizationId)) {
    throw new TypeError("organizationId must be a UUID");
  }
  if (value.storeId !== ICA_SICKLA_STORE_ID) {
    throw new TypeError("Only ICA Kvantum Sickla is supported");
  }
  if (
    !Array.isArray(value.queries)
    || value.queries.length === 0
    || value.queries.length > MAX_QUERY_COUNT
  ) {
    throw new TypeError("queries must be a non-empty bounded array");
  }

  const queries: string[] = [];
  const seen = new Set<string>();
  for (const item of value.queries) {
    if (typeof item !== "string") {
      throw new TypeError("Every query must be a string");
    }
    const query = item.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (
      codePointLength(query) < 2
      || codePointLength(query) > MAX_QUERY_LENGTH
      || /[\p{Cc}\p{Cf}]/u.test(query)
    ) {
      throw new TypeError("A query has an invalid length or content");
    }
    const key = query.toLocaleLowerCase("sv-SE");
    if (!seen.has(key)) {
      queries.push(query);
      seen.add(key);
    }
  }

  const totalLength = queries.reduce(
    (sum, query) => sum + codePointLength(query),
    0,
  );
  if (queries.length === 0 || totalLength > MAX_TOTAL_QUERY_LENGTH) {
    throw new TypeError("The combined query length is invalid");
  }

  return {
    organizationId: value.organizationId,
    storeId: ICA_SICKLA_STORE_ID,
    queries,
  };
}

export function buildIcaSearchUrl(query: string): URL {
  const url = new URL(ICA_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("tag", "web");
  url.searchParams.set("includeAdditionalPageInfo", "true");
  url.searchParams.set("maxProductsToDecorate", "50");
  url.searchParams.set("maxPageSize", "50");
  return url;
}

export function parseIcaSearchPayload(
  value: unknown,
): IcaCatalogueProduct[] {
  if (!isObject(value) || !Array.isArray(value.productGroups)) {
    throw new IcaPayloadError("productGroups must be an array");
  }
  if (value.productGroups.length > 25) {
    throw new IcaPayloadError("productGroups is too large");
  }

  if (value.metadata !== undefined && !isObject(value.metadata)) {
    throw new IcaPayloadError("metadata must be an object");
  }

  const products: IcaCatalogueProduct[] = [];
  const seenProductIds = new Set<string>();
  for (const [groupIndex, group] of value.productGroups.entries()) {
    if (!isObject(group)) {
      throw new IcaPayloadError(`productGroups[${groupIndex}] must be an object`);
    }
    const decoratedProducts = group.decoratedProducts ?? [];
    if (
      !Array.isArray(decoratedProducts)
      || decoratedProducts.length > MAX_PRODUCTS_PER_SEARCH
    ) {
      throw new IcaPayloadError(
        `productGroups[${groupIndex}].decoratedProducts is invalid`,
      );
    }
    for (const rawProduct of decoratedProducts) {
      let product: IcaCatalogueProduct;
      try {
        product = parseProduct(rawProduct);
      } catch (error) {
        if (error instanceof IcaPayloadError) continue;
        throw error;
      }
      if (!seenProductIds.has(product.productId)) {
        products.push(product);
        seenProductIds.add(product.productId);
      }
      if (products.length > MAX_PRODUCTS_PER_SEARCH) {
        throw new IcaPayloadError("The decorated product result is too large");
      }
    }
  }
  return products;
}
