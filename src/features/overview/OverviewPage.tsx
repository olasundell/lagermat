import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, CircleAlert, Import, Sparkles } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { CreateCampDialog } from "../camps/CreateCampDialog";
import { useWorkspace } from "../workspace/WorkspaceContext";
import {
  overviewDeliveryProgress,
  overviewNextAction,
  type OverviewCounts,
  type OverviewDeliveryRow,
} from "./overviewModel";

const emptyCounts: OverviewCounts = {
  participants: 0,
  unresolvedDiets: 0,
  recipeCopies: 0,
  meals: 0,
  mealPlanConfirmed: false,
  requiredSlots: 0,
  plannedSlots: 0,
  unplannedSlots: 0,
  zeroAttendanceSlots: 0,
  noServiceSlots: 0,
  missingRecipes: 0,
  calculationStale: true,
  canFinalize: false,
  supplierItemsTotal: 0,
  supplierReadyItems: 0,
  supplierSafeSuggestions: 0,
  supplierReviewSuggestions: 0,
  supplierPendingItems: 0,
  supplierNoMatchItems: 0,
  supplierOrderIncompleteItems: 0,
  supplierUnresolvedItems: 0,
  procurementReady: true,
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

function formatDeliveryDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    day: "numeric",
    month: "long",
  }).format(new Date(value));
}

export function OverviewPage() {
  const { activeMembership, activeCamp } = useWorkspace();
  const overviewQuery = useQuery({
    queryKey: ["camp-overview", activeMembership?.organizationId, activeCamp?.id],
    enabled: Boolean(supabase && activeMembership && activeCamp),
    queryFn: async () => {
      if (!supabase || !activeMembership || !activeCamp) {
        return { ...emptyCounts, deliveryRows: [] satisfies OverviewDeliveryRow[] };
      }
      const scope = { organizationId: activeMembership.organizationId, campId: activeCamp.id };
      const [participantsResult, recipesResult, deliveriesResult, readinessResult] = await Promise.all([
        supabase.from("participants").select("id", { count: "exact", head: true }).eq("organization_id", scope.organizationId).eq("camp_id", scope.campId).eq("lifecycle_status", "active"),
        supabase.from("camp_recipe_copies").select("id", { count: "exact", head: true }).eq("organization_id", scope.organizationId).eq("camp_id", scope.campId),
        supabase.from("supply_lists").select("id, title, range_start, status, supply_list_items(completed, source_present)").eq("organization_id", scope.organizationId).eq("camp_id", scope.campId).eq("kind", "delivery").eq("source_present", true).order("range_start", { ascending: true, nullsFirst: false }),
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
        zeroAttendanceSlots: readiness?.zero_attendance_slots ?? 0,
        noServiceSlots: readiness?.no_service_slots ?? 0,
        missingRecipes: readiness?.meals_without_recipe ?? 0,
        calculationStale: readiness?.calculation_stale ?? true,
        canFinalize: readiness?.can_finalize ?? false,
        supplierItemsTotal: readiness?.supplier_items_total ?? 0,
        supplierReadyItems: readiness?.supplier_ready_items ?? 0,
        supplierSafeSuggestions: readiness?.supplier_safe_suggestions ?? 0,
        supplierReviewSuggestions: readiness?.supplier_review_suggestions ?? 0,
        supplierPendingItems: readiness?.supplier_pending_items ?? 0,
        supplierNoMatchItems: readiness?.supplier_no_match ?? 0,
        supplierOrderIncompleteItems: readiness?.supplier_order_incomplete ?? 0,
        supplierUnresolvedItems: readiness?.supplier_unresolved_items ?? 0,
        procurementReady: readiness?.procurement_ready ?? true,
        deliveries: deliveriesResult.data?.length ?? 0,
        deliveryRows: (deliveriesResult.data ?? []).map((delivery) => ({
          id: delivery.id,
          title: delivery.title,
          rangeStart: delivery.range_start,
          status: delivery.status,
          items: (delivery.supply_list_items ?? []).map((item) => ({
            completed: item.completed,
            sourcePresent: item.source_present,
          })),
        })) satisfies OverviewDeliveryRow[],
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
  const deliveryProgress = overviewDeliveryProgress(
    overviewQuery.data?.deliveryRows ?? [],
    counts,
  );
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
          : counts.missingRecipes > 0
            ? `${quantity(counts.missingRecipes, "måltid saknar recept", "måltider saknar recept")}`
            : counts.zeroAttendanceSlots > 0
              ? `${quantity(counts.zeroAttendanceSlots, "måltid saknar deltagare", "måltider saknar deltagare")}`
              : `${quantity(counts.plannedSlots, "måltid", "måltider")} planerade · ${quantity(counts.noServiceSlots, "ingen servering", "inga serveringar")}`,
      to: "/matsedel" as const,
      done: counts.mealPlanConfirmed && counts.unplannedSlots === 0 && counts.missingRecipes === 0 && counts.zeroAttendanceSlots === 0,
      warning: !counts.mealPlanConfirmed || counts.unplannedSlots > 0 || counts.missingRecipes > 0 || counts.zeroAttendanceSlots > 0
    },
    {
      number: 6,
      title: "Inköp",
      detail: counts.calculationStale
        ? "Väntar på att mängderna räknas ut"
        : counts.supplierItemsTotal === 0
          ? "Inköpslistan behöver skapas"
          : counts.supplierUnresolvedItems > 0
            ? counts.supplierPendingItems > 0
              ? quantity(
                counts.supplierPendingItems,
                "råvara söks automatiskt hos ICA",
                "råvaror söks automatiskt hos ICA",
              )
              : quantity(
                counts.supplierUnresolvedItems,
                "råvara behöver åtgärdas",
                "råvaror behöver åtgärdas",
              )
            : `${quantity(counts.supplierReadyItems, "råvara", "råvaror")} klara för beställning`,
      to: "/inkop" as const,
      done: !counts.calculationStale
        && counts.supplierItemsTotal > 0
        && counts.procurementReady,
      warning: !counts.calculationStale
        && (
          counts.supplierItemsTotal === 0
          || !counts.procurementReady
        ),
    },
    {
      number: 7,
      title: "Leveranser",
      detail: counts.deliveries > 0
        ? `${deliveryProgress.complete} av ${deliveryProgress.total} leveranser klara`
        : "Inga leveranser planerade",
      to: "/leveranser" as const,
      done: deliveryProgress.total > 0 && deliveryProgress.complete === deliveryProgress.total,
      warning: deliveryProgress.blockers.length > 0,
    }
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

      <section className="overview-delivery-progress" aria-labelledby="delivery-progress-title">
        <div className="overview-delivery-progress__heading">
          <div>
            <p className="overview-delivery-progress__eyebrow">Leveranser i drift</p>
            <h2 id="delivery-progress-title">{deliveryProgress.total > 0
              ? `${deliveryProgress.complete} av ${deliveryProgress.total} klara`
              : "Inga leveranser planerade"}</h2>
          </div>
          <Link to={deliveryProgress.to} className="secondary-button">
            Öppna leveranser <ArrowRight aria-hidden="true" size={18} />
          </Link>
        </div>

        <div className="overview-delivery-progress__stages">
          <div>
            <span>Pågår nu</span>
            <strong>{deliveryProgress.current?.title ?? "Ingen aktiv leverans"}</strong>
            <small>{deliveryProgress.current
              ? `${deliveryProgress.current.doneItems} av ${deliveryProgress.current.totalItems} varor klara`
              : deliveryProgress.total > 0 ? "Alla leveranser är klara" : "Skapa leveranser från matsedeln"}</small>
          </div>
          <div>
            <span>Nästa</span>
            <strong>{deliveryProgress.next?.title ?? "Ingen ytterligare leverans"}</strong>
            <small>{deliveryProgress.next?.rangeStart
              ? formatDeliveryDate(deliveryProgress.next.rangeStart, activeCamp.timezone)
              : "–"}</small>
          </div>
        </div>

        {deliveryProgress.blockers.length > 0 ? (
          <div className="overview-delivery-progress__blockers" role="status">
            <strong><CircleAlert aria-hidden="true" size={18} /> Blockerar nästa steg</strong>
            <ul>
              {deliveryProgress.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
          </div>
        ) : null}
      </section>
    </section>
  );
}
