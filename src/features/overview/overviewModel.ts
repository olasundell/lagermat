export interface OverviewCounts {
  participants: number;
  unresolvedDiets: number;
  recipeCopies: number;
  meals: number;
  missingRecipes: number;
  calculations: number;
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
  if (counts.meals === 0 || counts.missingRecipes > 0) {
    return {
      title: "Färdigställ matsedeln",
      description: "Kontrollera att varje måltid har ett recept innan mängderna räknas ut.",
      label: "Öppna matsedeln",
      note: "Alla måltider behöver ett recept innan inköpsunderlaget kan skapas.",
      to: "/matsedel"
    };
  }
  if (counts.calculations === 0) {
    return {
      title: "Räkna ut mängderna",
      description: "Matsedeln är klar att räknas om till portions- och ingrediensbehov.",
      label: "Öppna matsedeln",
      note: "En aktuell beräkning krävs innan inköps- och leveranslistor kan skapas.",
      to: "/matsedel"
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
