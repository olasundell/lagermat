export interface SpecialDietSummary {
  kind: "empty" | "clear" | "warning";
  heading: string;
  detail: string;
  reviewMessage: string;
}

export function specialDietSummary(total: number, unresolved: number, calculationStale = false): SpecialDietSummary {
  if (total === 0) {
    return {
      kind: "empty",
      heading: "Ingen specialkost registrerad",
      detail: "Det finns inga uppgifter att granska för lägret.",
      reviewMessage: "Inga specialkostuppgifter finns för lägret."
    };
  }
  if (unresolved === 0) {
    return {
      kind: "clear",
      heading: "All specialkost är granskad",
      detail: calculationStale ? "Räkna om mängderna efter granskningen" : "Redo att användas i beräkningen",
      reviewMessage: "All specialkost är granskad."
    };
  }
  return {
    kind: "warning",
    heading: `${unresolved} deltagare har specialkost kvar att granska`,
    detail: calculationStale ? "Räkna om mängderna när granskningen är klar" : "Granska uppgifterna före beräkning",
    reviewMessage: `${unresolved} ${unresolved === 1 ? "uppgift behöver" : "uppgifter behöver"} granskas.`
  };
}
