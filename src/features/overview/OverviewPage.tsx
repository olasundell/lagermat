import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, CircleAlert, Import, Sparkles } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { CreateCampDialog } from "../camps/CreateCampDialog";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { overviewNextAction, type OverviewCounts } from "./overviewModel";

const emptyCounts: OverviewCounts = {
  participants: 0,
  unresolvedDiets: 0,
  recipeCopies: 0,
  meals: 0,
  mealPlanConfirmed: false,
  requiredSlots: 0,
  plannedSlots: 0,
  unplannedSlots: 0,
  noServiceSlots: 0,
  missingRecipes: 0,
  calculationStale: true,
  canFinalize: false,
  deliveries: 0
};

function formatCampPeriod(startsOn: string, endsOn: string): string {
  const start = new Date(`${startsOn}T12:00:00`);
  const end = new Date(`${endsOn}T12:00:00`);
  const month = new Intl.DateTimeFormat("sv-SE", { month: "long" });
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()}–${end.getDate()} ${month.format(end)}`;
  }
  const dayMonth = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long" });
  return `${dayMonth.format(start)}–${dayMonth.format(end)}`;
}

function quantity(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function OverviewPage() {
  const { activeMembership, activeCamp } = useWorkspace();
  const overviewQuery = useQuery({
    queryKey: ["camp-overview", activeMembership?.organizationId, activeCamp?.id],
    enabled: Boolean(supabase && activeMembership && activeCamp),
    queryFn: async () => {
      if (!supabase || !activeMembership || !activeCamp) {
        return emptyCounts;
      }
      const scope = { organizationId: activeMembership.organizationId, campId: activeCamp.id };
      const [participantsResult, recipesResult, deliveriesResult, readinessResult] = await Promise.all([
        supabase.from("participants").select("id", { count: "exact", head: true }).eq("organization_id", scope.organizationId).eq("camp_id", scope.campId),
        supabase.from("camp_recipe_copies").select("id", { count: "exact", head: true }).eq("organization_id", scope.organizationId).eq("camp_id", scope.campId),
        supabase.from("supply_lists").select("id", { count: "exact", head: true }).eq("organization_id", scope.organizationId).eq("camp_id", scope.campId).eq("kind", "delivery"),
        supabase.rpc("get_camp_readiness", { p_organization_id: scope.organizationId, p_camp_id: scope.campId }).maybeSingle()
      ]);
      const failure = participantsResult.error ?? recipesResult.error ?? deliveriesResult.error ?? readinessResult.error;
      if (failure) throw failure;
      const readiness = readinessResult.data;
      return {
        participants: participantsResult.count ?? 0,
        unresolvedDiets: readiness?.unresolved_dietary_needs ?? 0,
        recipeCopies: recipesResult.count ?? 0,
        meals: readiness?.planned_slots ?? 0,
        mealPlanConfirmed: readiness?.meal_plan_confirmed ?? false,
        requiredSlots: readiness?.required_slots ?? 0,
        plannedSlots: readiness?.planned_slots ?? 0,
        unplannedSlots: readiness?.unplanned_slots ?? 0,
        noServiceSlots: readiness?.no_service_slots ?? 0,
        missingRecipes: readiness?.meals_without_recipe ?? 0,
        calculationStale: readiness?.calculation_stale ?? true,
        canFinalize: readiness?.can_finalize ?? false,
        deliveries: deliveriesResult.count ?? 0
      };
    }
  });

  if (!activeMembership || !activeCamp) {
    return (
      <section className="page">
        <div className="empty-panel">
          <h1>Inget aktivt läger</h1>
          <p>Skapa eller välj ett läger för att börja planera maten.</p>
          <CreateCampDialog />
        </div>
      </section>
    );
  }

  const counts: OverviewCounts = overviewQuery.data ?? emptyCounts;
  const period = formatCampPeriod(activeCamp.startsOn, activeCamp.endsOn);
  const steps = [
    { number: 1, title: "Lägerinställningar", detail: `${period} · ${activeCamp.timezone}`, to: null, done: true },
    { number: 2, title: "Deltagare", detail: `${quantity(counts.participants, "person", "personer")} importerade`, to: "/deltagare" as const, done: counts.participants > 0 },
    { number: 3, title: "Specialkost", detail: `${quantity(counts.unresolvedDiets, "uppgift", "uppgifter")} behöver granskas`, to: "/specialkost" as const, done: counts.unresolvedDiets === 0, warning: counts.unresolvedDiets > 0 },
    { number: 4, title: "Recept", detail: `${quantity(counts.recipeCopies, "recept", "recept")} ${counts.recipeCopies === 1 ? "valt" : "valda"} för lägret`, to: "/recept" as const, done: counts.recipeCopies > 0 },
    {
      number: 5,
      title: "Matsedel",
      detail: !counts.mealPlanConfirmed
        ? "Måltidstillfällena är inte bekräftade"
        : counts.unplannedSlots > 0
          ? `${quantity(counts.unplannedSlots, "tillfälle", "tillfällen")} återstår`
          : `${quantity(counts.plannedSlots, "måltid", "måltider")} planerade · ${quantity(counts.noServiceSlots, "ingen servering", "inga serveringar")}`,
      to: "/matsedel" as const,
      done: counts.mealPlanConfirmed && counts.unplannedSlots === 0 && counts.missingRecipes === 0,
      warning: !counts.mealPlanConfirmed || counts.unplannedSlots > 0 || counts.missingRecipes > 0
    },
    { number: 6, title: "Inköp", detail: counts.calculationStale ? "Väntar på att mängderna räknas ut" : "Mängderna är aktuella", to: "/inkop" as const, done: !counts.calculationStale },
    { number: 7, title: "Leveranser", detail: quantity(counts.deliveries, "leveranslista", "leveranslistor"), to: "/leveranser" as const, done: counts.deliveries > 0 }
  ];
  const nextAction = overviewNextAction(counts);

  return (
    <section className="page overview-page">
      <div className="page-heading page-heading--split">
        <div>
          <h1>{activeCamp.name}</h1>
          <p>{activeMembership.organizationName} · {period} · {counts.participants} deltagare</p>
        </div>
        <div className="page-actions">
          <CreateCampDialog />
          <Link to="/deltagare" className="secondary-button">
            <Import aria-hidden="true" size={18} /> Importera deltagare
          </Link>
        </div>
      </div>

      <div className="overview-layout">
        <div className="guided-flow">
          <div className="section-heading">
            <Sparkles aria-hidden="true" size={22} />
            <div>
              <h2>Gör lägret redo</h2>
              <p>Ta ett steg i taget. Vi visar vad som återstår innan inköpslistorna är klara.</p>
            </div>
          </div>
          <ol className="step-list">
            {steps.map((step) => {
              const content = (
                <>
                  <span className={`step-row__number${step.done ? " step-row__number--done" : ""}`}>
                    {step.done ? <Check aria-hidden="true" size={18} /> : step.number}
                  </span>
                  <span className="step-row__copy">
                    <strong>{step.title}</strong>
                    <span>{step.detail}</span>
                  </span>
                  {step.warning ? <CircleAlert className="status-warning" aria-label="Behöver åtgärdas" size={21} /> : null}
                  {step.to ? <ArrowRight aria-hidden="true" size={19} /> : null}
                </>
              );
              return <li key={step.number}>{step.to ? <Link to={step.to} className="step-row">{content}</Link> : <div className="step-row">{content}</div>}</li>;
            })}
          </ol>
        </div>

        <aside className="next-action" aria-labelledby="next-action-title">
          <p className="next-action__label">Nästa att lösa</p>
          <h2 id="next-action-title">{nextAction.title}</h2>
          <p>{nextAction.description}</p>
          <Link to={nextAction.to} className="primary-button">
            {nextAction.label} <ArrowRight aria-hidden="true" size={18} />
          </Link>
          <p className="next-action__note">{nextAction.note}</p>
        </aside>
      </div>
    </section>
  );
}
