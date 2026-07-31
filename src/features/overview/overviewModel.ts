export interface OverviewCounts {
  participants: number;
  unresolvedDiets: number;
  recipeCopies: number;
  meals: number;
  mealPlanConfirmed: boolean;
  requiredSlots: number;
  plannedSlots: number;
  unplannedSlots: number;
  zeroAttendanceSlots: number;
  noServiceSlots: number;
  missingRecipes: number;
  calculationStale: boolean;
  canFinalize: boolean;
  supplierItemsTotal: number;
  supplierReadyItems: number;
  supplierSafeSuggestions: number;
  supplierReviewSuggestions: number;
  supplierPendingItems: number;
  supplierNoMatchItems: number;
  supplierOrderIncompleteItems: number;
  supplierUnresolvedItems: number;
  procurementReady: boolean;
  deliveries: number;
}

export interface OverviewDeliveryRow {
  id: string;
  title: string;
  rangeStart: string | null;
  status: "draft" | "active" | "complete";
  items: Array<{ completed: boolean; sourcePresent: boolean }>;
}

export interface OverviewDeliveryProgress {
  complete: number;
  total: number;
  current: {
    id: string;
    title: string;
    rangeStart: string | null;
    doneItems: number;
    totalItems: number;
  } | null;
  next: {
    id: string;
    title: string;
    rangeStart: string | null;
  } | null;
  blockers: string[];
  to: "/leveranser";
}

interface OverviewNextAction {
  title: string;
  description: string;
  label: string;
  note: string;
  to: "/deltagare" | "/specialkost" | "/recept" | "/matsedel" | "/inkop" | "/leveranser";
}

function sortedDeliveries(deliveries: OverviewDeliveryRow[]): OverviewDeliveryRow[] {
  return [...deliveries].sort((left, right) => {
    if (left.rangeStart && right.rangeStart) {
      const byDate = left.rangeStart.localeCompare(right.rangeStart);
      if (byDate) return byDate;
    } else if (left.rangeStart) {
      return -1;
    } else if (right.rangeStart) {
      return 1;
    }
    return left.title.localeCompare(right.title, "sv") || left.id.localeCompare(right.id);
  });
}

function supplierBlockers(counts: OverviewCounts): string[] {
  const blockers: string[] = [];
  if (counts.supplierPendingItems > 0) {
    blockers.push(counts.supplierPendingItems === 1
      ? "Scoutmat söker fortfarande efter 1 råvara hos ICA"
      : `Scoutmat söker fortfarande efter ${counts.supplierPendingItems} råvaror hos ICA`);
  }
  if (counts.supplierSafeSuggestions > 0) {
    blockers.push(counts.supplierSafeSuggestions === 1
      ? "1 säkert ICA-förslag behöver godkännas"
      : `${counts.supplierSafeSuggestions} säkra ICA-förslag behöver godkännas`);
  }
  if (counts.supplierReviewSuggestions > 0) {
    blockers.push(counts.supplierReviewSuggestions === 1
      ? "1 ICA-träff behöver granskas"
      : `${counts.supplierReviewSuggestions} ICA-träffar behöver granskas`);
  }
  if (counts.supplierNoMatchItems > 0) {
    blockers.push(counts.supplierNoMatchItems === 1
      ? "1 råvara saknar ICA-träff"
      : `${counts.supplierNoMatchItems} råvaror saknar ICA-träff`);
  }
  if (counts.supplierOrderIncompleteItems > 0) {
    blockers.push(counts.supplierOrderIncompleteItems === 1
      ? "1 godkänd ICA-artikel saknar köpantal"
      : `${counts.supplierOrderIncompleteItems} godkända ICA-artiklar saknar köpantal`);
  }
  if (counts.supplierUnresolvedItems > 0 && blockers.length === 0) {
    blockers.push(counts.supplierUnresolvedItems === 1
      ? "1 råvara återstår i inköpsunderlaget"
      : `${counts.supplierUnresolvedItems} råvaror återstår i inköpsunderlaget`);
  }
  return blockers;
}

export function overviewDeliveryProgress(
  deliveries: OverviewDeliveryRow[],
  counts: OverviewCounts,
): OverviewDeliveryProgress {
  const sorted = sortedDeliveries(deliveries);
  const unfinished = sorted.filter((delivery) => delivery.status !== "complete");
  const currentDelivery = unfinished[0] ?? null;
  const currentItems = currentDelivery?.items.filter((item) => item.sourcePresent) ?? [];
  const doneItems = currentItems.filter((item) => item.completed).length;
  const remainingItems = currentItems.length - doneItems;
  const blockers: string[] = [];

  if (currentDelivery && remainingItems > 0) {
    blockers.push(`${remainingItems} ${remainingItems === 1 ? "vara återstår" : "varor återstår"} i ${currentDelivery.title}`);
  }
  if (!counts.mealPlanConfirmed) {
    blockers.push("Lägrets måltidstillfällen är inte bekräftade");
  }
  if (counts.unplannedSlots > 0) {
    blockers.push(counts.unplannedSlots === 1
      ? "1 måltidstillfälle är oplanerat"
      : `${counts.unplannedSlots} måltidstillfällen är oplanerade`);
  }
  if (counts.zeroAttendanceSlots > 0) {
    blockers.push(counts.zeroAttendanceSlots === 1
      ? "1 måltid saknar närvarande deltagare eller reserver"
      : `${counts.zeroAttendanceSlots} måltider saknar närvarande deltagare eller reserver`);
  }
  if (counts.unresolvedDiets > 0) {
    blockers.push(counts.unresolvedDiets === 1
      ? "1 specialkostuppgift återstår"
      : `${counts.unresolvedDiets} specialkostuppgifter återstår`);
  }
  if (counts.missingRecipes > 0) {
    blockers.push(counts.missingRecipes === 1
      ? "1 måltid saknar recept"
      : `${counts.missingRecipes} måltider saknar recept`);
  }
  if (counts.calculationStale) {
    blockers.push("Beräkningen saknas eller är inaktuell");
  }
  blockers.push(...supplierBlockers(counts));

  return {
    complete: sorted.filter((delivery) => delivery.status === "complete").length,
    total: sorted.length,
    current: currentDelivery ? {
      id: currentDelivery.id,
      title: currentDelivery.title,
      rangeStart: currentDelivery.rangeStart,
      doneItems,
      totalItems: currentItems.length,
    } : null,
    next: unfinished[1] ? {
      id: unfinished[1].id,
      title: unfinished[1].title,
      rangeStart: unfinished[1].rangeStart,
    } : null,
    blockers: currentDelivery ? blockers : [],
    to: "/leveranser",
  };
}

export function overviewNextAction(counts: OverviewCounts): OverviewNextAction {
  if (counts.participants === 0) {
    return {
      title: "Lägg till deltagare",
      description: "Importera deltagarna först så att närvaro, specialkost och portionsmängder får rätt underlag.",
      label: "Öppna deltagare",
      note: "Deltagarna är grunden för resten av matplaneringen.",
      to: "/deltagare"
    };
  }
  if (counts.unresolvedDiets > 0) {
    return {
      title: `Granska specialkost för ${counts.unresolvedDiets} deltagare`,
      description: "Kontrollera uppgiften från anmälan och välj vilken specialkost köket ska ta hänsyn till.",
      label: "Granska specialkost",
      note: "Inköpsunderlaget kan inte bli klart förrän specialkosten är granskad.",
      to: "/specialkost"
    };
  }
  if (counts.recipeCopies === 0) {
    return {
      title: "Välj recept för lägret",
      description: "Lägg till minst ett recept innan du börjar bygga matsedeln.",
      label: "Öppna recepten",
      note: "Matsedeln behöver publicerade recept för att mängder ska kunna räknas ut.",
      to: "/recept"
    };
  }
  if (!counts.mealPlanConfirmed) {
    return {
      title: "Bekräfta lägrets måltidstillfällen",
      description: "Skapa standardplanen för frukost, lunch och middag. Anpassa sedan första och sista dagen.",
      label: "Öppna matsedeln",
      note: "Planen blir inte redo förrän hela lägerperioden har bekräftade tillfällen.",
      to: "/matsedel"
    };
  }
  if (counts.unplannedSlots > 0 || counts.missingRecipes > 0 || counts.zeroAttendanceSlots > 0) {
    return {
      title: "Färdigställ matsedeln",
      description: counts.unplannedSlots > 0
        ? `Planera eller markera ingen servering för ${counts.unplannedSlots} återstående måltidstillfällen.`
        : counts.missingRecipes > 0
          ? "Kontrollera att varje måltid har ett recept innan mängderna räknas ut."
          : counts.zeroAttendanceSlots === 1
            ? "En planerad måltid saknar närvarande deltagare eller reserver. Kontrollera närvaron eller markera ingen servering."
            : `${counts.zeroAttendanceSlots} planerade måltider saknar närvarande deltagare eller reserver. Kontrollera närvaron eller markera ingen servering.`,
      label: "Öppna matsedeln",
      note: "Alla måltider behöver ett recept innan inköpsunderlaget kan skapas.",
      to: "/matsedel"
    };
  }
  if (counts.calculationStale) {
    return {
      title: "Räkna ut mängderna",
      description: "Matsedeln är klar att räknas om till portions- och ingrediensbehov.",
      label: "Öppna matsedeln",
      note: "En aktuell beräkning krävs innan inköps- och leveranslistor kan skapas.",
      to: "/matsedel"
    };
  }
  if (counts.supplierItemsTotal === 0) {
    return {
      title: "Skapa inköpsunderlaget",
      description: "Mängderna är aktuella. Skapa inköpslistan och låt Scoutmat matcha råvarorna mot ICA.",
      label: "Öppna inköp",
      note: "Leveranser planeras först när det finns ett faktiskt beställningsunderlag.",
      to: "/inkop"
    };
  }
  if (!counts.procurementReady || counts.supplierUnresolvedItems > 0) {
    const details = [
      counts.supplierPendingItems > 0
        ? counts.supplierPendingItems === 1
          ? "Scoutmat söker automatiskt efter 1 råvara hos ICA"
          : `Scoutmat söker automatiskt efter ${counts.supplierPendingItems} råvaror hos ICA`
        : null,
      counts.supplierSafeSuggestions > 0
        ? counts.supplierSafeSuggestions === 1
          ? "1 säkert förslag att godkänna"
          : `${counts.supplierSafeSuggestions} säkra förslag att godkänna`
        : null,
      counts.supplierReviewSuggestions > 0
        ? counts.supplierReviewSuggestions === 1
          ? "1 träff att granska"
          : `${counts.supplierReviewSuggestions} träffar att granska`
        : null,
      counts.supplierNoMatchItems > 0
        ? counts.supplierNoMatchItems === 1
          ? "1 råvara utan träff"
          : `${counts.supplierNoMatchItems} råvaror utan träff`
        : null,
      counts.supplierOrderIncompleteItems > 0
        ? counts.supplierOrderIncompleteItems === 1
          ? "1 beställning utan köpantal"
          : `${counts.supplierOrderIncompleteItems} beställningar utan köpantal`
        : null,
    ].filter((detail): detail is string => Boolean(detail));
    return {
      title: "Färdigställ ICA-underlaget",
      description: details.length
        ? `${details.join(", ")}.`
        : `${counts.supplierUnresolvedItems} råvaror behöver åtgärdas innan inköpsunderlaget är klart.`,
      label: "Öppna inköp",
      note: counts.supplierPendingItems > 0
        ? "Du kan fortsätta planera på andra sidor medan Scoutmat söker."
        : "Översikten blir klar först när varje råvara har en godkänd artikel och ett köpantal.",
      to: "/inkop"
    };
  }
  if (counts.deliveries === 0) {
    return {
      title: "Planera leveranserna",
      description: "Mängderna är aktuella. Dela nu upp underlaget i leveranser.",
      label: "Öppna leveranser",
      note: "Kontrollera leveransdagarna innan underlaget används i fält.",
      to: "/leveranser"
    };
  }
  return {
    title: "Kontrollera inköpsunderlaget",
    description: "Planeringen har underlag för deltagare, måltider, mängder och leveranser.",
    label: "Öppna inköp",
    note: "Gör en sista kontroll av beställningar och specialkost före användning.",
    to: "/inkop"
  };
}
