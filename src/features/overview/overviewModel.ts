export interface OverviewCounts {
  participants: number;
  unresolvedDiets: number;
  recipeCopies: number;
  meals: number;
  mealPlanConfirmed: boolean;
  requiredSlots: number;
  plannedSlots: number;
  unplannedSlots: number;
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

interface OverviewNextAction {
  title: string;
  description: string;
  label: string;
  note: string;
  to: "/deltagare" | "/specialkost" | "/recept" | "/matsedel" | "/inkop" | "/leveranser";
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
  if (counts.unplannedSlots > 0 || counts.missingRecipes > 0) {
    return {
      title: "Färdigställ matsedeln",
      description: counts.unplannedSlots > 0
        ? `Planera eller markera ingen servering för ${counts.unplannedSlots} återstående måltidstillfällen.`
        : "Kontrollera att varje måltid har ett recept innan mängderna räknas ut.",
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
