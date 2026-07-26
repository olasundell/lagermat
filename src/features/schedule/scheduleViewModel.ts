export interface ScheduleReadiness {
  meal_plan_confirmed: boolean;
  required_slots: number;
  planned_slots: number;
  unplanned_slots: number;
  no_service_slots: number;
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

export function scheduleIssueParts(readiness: ScheduleReadiness | null): string[] {
  if (!readiness) return [];
  return [
    !readiness.meal_plan_confirmed ? "bekräfta lägrets måltidstillfällen" : null,
    readiness.unplanned_slots ? `${readiness.unplanned_slots} ${readiness.unplanned_slots === 1 ? "måltidstillfälle är oplanerat" : "måltidstillfällen är oplanerade"}` : null,
    readiness?.unresolved_dietary_needs ? `${readiness.unresolved_dietary_needs} ${readiness.unresolved_dietary_needs === 1 ? "specialkostuppgift" : "specialkostuppgifter"}` : null,
    readiness?.meals_without_recipe ? `${readiness.meals_without_recipe} ${readiness.meals_without_recipe === 1 ? "måltid saknar" : "måltider saknar"} recept` : null,
    readiness.calculation_stale && readiness.planned_slots > 0 ? "beräkningen saknas eller är inaktuell" : null
  ].filter((value): value is string => Boolean(value));
}

export function inclusiveCampDates(startsOn: string, endsOn: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${startsOn}T12:00:00Z`);
  const end = new Date(`${endsOn}T12:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}
