export type TutorialRoute =
  | "/"
  | "/deltagare"
  | "/specialkost"
  | "/recept"
  | "/matsedel"
  | "/inkop"
  | "/leveranser";

export type TutorialPlacement =
  | "top"
  | "bottom"
  | "left"
  | "right";

export interface TutorialStep {
  id: string;
  title: string;
  body: string[];
  route: TutorialRoute;
  primaryAnchor: string | null;
  fallbackAnchor: string | null;
  placement: TutorialPlacement;
  eligibility: "active-demo";
}

export interface PageTutorial {
  id: string;
  route: Exclude<TutorialRoute, "/">;
  steps: readonly [TutorialStep, TutorialStep, ...TutorialStep[]];
  continuation?: {
    route: Exclude<TutorialRoute, "/">;
    label: string;
  };
}

export const INTRO_TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "demo-welcome",
    title: "Välkommen till ditt demoläger",
    body: [
      "Här kan du prova hela arbetsflödet med exempeluppgifter. Guiden visar var du börjar och hur delarna hänger ihop.",
      "Demolägret raderas automatiskt inom 24 timmar. Du kan när som helst återställa det från raden högst upp."
    ],
    route: "/",
    primaryAnchor: null,
    fallbackAnchor: null,
    placement: "bottom",
    eligibility: "active-demo"
  },
  {
    id: "demo-banner",
    title: "Du arbetar i demoläget",
    body: [
      "Alla deltagare, recept och måltider är exempel. Här ser du när demolägret raderas och kan återställa det."
    ],
    route: "/",
    primaryAnchor: "demo-banner",
    fallbackAnchor: "main-content",
    placement: "bottom",
    eligibility: "active-demo"
  },
  {
    id: "workspace-context",
    title: "Organisation och läger",
    body: [
      "Här ser du vilken organisation och vilket läger du arbetar i. I demoläget finns ett färdigt läger att utforska."
    ],
    route: "/",
    primaryAnchor: "workspace-context",
    fallbackAnchor: "mobile-menu-trigger",
    placement: "bottom",
    eligibility: "active-demo"
  },
  {
    id: "app-navigation",
    title: "Appens delar",
    body: [
      "Här byter du mellan planeringens olika delar. På mobilen finns de i menyn."
    ],
    route: "/",
    primaryAnchor: "primary-navigation",
    fallbackAnchor: "mobile-menu-trigger",
    placement: "right",
    eligibility: "active-demo"
  },
  {
    id: "planning-flow",
    title: "Planera i rätt ordning",
    body: [
      "Följ stegen från lägerinställningar och deltagare till inköp och leveranser. Du kan alltid gå tillbaka och ändra."
    ],
    route: "/",
    primaryAnchor: "overview-flow-heading",
    fallbackAnchor: "overview-page",
    placement: "right",
    eligibility: "active-demo"
  },
  {
    id: "participants-handoff",
    title: "Börja med deltagarna",
    body: [
      "Guiden fortsätter med deltagarna, eftersom närvaro och specialkost påverkar resten av planeringen."
    ],
    route: "/",
    primaryAnchor: "overview-participants-step",
    fallbackAnchor: "overview-flow",
    placement: "right",
    eligibility: "active-demo"
  }
];

function pageStep(
  id: string,
  route: PageTutorial["route"],
  title: string,
  body: string,
  primaryAnchor: string,
  fallbackAnchor: string,
  placement: TutorialPlacement = "bottom"
): TutorialStep {
  return {
    id,
    title,
    body: [body],
    route,
    primaryAnchor,
    fallbackAnchor,
    placement,
    eligibility: "active-demo"
  };
}

export const PAGE_TUTORIALS: readonly PageTutorial[] = [
  {
    id: "participants",
    route: "/deltagare",
    steps: [
      pageStep(
        "participants-foundation",
        "/deltagare",
        "Deltagarna är grunden",
        "I demolägret finns redan exempel. I ett riktigt läger kan du lägga till deltagare en i taget eller läsa in en fil. På sikt kommer här även finnas integration mot Scoutnet, både för scouter och för arrangemang.",
        "participants-heading",
        "participants-page"
      ),
      pageStep(
        "participants-privacy",
        "/deltagare",
        "Spara bara det köket behöver",
        "Kontrollera namn, närvaro, matlag och specialkost. Övriga personuppgifter ska inte sparas.",
        "participants-privacy",
        "participants-page",
        "top"
      )
    ],
    continuation: {
      route: "/specialkost",
      label: "Gå vidare till specialkost"
    }
  },
  {
    id: "special-diets",
    route: "/specialkost",
    steps: [
      pageStep(
        "diets-review",
        "/specialkost",
        "Granska uppgifterna",
        "Här samlas specialkost som behöver bedömas innan mängderna räknas ut. Som vi kan se, så återstår en scout som ännu inte är granskad.",
        "diets-review",
        "diets-page"
      ),
      pageStep(
        "diets-decision",
        "/specialkost",
        "Du fattar beslutet",
        "Text från anmälan är bara ett underlag. Välj den specialkost som köket faktiskt ska planera för.",
        "diets-decision-card",
        "diets-review",
        "left"
      )
    ],
    continuation: {
      route: "/recept",
      label: "Gå vidare till recept"
    }
  },
  {
    id: "recipes",
    route: "/recept",
    steps: [
      pageStep(
        "recipes-library",
        "/recept",
        "Välj recept",
        "Sök i biblioteket och öppna ett recept för att se ingredienser och portionsmängder. Portionsmängderna skiljer sig beroende på deltagares ålder – spårare äter sällan lika mycket som utmanare.",
        "recipes-library",
        "recipes-page",
        "right"
      ),
      pageStep(
        "recipes-copy",
        "/recept",
        "Lägg till i lägret",
        "Lägret får en egen kopia. Senare ändringar i originalreceptet påverkar inte planeringen.",
        "recipes-copy-heading",
        "recipes-page",
        "left"
      )
    ],
    continuation: {
      route: "/matsedel",
      label: "Gå vidare till matsedel"
    }
  },
  {
    id: "schedule",
    route: "/matsedel",
    steps: [
      pageStep(
        "schedule-overview",
        "/matsedel",
        "Så läser du matsedeln",
        "Kolumnerna är lägerdagar och raderna är måltidstyper. Varje ruta visar tid, recept och om mängden är uträknad.",
        "schedule-grid-heading",
        "schedule-page",
        "bottom"
      ),
      pageStep(
        "schedule-edit-meal",
        "/matsedel",
        "Öppna och ändra en servering",
        "Välj en måltidsruta för att byta recept, ändra tid, lägga till extra portioner eller markera att ingen servering ska ske.",
        "schedule-meal-example",
        "schedule-grid",
        "right"
      ),
      pageStep(
        "schedule-status",
        "/matsedel",
        "Följ vad som återstår",
        "Statusraden visar nästa åtgärd. När alla serveringar är planerade ser du om mängderna behöver räknas om.",
        "schedule-status",
        "schedule-page",
        "bottom"
      ),
      pageStep(
        "schedule-calculate",
        "/matsedel",
        "Räkna ut mängderna",
        "När matsedeln är klar räknar Lägermat med deltagare, närvaro, recept och extra portioner. Därefter kan du skapa inköpsunderlaget.",
        "schedule-calculate",
        "schedule-page",
        "top"
      )
    ],
    continuation: {
      route: "/inkop",
      label: "Gå vidare till inköp"
    }
  },
  {
    id: "procurement",
    route: "/inkop",
    steps: [
      pageStep(
        "procurement-list",
        "/inkop",
        "Skapa inköpsunderlaget",
        "Inköpsunderlaget bygger på den senaste mängdberäkningen. Om den saknas eller är inaktuell går du tillbaka till Matsedel här.",
        "procurement-create",
        "procurement-page"
      ),
      pageStep(
        "procurement-review",
        "/inkop",
        "Granska underlaget",
        "Efter en lyckad mängdberäkning skapar du inköpslistorna här. Då försöker Lägermat koppla varje råvara till en ICA-artikel och räknar om behovet till hela köpbara förpackningar. När det finns faktiska matchningsresultat visas en separat genomgång av förslagen, granskningen och köpantalet. Ingen order skickas automatiskt – du godkänner alltid underlaget.",
        "procurement-review",
        "procurement-page",
        "top"
      )
    ],
    continuation: {
      route: "/leveranser",
      label: "Gå vidare till leveranser"
    }
  },
  {
    id: "deliveries",
    route: "/leveranser",
    steps: [
      pageStep(
        "deliveries-list",
        "/leveranser",
        "Skapa eller fördela leveransen",
        "Här ser du leveransens varor när underlaget finns. Om mängderna behöver räknas ut först visar sidan nästa åtgärd.",
        "deliveries-list",
        "deliveries-distribute"
      ),
      pageStep(
        "deliveries-complete",
        "/leveranser",
        "Följ leveransen till klar",
        "När en leverans finns markerar du varor efter hand och åtgärdar det som återstår innan leveransen kan markeras som klar.",
        "deliveries-complete",
        "deliveries-distribute",
        "top"
      )
    ]
  }
];

export const PROCUREMENT_MATCHING_TUTORIAL: PageTutorial = {
  id: "procurement-matching",
  route: "/inkop",
  steps: [
    pageStep(
      "procurement-matching-overview",
      "/inkop",
      "Från råvara till ICA-artikel",
      "Lägermat jämför råvarans namn och enhet med ICA-sortimentet. Tydliga träffar kan föreslås direkt, medan osäkra träffar alltid lämnas till dig att granska.",
      "procurement-matching-overview",
      "procurement-review",
      "bottom"
    ),
    pageStep(
      "procurement-matching-decisions",
      "/inkop",
      "Granska förslagen",
      "Här ser du säkra förslag, träffar som behöver granskas och råvaror utan träff. Godkänn bara rätt artikel eller sök efter ett bättre alternativ. Ingen beställning skickas härifrån.",
      "procurement-matching-decisions",
      "procurement-matching-overview",
      "top"
    ),
    pageStep(
      "procurement-order-details",
      "/inkop",
      "Kontrollera förpackning och köpantal",
      "När en artikel är vald räknar Lägermat om behovet till hela köpbara förpackningar. Kontrollera artikel, förpackningsstorlek och antal innan du sparar eller exporterar beställningen.",
      "procurement-order-details",
      "procurement-review",
      "top"
    )
  ]
};

export const ALL_PAGE_TUTORIALS: readonly PageTutorial[] = [
  ...PAGE_TUTORIALS,
  PROCUREMENT_MATCHING_TUTORIAL
];

export const PAGE_TUTORIAL_IDS = PAGE_TUTORIALS.map(({ id }) => id);
export const ALL_PAGE_TUTORIAL_IDS = ALL_PAGE_TUTORIALS.map(({ id }) => id);
