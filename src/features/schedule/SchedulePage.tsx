import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CalendarPlus,
  Check,
  ChevronRight,
  Circle,
  CircleAlert,
  Calculator,
  Leaf,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  UsersRound,
  X
} from "lucide-react";
import { useState } from "react";
import { Button } from "react-aria-components";
import { supabase } from "../../lib/supabase";
import { userFacingError } from "../../lib/userFacingError";
import type { Json } from "../../types/database";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { emptyReserveDrafts, scheduleCalculationLabel, scheduleIssueParts, visibleReserves, type ScheduleReadiness } from "./scheduleViewModel";

type MealType = "breakfast" | "lunch" | "dinner" | "evening" | "other";
type MealStatus = "clear" | "diet" | "review" | "unknown";

interface MealReserveRow {
  id: string;
  dietary_label: string;
  portions: number;
}

interface RecipeCopyRow {
  id: string;
  name: string;
  source_recipe_version_id: string;
  version_key: string;
  recipe_versions: { version_number: number } | null;
}

interface MealRow {
  id: string;
  starts_at: string;
  meal_type: MealType;
  title: string;
  status: "draft" | "ready" | "blocked";
  camp_recipe_copy_id: string | null;
  camp_recipe_copies: RecipeCopyRow | null;
  meal_reserves: MealReserveRow[];
}

interface RecipeVersionOption {
  id: string;
  version_number: number;
  status: "draft" | "published" | "retired";
}

interface RecipeOptionRow {
  id: string;
  name: string;
  recipe_versions: RecipeVersionOption[];
}

interface CalculationLineRow {
  id: string;
  meal_id: string;
  ingredient_name: string;
  exact_amount: number;
  unit: string;
  trace: Json;
}

interface CalculationRevisionRow {
  id: string;
  revision_number: number;
  problem_summary: Json;
  created_at: string;
  calculation_lines: CalculationLineRow[];
}

type ReadinessRow = ScheduleReadiness;

interface ReserveDraft {
  id: string;
  dietaryLabel: string;
  portions: string;
}

interface MealDraft {
  title: string;
  startsAt: string;
  mealType: MealType;
  recipeVersionId: string;
  reserves: ReserveDraft[];
}

const mealTypes: MealType[] = ["breakfast", "lunch", "dinner", "evening", "other"];
const mealTypeLabels: Record<MealType, string> = {
  breakfast: "Frukost",
  lunch: "Lunch",
  dinner: "Middag",
  evening: "Kvällsmål",
  other: "Extra"
};

function dateTimeInputValue(value: string): string {
  const parsed = new Date(value);
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function dayKey(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function dayHeading(value: string, timeZone: string): { weekday: string; date: string } {
  const date = new Date(value);
  return {
    weekday: new Intl.DateTimeFormat("sv-SE", { timeZone, weekday: "short", day: "numeric" }).format(date),
    date: new Intl.DateTimeFormat("sv-SE", { timeZone, month: "long" }).format(date)
  };
}

function timeLabel(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function decimal(value: number): string {
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 12 }).format(value);
}

function formatCampPeriod(startsOn: string, endsOn: string): string {
  const start = new Date(`${startsOn}T12:00:00`);
  const end = new Date(`${endsOn}T12:00:00`);
  const dayMonth = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long" });
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()}–${end.getDate()} ${new Intl.DateTimeFormat("sv-SE", { month: "long" }).format(end)}`;
  }
  return `${dayMonth.format(start)}–${dayMonth.format(end)}`;
}

function readableFormula(trace: Json): string {
  const formula = traceString(trace, "formula");
  if (!formula) return "Beräkningsdetaljer saknas.";
  return formula
    .replaceAll(" * ", " × ")
    .replace(/\d+(?:\.\d+)?/g, (value) => decimal(Number(value)));
}

function traceObject(trace: Json): Record<string, Json | undefined> {
  return trace && typeof trace === "object" && !Array.isArray(trace) ? trace : {};
}

function traceString(trace: Json, key: string): string | null {
  const value = traceObject(trace)[key];
  return typeof value === "string" ? value : null;
}

function traceGroups(trace: Json): number {
  const groups = traceObject(trace).groups;
  return Array.isArray(groups) ? groups.length : 0;
}

function isDraftRevision(revision: CalculationRevisionRow | null): boolean {
  return traceObject(revision?.problem_summary ?? null).is_draft === true;
}

function MealStatusIcon({ status }: { status: MealStatus }) {
  if (status === "clear") return <Leaf className="meal-status meal-status--clear" aria-label="Kostunderlag granskat" size={17} />;
  if (status === "diet") return <Circle className="meal-status meal-status--diet" aria-label="Har specialkostreserver" size={13} fill="currentColor" />;
  if (status === "review") return <CircleAlert className="meal-status meal-status--review" aria-label="Underlag behöver granskas" size={18} fill="currentColor" />;
  return <span className="meal-status meal-status--unknown" aria-label="Saknar beräkning">–</span>;
}

export function SchedulePage() {
  const queryClient = useQueryClient();
  const { activeCamp, activeMembership } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingMealId, setEditingMealId] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<MealDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const scope = activeCamp && activeMembership
    ? { organizationId: activeMembership.organizationId, campId: activeCamp.id }
    : null;

  const scheduleQuery = useQuery({
    queryKey: ["camp-schedule", scope?.organizationId, scope?.campId],
    enabled: Boolean(scope && supabase),
    queryFn: async () => {
      if (!scope || !supabase) return { meals: [], recipes: [], revision: null, readiness: null };
      const [mealResult, recipeResult, revisionResult, readinessResult] = await Promise.all([
        supabase
          .from("meals")
          .select("id, starts_at, meal_type, title, status, camp_recipe_copy_id, camp_recipe_copies(id, name, source_recipe_version_id, version_key, recipe_versions(version_number)), meal_reserves(id, dietary_label, portions)")
          .eq("organization_id", scope.organizationId)
          .eq("camp_id", scope.campId)
          .order("starts_at"),
        supabase
          .from("recipes")
          .select("id, name, recipe_versions(id, version_number, status)")
          .eq("organization_id", scope.organizationId)
          .order("name"),
        supabase
          .from("calculation_revisions")
          .select("id, revision_number, problem_summary, created_at, calculation_lines(id, meal_id, ingredient_name, exact_amount, unit, trace)")
          .eq("organization_id", scope.organizationId)
          .eq("camp_id", scope.campId)
          .eq("status", "current")
          .order("revision_number", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .rpc("get_camp_readiness", { p_organization_id: scope.organizationId, p_camp_id: scope.campId })
          .maybeSingle()
      ]);
      const error = mealResult.error ?? recipeResult.error ?? revisionResult.error ?? readinessResult.error;
      if (error) throw error;
      return {
        meals: (mealResult.data ?? []) as unknown as MealRow[],
        recipes: (recipeResult.data ?? []) as RecipeOptionRow[],
        revision: revisionResult.data as unknown as CalculationRevisionRow | null,
        readiness: readinessResult.data as ReadinessRow | null
      };
    }
  });

  const meals = scheduleQuery.data?.meals ?? [];
  const recipes = scheduleQuery.data?.recipes ?? [];
  const revision = scheduleQuery.data?.revision ?? null;
  const readiness = scheduleQuery.data?.readiness ?? null;
  const selectedMeal = meals.find((meal) => meal.id === selectedId) ?? meals[0] ?? null;
  const versionOptions = recipes.flatMap((recipe) => recipe.recipe_versions
    .filter((version) => version.status === "published")
    .map((version) => ({ id: version.id, label: `${recipe.name} · version ${version.version_number}` }))
  );
  const dateKeys = [...new Set(meals.map((meal) => dayKey(meal.starts_at, activeCamp?.timezone ?? "Europe/Stockholm")))];
  const linesByMeal = new Map<string, CalculationLineRow[]>();
  for (const line of revision?.calculation_lines ?? []) {
    const current = linesByMeal.get(line.meal_id) ?? [];
    current.push(line);
    linesByMeal.set(line.meal_id, current);
  }
  const selectedLines = selectedMeal ? linesByMeal.get(selectedMeal.id) ?? [] : [];
  const selectedMultiplier = selectedLines
    .map((line) => ({ line, mode: traceString(line.trace, "mode"), rule: traceString(line.trace, "dietary_rule") }))
    .find((entry) => entry.mode === "weighted_portion" && entry.rule === "standard");

  function statusForMeal(meal: MealRow): MealStatus {
    if (!meal.camp_recipe_copy_id || !revision) return "unknown";
    if ((readiness?.unresolved_dietary_needs ?? 0) > 0) return "review";
    if (meal.meal_reserves.some((reserve) => !["standard", "standardkost"].includes(reserve.dietary_label.toLocaleLowerCase("sv-SE")))) return "diet";
    return "clear";
  }

  function openNewMeal() {
    const firstVersion = versionOptions[0];
    if (!firstVersion) return;
    setEditingMealId(null);
    setDraft({
      title: "",
      startsAt: `${activeCamp?.startsOn ?? ""}T12:00`,
      mealType: "lunch",
      recipeVersionId: firstVersion?.id ?? "",
      reserves: emptyReserveDrafts()
    });
    setMessage(null);
  }

  function openMealEditor(meal: MealRow) {
    setEditingMealId(meal.id);
    setDraft({
      title: meal.title,
      startsAt: dateTimeInputValue(meal.starts_at),
      mealType: meal.meal_type,
      recipeVersionId: meal.camp_recipe_copies?.source_recipe_version_id ?? versionOptions[0]?.id ?? "",
      reserves: visibleReserves(meal.meal_reserves)
        .map((reserve) => ({ id: reserve.id, dietaryLabel: reserve.dietary_label, portions: String(reserve.portions) }))
    });
    setMessage(null);
  }

  function updateReserve(id: string, patch: Partial<ReserveDraft>) {
    setDraft((current) => current ? {
      ...current,
      reserves: current.reserves.map((reserve) => reserve.id === id ? { ...reserve, ...patch } : reserve)
    } : current);
  }

  async function saveMeal() {
    if (!supabase || !scope || !draft || !draft.title.trim() || !draft.recipeVersionId) return;
    setSaving(true);
    setMessage(null);
    const parsedStartsAt = new Date(draft.startsAt);
    if (Number.isNaN(parsedStartsAt.getTime())) {
      setMessage({ kind: "error", text: "Måltidstiden är ogiltig." });
      setSaving(false);
      return;
    }
    // The generated Supabase type cannot express nullable PostgreSQL function arguments.
    const mealIdArgument = (editingMealId ?? null) as string;
    const { data, error } = await supabase.rpc("save_meal", {
      p_meal_id: mealIdArgument,
      p_camp_id: scope.campId,
      p_starts_at: parsedStartsAt.toISOString(),
      p_meal_type: draft.mealType,
      p_title: draft.title.trim(),
      p_recipe_version_id: draft.recipeVersionId,
      p_reserves: draft.reserves
        .map((reserve) => ({
          dietary_label: reserve.dietaryLabel.trim(),
          portions: Math.max(0, Number.parseInt(reserve.portions || "0", 10) || 0)
        }))
        .filter((reserve) => reserve.dietary_label.length > 0 && reserve.portions > 0)
    });
    if (error) {
      setMessage({ kind: "error", text: userFacingError(error, "Måltiden kunde inte sparas.") });
      setSaving(false);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["camp-schedule"] }),
      queryClient.invalidateQueries({ queryKey: ["camp-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["recipe-library"] })
    ]);
    setSelectedId(data);
    setEditingMealId(undefined);
    setDraft(null);
    setMessage({ kind: "success", text: "Måltiden sparades. Beräkningen behöver köras om." });
    setSaving(false);
  }

  async function calculate() {
    if (!supabase || !scope) return;
    setCalculating(true);
    setMessage(null);
    const { error } = await supabase.rpc("calculate_camp", {
      p_organization_id: scope.organizationId,
      p_camp_id: scope.campId
    });
    if (error) {
      setMessage({ kind: "error", text: userFacingError(error, "Mängderna kunde inte räknas ut.") });
      setCalculating(false);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["camp-schedule"] }),
      queryClient.invalidateQueries({ queryKey: ["camp-overview"] })
    ]);
    setMessage({
      kind: "success",
      text: (readiness?.unresolved_dietary_needs ?? 0) > 0
        ? "Mängderna räknades om. Granska specialkosten innan underlaget används."
        : "Mängderna räknades om och är aktuella."
    });
    setCalculating(false);
  }

  if (!scope || !activeCamp || !activeMembership) {
    return <section className="page page--narrow"><p className="form-error">Välj organisation och läger först.</p></section>;
  }

  const issueParts = scheduleIssueParts(readiness, meals.length);
  const selectedReserves = selectedMeal ? visibleReserves(selectedMeal.meal_reserves) : [];

  return (
    <section className="page schedule-page">
      <div className="page-heading page-heading--split schedule-heading">
        <div>
          <p className="page-heading__eyebrow">Planera måltider</p>
          <h1>Matsedel</h1>
          <p>{[
            formatCampPeriod(activeCamp.startsOn, activeCamp.endsOn),
            `${meals.length} ${meals.length === 1 ? "måltid" : "måltider"}`,
            scheduleCalculationLabel(Boolean(revision), meals.length)
          ].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="page-actions">
          <Button className="secondary-button" onPress={calculate} isDisabled={calculating || meals.length === 0}>
            {calculating ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <Calculator aria-hidden="true" size={18} />} Räkna ut mängder
          </Button>
          <Button className="primary-button" onPress={openNewMeal} isDisabled={versionOptions.length === 0}><CalendarPlus aria-hidden="true" size={19} /> Lägg till måltid</Button>
        </div>
      </div>

      {message ? <p className={message.kind === "error" ? "form-error" : "form-success"} role="status">{message.kind === "success" ? <Check aria-hidden="true" size={18} /> : <CircleAlert aria-hidden="true" size={18} />}{message.text}</p> : null}

      {scheduleQuery.isLoading ? <LoaderCircle className="spin" aria-label="Läser matsedel" size={30} /> : scheduleQuery.error ? (
        <p className="form-error">{userFacingError(scheduleQuery.error, "Matsedeln kunde inte läsas.")}</p>
      ) : (
        <div className="schedule-layout">
          <div className="schedule-workspace">
            {meals.length > 0 ? <div className={issueParts.length > 0 ? "warning-banner" : "schedule-ready-banner"}>
              {issueParts.length > 0 ? <CircleAlert aria-hidden="true" size={24} fill="currentColor" /> : <Check aria-hidden="true" size={23} />}
              <span>{issueParts.length > 0 ? `Nästa att lösa: ${issueParts.join(", ")}` : "Underlaget är granskat och beräkningen är aktuell."}</span>
              {revision ? <span className="warning-banner__action">{isDraftRevision(revision) ? "Underlag med varningar" : "Mängderna är aktuella"}</span> : null}
            </div> : null}

            {meals.length === 0 ? versionOptions.length === 0 ? <div className="empty-panel"><h2>Välj recept innan du skapar matsedeln</h2><p>Lägg först till minst ett publicerat recept för lägret.</p><Link to="/recept" className="primary-button">Öppna recepten</Link></div> : <div className="empty-panel"><h2>Ingen matsedel ännu</h2><p>Lägg till den första måltiden och välj ett av lägrets recept.</p></div> : (
              <div className="schedule-table-wrap">
                <table className="schedule-table">
                  <caption className="sr-only">Måltider per datum och måltidstyp</caption>
                  <thead><tr><th scope="col"><span className="sr-only">Måltidstyp</span></th>{dateKeys.map((date) => {
                    const example = meals.find((meal) => dayKey(meal.starts_at, activeCamp.timezone) === date)!;
                    const heading = dayHeading(example.starts_at, activeCamp.timezone);
                    return <th scope="col" key={date}>{heading.weekday}<span>{heading.date}</span></th>;
                  })}</tr></thead>
                  <tbody>{mealTypes.map((type) => <tr key={type}><th scope="row">{mealTypeLabels[type]}</th>{dateKeys.map((date) => {
                    const meal = meals.find((candidate) => candidate.meal_type === type && dayKey(candidate.starts_at, activeCamp.timezone) === date);
                    return <td key={`${type}-${date}`}>{meal ? <Button className={`meal-cell${selectedMeal?.id === meal.id ? " meal-cell--selected" : ""}`} onPress={() => { setSelectedId(meal.id); setEditingMealId(undefined); setDraft(null); }} aria-label={`${meal.title}, ${timeLabel(meal.starts_at, activeCamp.timezone)}, ${mealTypeLabels[meal.meal_type]}`}><strong>{meal.title}</strong><span className="meal-cell__meta"><span>{timeLabel(meal.starts_at, activeCamp.timezone)} · {linesByMeal.has(meal.id) ? "beräknad" : "ej beräknad"}</span><MealStatusIcon status={statusForMeal(meal)} /></span></Button> : null}</td>;
                  })}</tr>)}</tbody>
                </table>
              </div>
            )}

            <div className="schedule-legend" aria-label="Statusförklaring">
              <span><Leaf className="meal-status--clear" aria-hidden="true" size={16} /> Kostunderlag granskat</span>
              <span><Circle className="meal-status--diet" aria-hidden="true" size={12} fill="currentColor" /> Har specialkostreserver</span>
              <span><CircleAlert className="meal-status--review" aria-hidden="true" size={17} fill="currentColor" /> Behöver granskas</span>
              <span><b>–</b> Saknar aktuell beräkning</span>
            </div>
          </div>

          <aside className="meal-detail" aria-labelledby="meal-detail-title">
            {draft ? (
              <div className="meal-editor">
                <div className="meal-detail__heading"><div><p className="page-heading__eyebrow">{editingMealId ? "Redigera" : "Ny måltid"}</p><h2 id="meal-detail-title">Måltidsunderlag</h2></div><Button className="icon-button" aria-label="Stäng måltidsformulär" onPress={() => { setEditingMealId(undefined); setDraft(null); }}><X aria-hidden="true" size={21} /></Button></div>
                <div className="meal-editor__fields">
                  <label>Titel<input name="meal-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
                  <label>Tid<input name="meal-starts-at" type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} /></label>
                  <label>Typ<select name="meal-type" value={draft.mealType} onChange={(event) => setDraft({ ...draft, mealType: event.target.value as MealType })}>{mealTypes.map((type) => <option key={type} value={type}>{mealTypeLabels[type]}</option>)}</select></label>
                  <label>Publicerad receptversion<select name="meal-recipe-version" value={draft.recipeVersionId} onChange={(event) => setDraft({ ...draft, recipeVersionId: event.target.value })}>{versionOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
                </div>
                <div className="meal-reserve-editor"><div className="detail-section__title"><h3>Extra portioner</h3><Button className="text-button" onPress={() => setDraft({ ...draft, reserves: [...draft.reserves, { id: crypto.randomUUID(), dietaryLabel: "Standardkost", portions: "1" }] })}><Plus aria-hidden="true" size={16} /> Lägg till</Button></div>{draft.reserves.map((reserve) => <div className="meal-reserve-row" key={reserve.id}><label><span>Typ av specialkost</span><input name={`reserve-diet-${reserve.id}`} value={reserve.dietaryLabel} onChange={(event) => updateReserve(reserve.id, { dietaryLabel: event.target.value })} /></label><label><span>Antal</span><input name={`reserve-portions-${reserve.id}`} type="number" min="0" step="1" value={reserve.portions} onChange={(event) => updateReserve(reserve.id, { portions: event.target.value })} /></label><Button className="icon-button" aria-label={`Ta bort extra portion ${reserve.dietaryLabel}`} onPress={() => setDraft({ ...draft, reserves: draft.reserves.filter((item) => item.id !== reserve.id) })}><X aria-hidden="true" size={18} /></Button></div>)}</div>
                <Button className="primary-button meal-editor__save" onPress={saveMeal} isDisabled={saving || !draft.title.trim() || !draft.recipeVersionId}>{saving ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <Save aria-hidden="true" size={18} />} Spara måltid</Button>
              </div>
            ) : selectedMeal ? (
              <>
                <div className="meal-detail__heading"><div><h2 id="meal-detail-title">{selectedMeal.title}</h2><p>{dayHeading(selectedMeal.starts_at, activeCamp.timezone).weekday} · {timeLabel(selectedMeal.starts_at, activeCamp.timezone)} · {mealTypeLabels[selectedMeal.meal_type]}</p></div></div>
                <div className="portion-count"><UsersRound aria-hidden="true" size={22} /><strong>{selectedMultiplier ? `Motsvarar ${decimal(Number(traceString(selectedMultiplier.line.trace, "multiplier")))} normalportioner` : "Inte beräknad"}</strong><span>Beräknat från deltagarnas portionsstorlek och närvaro</span></div>
                <div className="detail-section"><div className="detail-section__title"><h3>Recept för måltiden</h3><ChevronRight aria-hidden="true" size={17} /></div><dl><div><dt>Recept</dt><dd>{selectedMeal.camp_recipe_copies?.name ?? "Saknas"}</dd></div><div><dt>Version</dt><dd>{selectedMeal.camp_recipe_copies?.recipe_versions ? `Version ${selectedMeal.camp_recipe_copies.recipe_versions.version_number}` : "Version saknas"}</dd></div><div><dt>Extra portioner</dt><dd>{selectedReserves.length > 0 ? selectedReserves.map((reserve) => `${reserve.portions} ${reserve.dietary_label}`).join(", ") : "Inga"}</dd></div></dl></div>
                <div className="calculation-detail"><div className="detail-section__title"><h3>Beräknade mängder</h3><span>{selectedLines.length} {selectedLines.length === 1 ? "ingrediens" : "ingredienser"}</span></div>{selectedLines.length === 0 ? <p className="muted-copy">Räkna ut mängderna för att se ingredienserna här.</p> : <ul>{selectedLines.sort((left, right) => left.ingredient_name.localeCompare(right.ingredient_name, "sv-SE")).map((line) => <li key={line.id}><div><strong>{line.ingredient_name}</strong><span>{decimal(line.exact_amount)} {line.unit}</span></div><details><summary>Så räknades mängden ut</summary><p>{readableFormula(line.trace)}</p><p>{traceGroups(line.trace)} {traceGroups(line.trace) === 1 ? "grupp ingår" : "grupper ingår"}.</p></details></li>)}</ul>}</div>
                <Button className="secondary-button meal-detail__edit" onPress={() => openMealEditor(selectedMeal)}><Pencil aria-hidden="true" size={18} /> Redigera måltid</Button>
                <p className="meal-detail__status"><Check aria-hidden="true" size={16} /> Måltiden är sparad på den här datorn.</p>
              </>
            ) : <div className="empty-panel"><h2>Välj en måltid</h2><p>Detaljer och spårbar beräkning visas här.</p></div>}
          </aside>
        </div>
      )}
    </section>
  );
}
