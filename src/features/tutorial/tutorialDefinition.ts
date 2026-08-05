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
  steps: readonly [TutorialStep, TutorialStep];
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
    id: "next-action",
    title: "Nästa steg",
    body: [
      "Här visar Lägermat vad som är viktigast att göra nu, utifrån hur långt planeringen har kommit."
    ],
    route: "/",
    primaryAnchor: "overview-next-action",
    fallbackAnchor: "overview-page",
    placement: "left",
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
        "I demolägret finns redan exempel. I ett riktigt läger kan du lägga till deltagare en i taget eller läsa in en fil.",
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
    ]
  },
  {
    id: "special-diets",
    route: "/specialkost",
    steps: [
      pageStep(
        "diets-review",
        "/specialkost",
        "Granska uppgifterna",
        "Här samlas specialkost som behöver bedömas innan mängderna räknas ut.",
        "diets-heading",
        "diets-page"
      ),
      pageStep(
        "diets-decision",
        "/specialkost",
        "Du fattar beslutet",
        "Text från anmälan är bara ett underlag. Välj den specialkost som köket faktiskt ska planera för.",
        "diets-decision-heading",
        "diets-page",
        "left"
      )
    ]
  },
  {
    id: "recipes",
    route: "/recept",
    steps: [
      pageStep(
        "recipes-library",
        "/recept",
        "Välj recept",
        "Sök i biblioteket och öppna ett recept för att se ingredienser och portionsmängder.",
        "recipes-heading",
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
    ]
  },
  {
    id: "schedule",
    route: "/matsedel",
    steps: [
      pageStep(
        "schedule-grid",
        "/matsedel",
        "Planera varje servering",
        "Här ser du alla måltidstillfällen och vad som fortfarande behöver planeras.",
        "schedule-heading",
        "schedule-page",
        "bottom"
      ),
      pageStep(
        "schedule-calculate",
        "/matsedel",
        "Räkna ut mängderna",
        "När matsedeln är klar räknar Lägermat med deltagare, närvaro, recept och extra portioner.",
        "schedule-calculate",
        "schedule-page",
        "top"
      )
    ]
  },
  {
    id: "procurement",
    route: "/inkop",
    steps: [
      pageStep(
        "procurement-list",
        "/inkop",
        "Skapa inköpsunderlaget",
        "När mängderna är uträknade samlas lägrets råvaror här.",
        "procurement-create",
        "procurement-page"
      ),
      pageStep(
        "procurement-review",
        "/inkop",
        "Kontrollera innan du beställer",
        "Granska ICA-förslag, förpackningar och köpantal. Lägermat hjälper till, men du godkänner underlaget.",
        "procurement-review",
        "procurement-page",
        "top"
      )
    ]
  },
  {
    id: "deliveries",
    route: "/leveranser",
    steps: [
      pageStep(
        "deliveries-list",
        "/leveranser",
        "Fördela inköpen",
        "Här ser du vad som behövs i varje leverans och när det ska finnas på plats.",
        "deliveries-distribute",
        "deliveries-page"
      ),
      pageStep(
        "deliveries-complete",
        "/leveranser",
        "Gör klart leveransen",
        "Markera varor efter hand och åtgärda det som återstår innan du markerar leveransen som klar.",
        "deliveries-complete",
        "deliveries-page",
        "top"
      )
    ]
  }
];

export const PAGE_TUTORIAL_IDS = PAGE_TUTORIALS.map(({ id }) => id);
