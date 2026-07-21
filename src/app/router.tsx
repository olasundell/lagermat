/* eslint-disable react-refresh/only-export-components */
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { AppShell } from "../components/AppShell";
import { PlaceholderPage } from "../components/PlaceholderPage";
import { AuthCallbackPage } from "../features/auth/AuthCallbackPage";
import { OverviewPage } from "../features/overview/OverviewPage";

const DeliveriesPage = lazyRouteComponent(
  () => import("../features/deliveries/DeliveriesPage"),
  "DeliveriesPage"
);
const SpecialDietsPage = lazyRouteComponent(
  () => import("../features/diets/SpecialDietsPage"),
  "SpecialDietsPage"
);
const ParticipantsPage = lazyRouteComponent(
  () => import("../features/participants/ParticipantsPage"),
  "ParticipantsPage"
);
const ProcurementPage = lazyRouteComponent(
  () => import("../features/procurement/ProcurementPage"),
  "ProcurementPage"
);
const RecipesPage = lazyRouteComponent(
  () => import("../features/recipes/RecipesPage"),
  "RecipesPage"
);
const SchedulePage = lazyRouteComponent(
  () => import("../features/schedule/SchedulePage"),
  "SchedulePage"
);
const TeamPage = lazyRouteComponent(
  () => import("../features/team/TeamPage"),
  "TeamPage"
);

export const routeDocumentTitles = {
  "/": "Översikt | Lägermat",
  "/deltagare": "Deltagare | Lägermat",
  "/specialkost": "Specialkost | Lägermat",
  "/recept": "Recept | Lägermat",
  "/matsedel": "Matsedel | Lägermat",
  "/inkop": "Inköp | Lägermat",
  "/leveranser": "Leveranser | Lägermat",
  "/team": "Användare och behörigheter | Lägermat",
  "/auth/callback": "Loggar in | Lägermat"
} as const;

export function applyDocumentTitle(title: string): void {
  document.title = title;
}

function TitledRoute({ path, children }: { path: keyof typeof routeDocumentTitles; children: ReactNode }) {
  useEffect(() => applyDocumentTitle(routeDocumentTitles[path]), [path]);
  return children;
}

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: () => (
    <PlaceholderPage
      title="Sidan finns inte"
      description="Gå tillbaka till översikten och välj nästa steg därifrån."
    />
  )
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <TitledRoute path="/"><OverviewPage /></TitledRoute>
});

const participantsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/deltagare",
  component: () => <TitledRoute path="/deltagare"><ParticipantsPage /></TitledRoute>
});

const dietsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/specialkost",
  component: () => <TitledRoute path="/specialkost"><SpecialDietsPage /></TitledRoute>
});

const recipesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recept",
  component: () => <TitledRoute path="/recept"><RecipesPage /></TitledRoute>
});

const scheduleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/matsedel",
  component: () => <TitledRoute path="/matsedel"><SchedulePage /></TitledRoute>
});

const procurementRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inkop",
  component: () => <TitledRoute path="/inkop"><ProcurementPage /></TitledRoute>
});

const deliveriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leveranser",
  component: () => <TitledRoute path="/leveranser"><DeliveriesPage /></TitledRoute>
});

const teamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/team",
  component: () => <TitledRoute path="/team"><TeamPage /></TitledRoute>
});

const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/callback",
  component: () => <TitledRoute path="/auth/callback"><AuthCallbackPage /></TitledRoute>
});

const routeTree = rootRoute.addChildren([
  overviewRoute,
  participantsRoute,
  dietsRoute,
  recipesRoute,
  scheduleRoute,
  procurementRoute,
  deliveriesRoute,
  teamRoute,
  authCallbackRoute
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 30_000,
  scrollRestoration: true
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
