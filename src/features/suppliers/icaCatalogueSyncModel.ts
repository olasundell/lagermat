import type { SupplyItemRow } from "../supplies/supplyModel";

export type IcaCatalogueSyncPhase =
  | "syncing"
  | "rate_limited"
  | "complete"
  | "error";

export interface IcaCatalogueSyncProgress {
  phase: IcaCatalogueSyncPhase;
  completedQueries: string[];
  totalQueries: number;
  retryAfterMs: number | null;
  retryAt: number | null;
  lastAttemptedAt: number | null;
  syntheticLocalFixture?: boolean;
}

export interface IcaCatalogueUnmatchedItems {
  pending: SupplyItemRow[];
  noMatch: SupplyItemRow[];
  failed: SupplyItemRow[];
}

export function normaliseIcaCatalogueQuery(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function icaCatalogueQueryKey(value: string): string {
  return normaliseIcaCatalogueQuery(value).toLocaleLowerCase("sv-SE");
}

export function countDistinctIcaCatalogueQueries(
  items: readonly SupplyItemRow[],
): number {
  return new Set(items
    .map((item) => icaCatalogueQueryKey(item.item_name))
    .filter((query) => query.length >= 2)).size;
}

export function splitIcaUnmatchedItems(
  items: readonly SupplyItemRow[],
  progress: IcaCatalogueSyncProgress | null | undefined,
  loading: boolean,
): IcaCatalogueUnmatchedItems {
  if (!progress) {
    return loading
      ? { pending: [...items], noMatch: [], failed: [] }
      : { pending: [], noMatch: [...items], failed: [] };
  }

  if (progress.phase === "error") {
    const completed = new Set(progress.completedQueries.map(icaCatalogueQueryKey));
    const noMatch: SupplyItemRow[] = [];
    const failed: SupplyItemRow[] = [];
    for (const item of items) {
      const key = icaCatalogueQueryKey(item.item_name);
      (key.length < 2 || completed.has(key) ? noMatch : failed).push(item);
    }
    return { pending: [], noMatch, failed };
  }

  if (progress.phase === "complete") {
    return { pending: [], noMatch: [...items], failed: [] };
  }

  const completed = new Set(progress.completedQueries.map(icaCatalogueQueryKey));
  const pending: SupplyItemRow[] = [];
  const noMatch: SupplyItemRow[] = [];
  for (const item of items) {
    const key = icaCatalogueQueryKey(item.item_name);
    (key.length < 2 || completed.has(key) ? noMatch : pending).push(item);
  }
  return { pending, noMatch, failed: [] };
}
