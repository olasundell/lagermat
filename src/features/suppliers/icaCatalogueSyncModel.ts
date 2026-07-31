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
}

export interface IcaCatalogueUnmatchedItems {
  pending: SupplyItemRow[];
  noMatch: SupplyItemRow[];
}

function queryKey(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("sv-SE");
}

export function splitIcaUnmatchedItems(
  items: readonly SupplyItemRow[],
  progress: IcaCatalogueSyncProgress | null | undefined,
  loading: boolean,
): IcaCatalogueUnmatchedItems {
  if (!progress) {
    return loading
      ? { pending: [...items], noMatch: [] }
      : { pending: [], noMatch: [...items] };
  }

  if (progress.phase === "complete") {
    return { pending: [], noMatch: [...items] };
  }

  const completed = new Set(progress.completedQueries.map(queryKey));
  const pending: SupplyItemRow[] = [];
  const noMatch: SupplyItemRow[] = [];
  for (const item of items) {
    (completed.has(queryKey(item.item_name)) ? noMatch : pending).push(item);
  }
  return { pending, noMatch };
}
