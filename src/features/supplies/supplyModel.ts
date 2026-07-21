export type SupplyListKind = "purchase" | "distribution" | "delivery";
export type SupplyListStatus = "draft" | "active" | "complete";

export interface SupplyItemRow {
  id: string;
  item_key: string;
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

export function formatExactAmount(value: number | string): string {
  const source = String(value);
  if (/e/i.test(source)) {
    return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 12, useGrouping: false }).format(Number(value));
  }
  const [whole = "0", decimals = ""] = source.split(".");
  const significantDecimals = decimals.replace(/0+$/, "");
  return significantDecimals ? `${whole},${significantDecimals}` : whole;
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
