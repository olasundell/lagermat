import type { SupplyListRow } from "../supplies/supplyModel";

export interface DistributionListOption {
  list: SupplyListRow;
  label: string;
}

function dateTimeLabel(value: string | null, timeZone: string): string {
  if (!value) return "Datum saknas";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Datum saknas";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function timestamp(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

export function createDistributionListOptions(
  lists: readonly SupplyListRow[],
  timeZone: string,
): DistributionListOption[] {
  const ordered = lists
    .filter((list) => list.kind === "distribution");
  ordered.sort((left, right) =>
      timestamp(left.range_start) - timestamp(right.range_start)
      || left.title.localeCompare(right.title, "sv-SE")
      || left.list_key.localeCompare(right.list_key, "sv-SE")
  );
  const baseLabels = ordered.map((list) =>
    `${dateTimeLabel(list.range_start, timeZone)} · ${list.title}`
  );
  const counts = new Map<string, number>();
  for (const label of baseLabels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const occurrences = new Map<string, number>();

  return ordered.map((list, index) => {
    const baseLabel = baseLabels[index]!;
    const occurrence = (occurrences.get(baseLabel) ?? 0) + 1;
    occurrences.set(baseLabel, occurrence);
    return {
      list,
      label: counts.get(baseLabel) === 1
        ? baseLabel
        : `${baseLabel} · alternativ ${occurrence}`,
    };
  });
}
