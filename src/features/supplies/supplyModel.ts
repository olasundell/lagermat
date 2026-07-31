import Decimal from "decimal.js";

export type SupplyListKind = "purchase" | "distribution" | "delivery";
export type SupplyListStatus = "draft" | "active" | "complete";

export interface SupplyItemRow {
  id: string;
  item_key: string;
  canonical_key: string;
  category: string;
  item_name: string;
  required_amount: number;
  required_unit: string;
  ordered_amount: number | null;
  ordered_unit: string | null;
  package_note: string | null;
  comment: string | null;
  completed: boolean;
  row_version: number;
  source_present: boolean;
  manually_moved: boolean;
  order_source_kind?: "manual" | "supplier_purchase" | null;
  supplier_order_source_item_id?: string | null;
  supplier_order_account_id?: string | null;
  supplier_order_product_id?: string | null;
  supplier_order_total_units?: number | null;
  supplier_order_product_fingerprint?: string | null;
}

export interface SupplyListRow {
  id: string;
  list_key: string;
  kind: SupplyListKind;
  status: SupplyListStatus;
  title: string;
  range_start: string | null;
  range_end: string | null;
  version: number;
  source_present: boolean;
  calculation_revisions: { revision_number: number; status: string } | null;
  supply_list_items: SupplyItemRow[];
}

export type SupplyFilter = "all" | "remaining" | "done";

export interface PracticalSupplyAmount {
  amount: string;
  unit: string;
  display: string;
  rounded: boolean;
  issue: "purchase_packaging_unit" | null;
}

const WHOLE_ITEM_UNITS = new Set([
  "blad",
  "klyfta",
  "klyftor",
  "kruka",
  "krukor",
  "st",
  "styck",
  "stycken",
  "skiva",
  "skivor",
  "tärning",
  "tärningar",
  "portion",
  "portioner",
]);

const PURCHASE_PACKAGING_UNITS = new Set([
  "ask",
  "askar",
  "burk",
  "burkar",
  "flaska",
  "flaskor",
  "förpackning",
  "förpackningar",
  "kartong",
  "kartonger",
  "kolli",
  "paket",
  "påse",
  "påsar",
  "rulle",
  "rullar",
  "säck",
  "säckar",
  "tub",
  "tuber",
]);

export function formatExactAmount(value: number | string): string {
  const source = String(value);
  if (/e/i.test(source)) {
    return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 12, useGrouping: false }).format(Number(value));
  }
  const [whole = "0", decimals = ""] = source.split(".");
  const significantDecimals = decimals.replace(/0+$/, "");
  return significantDecimals ? `${whole},${significantDecimals}` : whole;
}

export function countedUnitLabel(
  rawUnit: string,
  value: number | string,
): string {
  const unit = rawUnit.trim();
  let amount: Decimal;
  try {
    amount = new Decimal(value);
  } catch {
    return unit;
  }
  if (!amount.isFinite() || amount.abs().equals(1)) return unit;

  const plurals: Record<string, string> = {
    ask: "askar",
    burk: "burkar",
    flaska: "flaskor",
    förpackning: "förpackningar",
    kartong: "kartonger",
    påse: "påsar",
    rulle: "rullar",
    styck: "stycken",
    stycke: "stycken",
    säck: "säckar",
    tub: "tuber",
  };
  return plurals[normalizedUnit(unit)] ?? unit;
}

export function formatCountedAmount(
  value: number | string,
  unit: string,
): string {
  return `${formatExactAmount(value)} ${countedUnitLabel(unit, value)}`.trim();
}

function normalizedUnit(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("sv-SE");
}

function finitePositiveDecimal(value: number | string): Decimal | null {
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() && parsed.greaterThan(0) ? parsed : null;
  } catch {
    return null;
  }
}

function practicalStep(unit: string): Decimal {
  if (WHOLE_ITEM_UNITS.has(unit)) return new Decimal(1);
  if (unit === "kg") return new Decimal("0.01");
  if (unit === "g") return new Decimal(1);
  if (unit === "hg") return new Decimal("0.1");
  if (unit === "l") return new Decimal("0.5");
  if (unit === "dl") return new Decimal("0.1");
  if (unit === "cl") return new Decimal("0.5");
  if (unit === "ml") return new Decimal(5);
  if (unit === "msk" || unit === "tsk") return new Decimal("0.5");
  return new Decimal("0.1");
}

function formattedPracticalAmount(
  value: Decimal,
  unit: string,
  exactValue: Decimal,
): PracticalSupplyAmount {
  const displayValue = unit === "kg" && value.lessThan(1)
    ? value.times(1000)
    : value;
  const displayUnit = unit === "kg" && value.lessThan(1) ? "g" : unit;
  const amount = formatExactAmount(displayValue.toString());
  return {
    amount,
    unit: displayUnit,
    display: `${amount} ${displayUnit}`,
    rounded: !value.equals(exactValue),
    issue: null,
  };
}

export function isPurchasePackagingUnit(rawUnit: string): boolean {
  return PURCHASE_PACKAGING_UNITS.has(normalizedUnit(rawUnit));
}

export function practicalSupplyAmount(
  value: number | string,
  rawUnit: string,
): PracticalSupplyAmount {
  const unit = normalizedUnit(rawUnit);
  if (isPurchasePackagingUnit(unit)) {
    return {
      amount: "Ange vikt, volym eller antal i receptet",
      unit: "",
      display: "Ange vikt, volym eller antal i receptet",
      rounded: false,
      issue: "purchase_packaging_unit",
    };
  }

  const exactValue = finitePositiveDecimal(value);
  if (!exactValue) {
    const amount = formatExactAmount(value);
    return {
      amount,
      unit,
      display: `${amount} ${unit}`.trim(),
      rounded: false,
      issue: null,
    };
  }

  const step = practicalStep(unit);
  const roundedValue = exactValue.dividedBy(step).ceil().times(step);
  return formattedPracticalAmount(roundedValue, unit, exactValue);
}

export function parseDecimalInput(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

export function hasUnitMismatch(item: Pick<SupplyItemRow, "ordered_amount" | "ordered_unit" | "required_unit">): boolean {
  return item.ordered_amount !== null
    && Boolean(item.ordered_unit)
    && item.ordered_unit?.trim().toLocaleLowerCase("sv-SE") !== item.required_unit.trim().toLocaleLowerCase("sv-SE");
}

export function filterSupplyItems(items: SupplyItemRow[], filter: SupplyFilter, query: string): SupplyItemRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("sv-SE");
  return items.filter((item) => {
    const matchesQuery = !normalizedQuery || item.item_name.toLocaleLowerCase("sv-SE").includes(normalizedQuery);
    const matchesFilter = filter === "all" || (filter === "done" ? item.completed : !item.completed);
    return matchesQuery && matchesFilter;
  });
}

export function groupSupplyItems(items: SupplyItemRow[]): Map<string, SupplyItemRow[]> {
  const groups = new Map<string, SupplyItemRow[]>();
  for (const item of items) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
  return groups;
}
