export interface ScheduleReadiness {
  unresolved_dietary_needs: number;
  meals_without_recipe: number;
  calculation_stale: boolean;
  can_finalize: boolean;
}

export function emptyReserveDrafts<T>(): T[] {
  return [];
}

export function visibleReserves<T extends { portions: number }>(reserves: T[]): T[] {
  return reserves.filter((reserve) => reserve.portions > 0);
}

export function scheduleCalculationLabel(hasRevision: boolean, mealCount: number): string | null {
  if (mealCount === 0) return null;
  return hasRevision ? "mängderna är uträknade" : "mängderna är inte uträknade";
}

export function scheduleIssueParts(readiness: ScheduleReadiness | null, mealCount: number): string[] {
  if (mealCount === 0) return [];
  return [
    readiness?.unresolved_dietary_needs ? `${readiness.unresolved_dietary_needs} ${readiness.unresolved_dietary_needs === 1 ? "specialkostuppgift" : "specialkostuppgifter"}` : null,
    readiness?.meals_without_recipe ? `${readiness.meals_without_recipe} ${readiness.meals_without_recipe === 1 ? "måltid saknar" : "måltider saknar"} recept` : null,
    readiness?.calculation_stale ? "beräkningen är inaktuell" : null
  ].filter((value): value is string => Boolean(value));
}
