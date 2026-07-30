import Decimal from "decimal.js";

export type SupplierCatalogueField =
  | "supplier_article_number"
  | "display_name"
  | "purchase_unit"
  | "total_quantity"
  | "total_amount"
  | "total_unit"
  | "gtin"
  | "price"
  | "minimum_order_units"
  | "inner_unit_count"
  | "inner_unit_label"
  | "valid_from"
  | "valid_to"
  | "category"
  | "brand"
  | "catch_weight";

export type SupplierCatalogueMappingTarget = SupplierCatalogueField | "ignore";
export type SupplierCatalogueRowStatus = "safe" | "ambiguous" | "blocked";

export interface SupplierCatalogueColumnMapping {
  index: number;
  source: string;
  target: SupplierCatalogueMappingTarget;
}

export interface SupplierCatalogueImportTable {
  filename: string;
  sourceKind: "xlsx" | "csv";
  sheetName: string;
  headerRowIndex: number;
  headers: string[];
  headerSignature: string;
  rows: unknown[][];
  rowNumbers: number[];
}

export type SupplierCatalogueIssueCode =
  | "missing_mapping"
  | "duplicate_mapping"
  | "missing_required_value"
  | "value_too_long"
  | "invalid_total_quantity"
  | "invalid_gtin"
  | "missing_gtin"
  | "invalid_price"
  | "invalid_minimum_order"
  | "invalid_inner_unit_count"
  | "incomplete_inner_packaging"
  | "invalid_date"
  | "invalid_validity_period"
  | "invalid_catch_weight"
  | "catch_weight_requires_review"
  | "duplicate_row"
  | "duplicate_article_number"
  | "duplicate_gtin";

export interface SupplierCatalogueImportIssue {
  severity: "error" | "warning";
  code: SupplierCatalogueIssueCode;
  message: string;
  field?: SupplierCatalogueField;
  sourceRow?: number;
}

export interface SupplierCataloguePreviewRow {
  id: string;
  sourceRow: number;
  status: SupplierCatalogueRowStatus;
  supplierArticleNumber: string;
  displayName: string;
  purchaseUnit: string;
  totalAmount: number | null;
  totalUnit: string;
  gtin: string | null;
  price: number | null;
  minimumOrderUnits: number | null;
  innerUnitCount: number | null;
  innerUnitLabel: string | null;
  validFrom: string | null;
  validTo: string | null;
  category: string | null;
  brand: string | null;
  catchWeight: boolean | null;
  rowFingerprint: string;
  issues: SupplierCatalogueImportIssue[];
}

export interface SupplierCataloguePreview {
  filename: string;
  sheetName: string;
  headerSignature: string;
  mappingIssues: SupplierCatalogueImportIssue[];
  rows: SupplierCataloguePreviewRow[];
  safeCount: number;
  ambiguousCount: number;
  blockedCount: number;
}

export const supplierCatalogueFieldLabels: Record<
  SupplierCatalogueMappingTarget,
  string
> = {
  ignore: "Ta inte med",
  supplier_article_number: "Leverantörens artikelnummer",
  display_name: "Artikelnamn",
  purchase_unit: "Beställningsenhet",
  total_quantity: "Total mängd/enhet",
  total_amount: "Total mängd",
  total_unit: "Mängdenhet",
  gtin: "GTIN",
  price: "Kundpris",
  minimum_order_units: "Minsta beställning",
  inner_unit_count: "Antal innerförpackningar",
  inner_unit_label: "Innerförpackning",
  valid_from: "Gäller från",
  valid_to: "Gäller till",
  category: "Kategori",
  brand: "Varumärke",
  catch_weight: "Viktvara",
};

const requiredDirectFields = [
  "supplier_article_number",
  "display_name",
  "purchase_unit",
] as const satisfies readonly SupplierCatalogueField[];

const aliases: Record<SupplierCatalogueField, readonly string[]> = {
  supplier_article_number: [
    "artikelnummer",
    "artikel nr",
    "artikelnr",
    "art nr",
    "artnr",
    "leverantorens artikelnummer",
    "grossistens artikelnummer",
    "grossistartikelnummer",
    "supplier article number",
    "supplier item number",
    "item number",
    "sku",
  ],
  display_name: [
    "namn",
    "artikelnamn",
    "artikelbenamning",
    "benamning",
    "produktnamn",
    "product name",
    "description",
  ],
  purchase_unit: [
    "bestallningsenhet",
    "inkopsenhet",
    "orderenhet",
    "best enhet",
    "purchase unit",
    "order unit",
  ],
  total_quantity: [
    "total mangd/enhet",
    "total mangd per enhet",
    "mangd per bestallningsenhet",
    "mangd/bestallningsenhet",
    "forpackningsstorlek",
    "forpackningsinnehall",
    "package size",
    "quantity per unit",
    "amount per purchase unit",
  ],
  total_amount: [
    "total mangd",
    "mangd",
    "innehall mangd",
    "package amount",
    "total amount",
  ],
  total_unit: [
    "mangdenhet",
    "innehallsenhet",
    "forpackningsenhet",
    "total enhet",
    "package unit",
    "quantity unit",
  ],
  gtin: ["gtin", "ean", "ean 13", "ean13", "streckkod", "barcode"],
  price: ["pris", "kundpris", "nettopris", "avtalspris", "price", "net price"],
  minimum_order_units: [
    "minsta bestallning",
    "minsta antal",
    "minimiorder",
    "order multipel",
    "ordermultipel",
    "minimum order",
    "minimum quantity",
  ],
  inner_unit_count: [
    "antal innerforpackningar",
    "innerforpackningar per kolli",
    "antal per kolli",
    "consumer units per purchase unit",
    "inner unit count",
  ],
  inner_unit_label: [
    "innerforpackning",
    "innerenhet",
    "konsumentenhet",
    "consumer unit",
    "inner unit",
  ],
  valid_from: [
    "galler fran",
    "giltig fran",
    "pris galler fran",
    "valid from",
    "startdatum",
  ],
  valid_to: [
    "galler till",
    "giltig till",
    "pris galler till",
    "valid to",
    "slutdatum",
  ],
  category: ["kategori", "varugrupp", "produktgrupp", "category"],
  brand: ["varumarke", "marke", "brand"],
  catch_weight: [
    "viktvara",
    "variabel vikt",
    "catch weight",
    "catchweight",
    "variable weight",
  ],
};

function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("sv-SE")
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactValue(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stableFingerprint(namespace: string, parts: readonly string[]): string {
  const bytes = new TextEncoder().encode(`${namespace}\u001f${parts.join("\u001e")}`);
  let hash = 14695981039346656037n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return `${namespace}-v1-${hash.toString(16).padStart(16, "0")}`;
}

export function suggestSupplierCatalogueField(
  header: string,
): SupplierCatalogueMappingTarget {
  const value = normalized(header);
  if (!value) return "ignore";

  for (const [field, fieldAliases] of Object.entries(aliases) as Array<
    [SupplierCatalogueField, readonly string[]]
  >) {
    if (fieldAliases.includes(value)) return field;
  }
  return "ignore";
}

function logicalRequiredTargets(targets: Set<SupplierCatalogueMappingTarget>): number {
  const direct = requiredDirectFields.filter((field) => targets.has(field)).length;
  const hasTotalQuantity = targets.has("total_quantity")
    || (targets.has("total_amount") && targets.has("total_unit"));
  return direct + Number(hasTotalQuantity);
}

function scoreHeaderRow(row: unknown[]): { required: number; optional: number; score: number } {
  const targets = new Set(
    row
      .map((cell) => suggestSupplierCatalogueField(compactValue(cell)))
      .filter((target) => target !== "ignore"),
  );
  const required = logicalRequiredTargets(targets);
  const optional = targets.size - required;
  return {
    required,
    optional,
    score: required * 20 + optional,
  };
}

function findHeaderRow(rows: unknown[][]): {
  index: number;
  required: number;
  optional: number;
  score: number;
} {
  let best = { index: 0, required: 0, optional: 0, score: -1 };
  rows.slice(0, 50).forEach((row, index) => {
    const score = scoreHeaderRow(row);
    if (score.score > best.score) best = { index, ...score };
  });
  return best;
}

function createHeaderSignature(headers: readonly string[]): string {
  return stableFingerprint(
    "supplier-catalogue-header",
    headers.map((header) => {
      const target = suggestSupplierCatalogueField(header);
      return `${normalized(header)}:${target}`;
    }),
  );
}

export function detectSupplierCatalogueTable(
  filename: string,
  sheets: Array<{ name: string; rows: unknown[][] }>,
): SupplierCatalogueImportTable {
  if (sheets.length === 0) {
    throw new Error("Filen innehåller inga läsbara blad.");
  }

  const candidates = sheets.map((sheet) => {
    const header = findHeaderRow(sheet.rows);
    const sheetBonus = /sortiment|pris|katalog|catalogue|produkt|artikel/i.test(sheet.name)
      ? 5
      : 0;
    return { sheet, header, total: header.score + sheetBonus };
  });
  candidates.sort((left, right) =>
    right.total - left.total
    || right.header.required - left.header.required
    || left.sheet.name.localeCompare(right.sheet.name, "sv-SE")
  );

  const selected = candidates[0];
  if (!selected || selected.header.required < 2) {
    throw new Error(
      "Hittade ingen tydlig rubrikrad. Minst två av artikelnummer, namn, "
      + "beställningsenhet och total mängd/enhet måste kunna identifieras.",
    );
  }

  const headerCells = selected.sheet.rows[selected.header.index] ?? [];
  const headers = headerCells.map(
    (cell, index) => compactValue(cell) || `Kolumn ${index + 1}`,
  );
  const dataRows = selected.sheet.rows
    .slice(selected.header.index + 1)
    .map((row, index) => ({
      row,
      rowNumber: selected.header.index + index + 2,
      headerScore: scoreHeaderRow(row),
    }))
    .filter(({ row }) => row.some((cell) => normalized(cell) !== ""))
    .filter(({ headerScore }) =>
      headerScore.required < Math.max(2, selected.header.required)
    );

  return {
    filename,
    sourceKind: filename.toLocaleLowerCase("sv-SE").endsWith(".csv") ? "csv" : "xlsx",
    sheetName: selected.sheet.name,
    headerRowIndex: selected.header.index,
    headers,
    headerSignature: createHeaderSignature(headers),
    rows: dataRows.map(({ row }) => row),
    rowNumbers: dataRows.map(({ rowNumber }) => rowNumber),
  };
}

export async function readSupplierCatalogueFile(
  file: File,
): Promise<SupplierCatalogueImportTable> {
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
    throw new Error("Välj en XLSX-, XLS- eller CSV-fil.");
  }

  const { read, utils } = await import("xlsx");
  const sourceKind = file.name.toLocaleLowerCase("sv-SE").endsWith(".csv")
    ? "csv"
    : "xlsx";
  const bytes = await file.arrayBuffer();
  const workbook = sourceKind === "csv"
    ? read(new TextDecoder("utf-8").decode(bytes), { type: "string", raw: true })
    : read(bytes, { type: "array", raw: false, cellDates: true });
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    rows: utils.sheet_to_json<unknown[]>(workbook.Sheets[name]!, {
      header: 1,
      defval: "",
      raw: sourceKind === "csv",
      dateNF: "yyyy-mm-dd",
    }),
  }));

  return detectSupplierCatalogueTable(file.name, sheets);
}

export function suggestedSupplierCatalogueMapping(
  table: SupplierCatalogueImportTable,
): SupplierCatalogueColumnMapping[] {
  return table.headers.map((source, index) => ({
    index,
    source,
    target: suggestSupplierCatalogueField(source),
  }));
}

export function validateSupplierCatalogueMapping(
  mapping: readonly SupplierCatalogueColumnMapping[],
): SupplierCatalogueImportIssue[] {
  const issues: SupplierCatalogueImportIssue[] = [];
  const mapped = new Map<SupplierCatalogueField, SupplierCatalogueColumnMapping[]>();

  for (const column of mapping) {
    if (column.target === "ignore") continue;
    const columns = mapped.get(column.target) ?? [];
    columns.push(column);
    mapped.set(column.target, columns);
  }

  for (const [field, columns] of mapped) {
    if (columns.length <= 1) continue;
    issues.push({
      severity: "error",
      code: "duplicate_mapping",
      field,
      message: `${supplierCatalogueFieldLabels[field]} har kopplats till flera kolumner: ${
        columns.map((column) => column.source).join(", ")
      }.`,
    });
  }

  for (const field of requiredDirectFields) {
    if (mapped.has(field)) continue;
    issues.push({
      severity: "error",
      code: "missing_mapping",
      field,
      message: `Koppla en kolumn till ${supplierCatalogueFieldLabels[field]}.`,
    });
  }

  const hasCombinedTotal = mapped.has("total_quantity");
  const hasSeparateTotal = mapped.has("total_amount") && mapped.has("total_unit");
  if (!hasCombinedTotal && !hasSeparateTotal) {
    issues.push({
      severity: "error",
      code: "missing_mapping",
      field: "total_quantity",
      message: "Koppla antingen Total mängd/enhet eller både Total mängd och Mängdenhet.",
    });
  }

  return issues;
}

function firstValue(
  row: unknown[],
  mapping: readonly SupplierCatalogueColumnMapping[],
  field: SupplierCatalogueField,
): unknown {
  const column = mapping.find((candidate) => candidate.target === field);
  return column ? row[column.index] : undefined;
}

function decimalFrom(value: unknown): Decimal | null {
  if (typeof value === "number") {
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal : null;
  }

  let source = compactValue(value)
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "")
    .replace(/(?:sek|kr)$/i, "");
  if (!source) return null;

  const commaIndex = source.lastIndexOf(",");
  const dotIndex = source.lastIndexOf(".");
  if (commaIndex >= 0 && dotIndex >= 0) {
    if (commaIndex > dotIndex) {
      source = source.replaceAll(".", "").replace(",", ".");
    } else {
      source = source.replaceAll(",", "");
    }
  } else if (commaIndex >= 0) {
    source = source.replace(",", ".");
  }

  if (!/^[+-]?\d+(?:\.\d+)?$/.test(source)) return null;
  try {
    const decimal = new Decimal(source);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

function parseTotalQuantity(
  row: unknown[],
  mapping: readonly SupplierCatalogueColumnMapping[],
): { amount: Decimal | null; unit: string; raw: string } {
  const separateAmountValue = firstValue(row, mapping, "total_amount");
  const separateUnit = compactValue(firstValue(row, mapping, "total_unit"));
  if (compactValue(separateAmountValue) || separateUnit) {
    return {
      amount: decimalFrom(separateAmountValue),
      unit: separateUnit,
      raw: `${compactValue(separateAmountValue)} ${separateUnit}`.trim(),
    };
  }

  const combined = compactValue(firstValue(row, mapping, "total_quantity"));
  const multiplication = combined.match(
    /^([+-]?\d+(?:[.,]\d+)?)\s*[x×*]\s*([+-]?\d+(?:[.,]\d+)?)\s*(\S.*)$/i,
  );
  if (multiplication) {
    const factor = decimalFrom(multiplication[1]);
    const amount = decimalFrom(multiplication[2]);
    return {
      amount: factor && amount ? factor.times(amount) : null,
      unit: compactValue(multiplication[3]),
      raw: combined,
    };
  }

  const direct = combined.match(/^([+-]?\d+(?:[.,]\d+)?)\s*(\S.*)$/);
  return {
    amount: direct ? decimalFrom(direct[1]) : null,
    unit: direct ? compactValue(direct[2]) : "",
    raw: combined,
  };
}

function normalizeGtin(value: unknown): { value: string | null; valid: boolean } {
  const raw = compactValue(value);
  if (!raw) return { value: null, valid: true };
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) {
    return { value: digits || raw, valid: false };
  }

  const body = digits.slice(0, -1);
  const expectedCheckDigit = Number(digits.at(-1));
  let sum = 0;
  for (let index = body.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += Number(body[index]) * (position % 2 === 0 ? 3 : 1);
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return {
    value: digits.padStart(14, "0"),
    valid: checkDigit === expectedCheckDigit,
  };
}

function isoDate(value: unknown): { value: string | null; valid: boolean } {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? { value: null, valid: false }
      : { value: value.toISOString().slice(0, 10), valid: true };
  }

  const raw = compactValue(value);
  if (!raw) return { value: null, valid: true };
  const isoMatch = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const SwedishMatch = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  const parts = isoMatch
    ? [isoMatch[1], isoMatch[2], isoMatch[3]]
    : SwedishMatch
      ? [SwedishMatch[3], SwedishMatch[2], SwedishMatch[1]]
      : null;
  if (!parts?.every(Boolean)) return { value: null, valid: false };

  const [year, month, day] = parts.map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  const valid = date.getUTCFullYear() === year
    && date.getUTCMonth() === month! - 1
    && date.getUTCDate() === day;
  return {
    value: valid
      ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${
        String(day).padStart(2, "0")
      }`
      : null,
    valid,
  };
}

function catchWeightValue(value: unknown): { value: boolean | null; valid: boolean } {
  const raw = normalized(value);
  if (!raw) return { value: null, valid: true };
  if (["ja", "yes", "true", "1", "viktvara", "variabel vikt"].includes(raw)) {
    return { value: true, valid: true };
  }
  if (["nej", "no", "false", "0", "fast vikt", "ej viktvara"].includes(raw)) {
    return { value: false, valid: true };
  }
  return { value: null, valid: false };
}

function issue(
  severity: SupplierCatalogueImportIssue["severity"],
  code: SupplierCatalogueIssueCode,
  message: string,
  sourceRow: number,
  field?: SupplierCatalogueField,
): SupplierCatalogueImportIssue {
  return { severity, code, message, sourceRow, ...(field ? { field } : {}) };
}

function rowStatus(issues: readonly SupplierCatalogueImportIssue[]): SupplierCatalogueRowStatus {
  if (issues.some((candidate) => candidate.severity === "error")) return "blocked";
  if (issues.some((candidate) => candidate.severity === "warning")) return "ambiguous";
  return "safe";
}

function withIssues(
  row: SupplierCataloguePreviewRow,
  additions: readonly SupplierCatalogueImportIssue[],
): SupplierCataloguePreviewRow {
  const issues = [...row.issues, ...additions];
  return { ...row, status: rowStatus(issues), issues };
}

function buildRow(
  rawRow: unknown[],
  sourceRow: number,
  mapping: readonly SupplierCatalogueColumnMapping[],
): SupplierCataloguePreviewRow {
  const supplierArticleNumber = compactValue(
    firstValue(rawRow, mapping, "supplier_article_number"),
  );
  const displayName = compactValue(firstValue(rawRow, mapping, "display_name"));
  const purchaseUnit = compactValue(firstValue(rawRow, mapping, "purchase_unit"));
  const total = parseTotalQuantity(rawRow, mapping);
  const gtin = normalizeGtin(firstValue(rawRow, mapping, "gtin"));
  const rawPrice = firstValue(rawRow, mapping, "price");
  const price = decimalFrom(rawPrice);
  const rawMinimumOrder = firstValue(rawRow, mapping, "minimum_order_units");
  const minimumOrder = decimalFrom(rawMinimumOrder);
  const rawInnerUnitCount = firstValue(rawRow, mapping, "inner_unit_count");
  const innerUnitCount = decimalFrom(rawInnerUnitCount);
  const innerUnitLabel = compactValue(
    firstValue(rawRow, mapping, "inner_unit_label"),
  ) || null;
  const validFrom = isoDate(firstValue(rawRow, mapping, "valid_from"));
  const validTo = isoDate(firstValue(rawRow, mapping, "valid_to"));
  const catchWeight = catchWeightValue(firstValue(rawRow, mapping, "catch_weight"));
  const category = compactValue(firstValue(rawRow, mapping, "category")) || null;
  const brand = compactValue(firstValue(rawRow, mapping, "brand")) || null;
  const issues: SupplierCatalogueImportIssue[] = [];

  for (const [field, label, value, maxLength] of [
    ["supplier_article_number", "Artikelnummer", supplierArticleNumber, 120],
    ["display_name", "Artikelnamn", displayName, 240],
    ["purchase_unit", "Beställningsenhet", purchaseUnit, 80],
    ["total_unit", "Mängdenhet", total.unit, 80],
  ] as const) {
    if (!value) {
      issues.push(issue(
        "error",
        "missing_required_value",
        `${label} saknas på rad ${sourceRow}.`,
        sourceRow,
        field,
      ));
    } else if (value.length > maxLength) {
      issues.push(issue(
        "error",
        "value_too_long",
        `${label} är längre än ${maxLength} tecken på rad ${sourceRow}.`,
        sourceRow,
        field,
      ));
    }
  }

  if (!total.amount || !total.amount.greaterThan(0)) {
    issues.push(issue(
      "error",
      "invalid_total_quantity",
      `Total mängd måste vara ett positivt tal med enhet på rad ${sourceRow}, till exempel "6 kg".`,
      sourceRow,
      "total_quantity",
    ));
  }

  if (!gtin.valid) {
    issues.push(issue(
      "error",
      "invalid_gtin",
      `GTIN har ogiltig längd eller kontrollsiffra på rad ${sourceRow}.`,
      sourceRow,
      "gtin",
    ));
  } else if (!gtin.value) {
    issues.push(issue(
      "warning",
      "missing_gtin",
      `GTIN saknas på rad ${sourceRow}; artikeln måste matchas manuellt.`,
      sourceRow,
      "gtin",
    ));
  }

  if (compactValue(rawPrice) && (!price || price.isNegative())) {
    issues.push(issue(
      "error",
      "invalid_price",
      `Pris måste vara noll eller ett positivt tal på rad ${sourceRow}.`,
      sourceRow,
      "price",
    ));
  }

  if (
    compactValue(rawMinimumOrder)
    && (
      !minimumOrder
      || !minimumOrder.isInteger()
      || !minimumOrder.greaterThan(0)
      || minimumOrder.greaterThan(Number.MAX_SAFE_INTEGER)
    )
  ) {
    issues.push(issue(
      "error",
      "invalid_minimum_order",
      `Minsta beställning måste vara ett positivt heltal på rad ${sourceRow}.`,
      sourceRow,
      "minimum_order_units",
    ));
  }

  if (
    compactValue(rawInnerUnitCount)
    && (
      !innerUnitCount
      || !innerUnitCount.isInteger()
      || !innerUnitCount.greaterThan(0)
      || innerUnitCount.greaterThan(Number.MAX_SAFE_INTEGER)
    )
  ) {
    issues.push(issue(
      "error",
      "invalid_inner_unit_count",
      `Antal innerförpackningar måste vara ett positivt heltal på rad ${sourceRow}.`,
      sourceRow,
      "inner_unit_count",
    ));
  }
  if (Boolean(compactValue(rawInnerUnitCount)) !== Boolean(innerUnitLabel)) {
    issues.push(issue(
      "warning",
      "incomplete_inner_packaging",
      `Ange både antal och namn för innerförpackningen på rad ${sourceRow}, till exempel "6" och "burkar".`,
      sourceRow,
      compactValue(rawInnerUnitCount) ? "inner_unit_label" : "inner_unit_count",
    ));
  }
  if (innerUnitLabel && innerUnitLabel.length > 80) {
    issues.push(issue(
      "error",
      "value_too_long",
      `Innerförpackning är längre än 80 tecken på rad ${sourceRow}.`,
      sourceRow,
      "inner_unit_label",
    ));
  }

  if (!validFrom.valid) {
    issues.push(issue(
      "error",
      "invalid_date",
      `Gäller från har ett ogiltigt datum på rad ${sourceRow}.`,
      sourceRow,
      "valid_from",
    ));
  }
  if (!validTo.valid) {
    issues.push(issue(
      "error",
      "invalid_date",
      `Gäller till har ett ogiltigt datum på rad ${sourceRow}.`,
      sourceRow,
      "valid_to",
    ));
  }
  if (validFrom.value && validTo.value && validTo.value < validFrom.value) {
    issues.push(issue(
      "error",
      "invalid_validity_period",
      `Gäller till ligger före Gäller från på rad ${sourceRow}.`,
      sourceRow,
      "valid_to",
    ));
  }

  if (!catchWeight.valid) {
    issues.push(issue(
      "error",
      "invalid_catch_weight",
      `Viktvara måste anges som ja eller nej på rad ${sourceRow}.`,
      sourceRow,
      "catch_weight",
    ));
  } else if (catchWeight.value) {
    issues.push(issue(
      "warning",
      "catch_weight_requires_review",
      `Rad ${sourceRow} är en viktvara; kontrollera mängd och prisgrund manuellt.`,
      sourceRow,
      "catch_weight",
    ));
  }

  const canonicalParts = [
    normalized(supplierArticleNumber),
    normalized(displayName),
    normalized(purchaseUnit),
    total.amount?.toString() ?? `invalid:${normalized(total.raw)}`,
    normalized(total.unit),
    gtin.valid ? (gtin.value ?? "") : `invalid:${normalized(gtin.value)}`,
    price?.toString() ?? (compactValue(rawPrice) ? `invalid:${normalized(rawPrice)}` : ""),
    minimumOrder?.toString()
      ?? (compactValue(rawMinimumOrder) ? `invalid:${normalized(rawMinimumOrder)}` : ""),
    innerUnitCount?.toString()
      ?? (
        compactValue(rawInnerUnitCount)
          ? `invalid:${normalized(rawInnerUnitCount)}`
          : ""
      ),
    normalized(innerUnitLabel),
    validFrom.valid
      ? (validFrom.value ?? "")
      : `invalid:${normalized(firstValue(rawRow, mapping, "valid_from"))}`,
    validTo.valid
      ? (validTo.value ?? "")
      : `invalid:${normalized(firstValue(rawRow, mapping, "valid_to"))}`,
    normalized(category),
    normalized(brand),
    catchWeight.valid
      ? String(catchWeight.value ?? "")
      : `invalid:${normalized(firstValue(rawRow, mapping, "catch_weight"))}`,
  ];
  const rowFingerprint = stableFingerprint("supplier-catalogue-row", canonicalParts);

  return {
    id: `source-row-${sourceRow}`,
    sourceRow,
    status: rowStatus(issues),
    supplierArticleNumber,
    displayName,
    purchaseUnit,
    totalAmount: total.amount?.toNumber() ?? null,
    totalUnit: total.unit,
    gtin: gtin.valid ? gtin.value : null,
    price: price?.toNumber() ?? null,
    minimumOrderUnits: minimumOrder?.toNumber() ?? null,
    innerUnitCount: innerUnitCount?.toNumber() ?? null,
    innerUnitLabel,
    validFrom: validFrom.value,
    validTo: validTo.value,
    category,
    brand,
    catchWeight: catchWeight.value,
    rowFingerprint,
    issues,
  };
}

function addDuplicateIssues(
  rows: readonly SupplierCataloguePreviewRow[],
): SupplierCataloguePreviewRow[] {
  const additions = new Map<number, SupplierCatalogueImportIssue[]>();
  const byArticleNumber = new Map<string, SupplierCataloguePreviewRow[]>();
  const byGtin = new Map<string, SupplierCataloguePreviewRow[]>();

  for (const row of rows) {
    const articleKey = normalized(row.supplierArticleNumber);
    if (articleKey) {
      const matching = byArticleNumber.get(articleKey) ?? [];
      matching.push(row);
      byArticleNumber.set(articleKey, matching);
    }
    if (row.gtin) {
      const matching = byGtin.get(row.gtin) ?? [];
      matching.push(row);
      byGtin.set(row.gtin, matching);
    }
  }

  const add = (row: SupplierCataloguePreviewRow, newIssue: SupplierCatalogueImportIssue) => {
    const rowAdditions = additions.get(row.sourceRow) ?? [];
    rowAdditions.push(newIssue);
    additions.set(row.sourceRow, rowAdditions);
  };

  for (const duplicates of byArticleNumber.values()) {
    if (duplicates.length <= 1) continue;
    const fingerprints = new Set(duplicates.map((row) => row.rowFingerprint));
    for (const row of duplicates) {
      add(
        row,
        issue(
          fingerprints.size === 1 ? "warning" : "error",
          fingerprints.size === 1 ? "duplicate_row" : "duplicate_article_number",
          fingerprints.size === 1
            ? `Rad ${row.sourceRow} är en exakt dubblett av samma artikelnummer.`
            : `Artikelnummer ${row.supplierArticleNumber} förekommer med olika innehåll.`,
          row.sourceRow,
          "supplier_article_number",
        ),
      );
    }
  }

  for (const duplicates of byGtin.values()) {
    const articleNumbers = new Set(
      duplicates.map((row) => normalized(row.supplierArticleNumber)),
    );
    if (articleNumbers.size <= 1) continue;
    for (const row of duplicates) {
      add(
        row,
        issue(
          "warning",
          "duplicate_gtin",
          `GTIN ${row.gtin} förekommer på flera artikelnummer och måste granskas.`,
          row.sourceRow,
          "gtin",
        ),
      );
    }
  }

  return rows.map((row) => withIssues(row, additions.get(row.sourceRow) ?? []));
}

export function buildSupplierCataloguePreview(
  table: SupplierCatalogueImportTable,
  mapping: readonly SupplierCatalogueColumnMapping[] = suggestedSupplierCatalogueMapping(table),
): SupplierCataloguePreview {
  const mappingIssues = validateSupplierCatalogueMapping(mapping);
  const rows = addDuplicateIssues(table.rows.map((rawRow, index) =>
    buildRow(
      rawRow,
      table.rowNumbers[index] ?? table.headerRowIndex + index + 2,
      mapping,
    )
  ));

  return {
    filename: table.filename,
    sheetName: table.sheetName,
    headerSignature: table.headerSignature,
    mappingIssues,
    rows,
    safeCount: rows.filter((row) => row.status === "safe").length,
    ambiguousCount: rows.filter((row) => row.status === "ambiguous").length,
    blockedCount: rows.filter((row) => row.status === "blocked").length,
  };
}
