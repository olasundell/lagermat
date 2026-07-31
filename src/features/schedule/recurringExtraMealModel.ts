export interface RecurringMealSlot {
  id: string;
  service_date: string;
  starts_at: string;
  meal_type: string;
  service_status: "required" | "no_service";
}

export interface RecurringExtraMealPreviewInput {
  dates: string[];
  mealType: string;
  time: string;
  slots: RecurringMealSlot[];
  plannedSlotIds: ReadonlySet<string>;
  timeForSlot: (slot: RecurringMealSlot) => string;
}

export interface RecurringExtraMealPreviewRow {
  date: string;
  state: "new" | "reuse" | "conflict";
  reason?: string;
}

/**
 * Gives the planner a truthful preview before the server atomically creates
 * the selected extra meals. The server remains authoritative for conflicts.
 */
export function recurringExtraMealPreview(
  input: RecurringExtraMealPreviewInput,
): RecurringExtraMealPreviewRow[] {
  return [...new Set(input.dates)].sort().map((date) => {
    const matchingSlot = input.slots.find((slot) =>
      slot.service_date === date
      && slot.meal_type === input.mealType
      && input.timeForSlot(slot) === input.time,
    );
    if (!matchingSlot) return { date, state: "new" };
    if (matchingSlot.service_status === "no_service") {
      return {
        date,
        state: "conflict",
        reason: "Tillfället är markerat som ingen servering.",
      };
    }
    if (input.plannedSlotIds.has(matchingSlot.id)) {
      return {
        date,
        state: "conflict",
        reason: "En måltid är redan planerad vid den här tiden.",
      };
    }
    return { date, state: "reuse" };
  });
}
