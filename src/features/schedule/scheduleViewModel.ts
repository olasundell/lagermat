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

export type ScheduleNextActionKind =
  | "confirm_meal_plan"
  | "plan_meal_slot"
  | "review_dietary_needs"
  | "choose_meal_recipe"
  | "calculate";

export interface ScheduleNextAction {
  kind: ScheduleNextActionKind;
  title: string;
  description: string;
  label: string;
}

export function scheduleNextAction(readiness: ScheduleReadiness | null): ScheduleNextAction | null {
  if (!readiness) return null;
  if (!readiness.meal_plan_confirmed) {
    return {
      kind: "confirm_meal_plan",
      title: "Måltidstillfällena behöver skapas",
      description: "Skapa lägrets frukostar, luncher och middagar innan du fortsätter.",
      label: "Skapa måltidstillfällen"
    };
  }
  if (readiness.unplanned_slots > 0) {
    return {
      kind: "plan_meal_slot",
      title: `${readiness.unplanned_slots} ${readiness.unplanned_slots === 1 ? "måltidstillfälle är oplanerat" : "måltidstillfällen är oplanerade"}`,
      description: "Planera en måltid eller markera att ingen servering sker.",
      label: readiness.unplanned_slots === 1 ? "Planera tillfället" : "Planera måltiderna"
    };
  }
  if (readiness.unresolved_dietary_needs > 0) {
    return {
      kind: "review_dietary_needs",
      title: `${readiness.unresolved_dietary_needs} ${readiness.unresolved_dietary_needs === 1 ? "specialkostuppgift behöver" : "specialkostuppgifter behöver"} granskas`,
      description: "Kontrollera uppgiften från anmälan och välj vad köket ska ta hänsyn till.",
      label: "Granska specialkost"
    };
  }
  if (readiness.meals_without_recipe > 0) {
    return {
      kind: "choose_meal_recipe",
      title: `${readiness.meals_without_recipe} ${readiness.meals_without_recipe === 1 ? "måltid saknar" : "måltider saknar"} recept`,
      description: "Öppna måltiden och välj vilket recept köket ska laga.",
      label: "Välj recept"
    };
  }
  if (readiness.calculation_stale && readiness.planned_slots > 0) {
    return {
      kind: "calculate",
      title: "Mängderna behöver räknas om",
      description: "Matsedeln eller specialkosten har ändrats sedan den senaste beräkningen.",
      label: "Räkna om mängder"
    };
  }
  return null;
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
