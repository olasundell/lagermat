import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Ban,
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
  RotateCcw,
  Save,
  UsersRound,
  X
} from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  Modal,
  ModalOverlay
} from "react-aria-components";
import { supabase } from "../../lib/supabase";
import { userFacingError } from "../../lib/userFacingError";
import type { Json } from "../../types/database";
import { practicalSupplyAmount } from "../supplies/supplyModel";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { recurringExtraMealPreview } from "./recurringExtraMealModel";
import {
  emptyReserveDrafts,
  inclusiveCampDates,
  scheduleCalculationLabel,
  scheduleNextAction,
  visibleReserves,
  type ScheduleNextActionKind,
  type ScheduleReadiness
} from "./scheduleViewModel";

type MealType = "breakfast" | "lunch" | "dinner" | "evening" | "other";
type MealStatus = "missing_recipe" | "diet" | "no_attendance" | "clear";

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
  meal_slot_id: string;
  starts_at: string;
  meal_type: MealType;
  title: string;
  status: "draft" | "ready" | "blocked";
  camp_recipe_copy_id: string | null;
  camp_recipe_copies: RecipeCopyRow | null;
  meal_reserves: MealReserveRow[];
}

interface MealSlotRow {
  id: string;
  service_date: string;
  starts_at: string;
  meal_type: MealType;
  label: string | null;
  service_status: "required" | "no_service";
  source: "default" | "extra" | "migrated";
  sort_order: number;
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
  repeatDates: string[];
}

const mealTypes: MealType[] = ["breakfast", "lunch", "dinner", "evening", "other"];
const mealTypeLabels: Record<MealType, string> = {
  breakfast: "Frukost",
  lunch: "Lunch",
  dinner: "Middag",
  evening: "Kvällsmål",
  other: "Extra"
};
const defaultMealTimes: Record<MealType, string> = {
  breakfast: "08:00",
  lunch: "12:00",
  dinner: "18:00",
  evening: "20:00",
  other: "15:00"
};
const successNotificationDurationMs = 3_000;

function dateTimeInputValue(value: string): string {
  const parsed = new Date(value);
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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

function MealStatusIcon({ status }: { status: MealStatus }) {
  if (status === "missing_recipe") return <CircleAlert className="meal-status meal-status--missing" aria-label="Recept saknas" size={18} fill="currentColor" />;
  if (status === "no_attendance") return <CircleAlert className="meal-status meal-status--missing" aria-label="Ingen närvarande deltagare eller reserv" size={18} fill="currentColor" />;
  if (status === "diet") return <Circle className="meal-status meal-status--diet" aria-label="Har specialkostreserver" size={13} fill="currentColor" />;
  return <Leaf className="meal-status meal-status--clear" aria-label="Recept klart" size={17} />;
}

export function SchedulePage() {
  const queryClient = useQueryClient();
  const { activeCamp, activeMembership } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [expandedSlotId, setExpandedSlotId] = useState<string | null>(null);
  const [editingMealId, setEditingMealId] = useState<string | null | undefined>(undefined);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [skipTargetSlotId, setSkipTargetSlotId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MealDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [slotSavingId, setSlotSavingId] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const mealActionTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const confirmPlanButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (message?.kind !== "success") return;
    const timeoutId = window.setTimeout(() => setMessage(null), successNotificationDurationMs);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  const scope = activeCamp && activeMembership
    ? { organizationId: activeMembership.organizationId, campId: activeCamp.id }
    : null;

  const scheduleQuery = useQuery({
    queryKey: ["camp-schedule", scope?.organizationId, scope?.campId],
    enabled: Boolean(scope && supabase),
    queryFn: async () => {
      if (!scope || !supabase) return { meals: [], slots: [], recipes: [], revision: null, readiness: null, zeroAttendance: [] };
      const [mealResult, slotResult, recipeResult, revisionResult, readinessResult, zeroAttendanceResult] = await Promise.all([
        supabase
          .from("meals")
          .select("id, meal_slot_id, starts_at, meal_type, title, status, camp_recipe_copy_id, camp_recipe_copies(id, name, source_recipe_version_id, version_key, recipe_versions(version_number)), meal_reserves(id, dietary_label, portions)")
          .eq("organization_id", scope.organizationId)
          .eq("camp_id", scope.campId)
          .order("starts_at"),
        supabase
          .from("camp_meal_slots")
          .select("id, service_date, starts_at, meal_type, label, service_status, source, sort_order")
          .eq("organization_id", scope.organizationId)
          .eq("camp_id", scope.campId)
          .order("service_date")
          .order("starts_at")
          .order("sort_order"),
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
          .maybeSingle(),
        supabase
          .rpc("get_zero_attendance_meals", { p_organization_id: scope.organizationId, p_camp_id: scope.campId })
      ]);
      const error = mealResult.error ?? slotResult.error ?? recipeResult.error ?? revisionResult.error ?? readinessResult.error ?? zeroAttendanceResult.error;
      if (error) throw error;
      return {
        meals: (mealResult.data ?? []) as unknown as MealRow[],
        slots: (slotResult.data ?? []) as MealSlotRow[],
        recipes: (recipeResult.data ?? []) as RecipeOptionRow[],
        revision: revisionResult.data as unknown as CalculationRevisionRow | null,
        readiness: readinessResult.data as ReadinessRow | null,
        zeroAttendance: (zeroAttendanceResult.data ?? []) as { meal_id: string; meal_slot_id: string }[]
      };
    }
  });

  const meals = scheduleQuery.data?.meals ?? [];
  const slots = scheduleQuery.data?.slots ?? [];
  const recipes = scheduleQuery.data?.recipes ?? [];
  const revision = scheduleQuery.data?.revision ?? null;
  const readiness = scheduleQuery.data?.readiness ?? null;
  const zeroAttendanceMealIds = new Set((scheduleQuery.data?.zeroAttendance ?? []).map((meal) => meal.meal_id));
  const versionOptions = recipes.flatMap((recipe) => recipe.recipe_versions
    .filter((version) => version.status === "published")
    .map((version) => ({ id: version.id, label: `${recipe.name} · version ${version.version_number}` }))
  );
  const dateKeys = activeCamp ? inclusiveCampDates(activeCamp.startsOn, activeCamp.endsOn) : [];
  const mealsBySlot = new Map(meals.map((meal) => [meal.meal_slot_id, meal]));
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]));
  const explicitlySelectedSlot = selectedSlotId ? slotsById.get(selectedSlotId) ?? null : null;
  const selectedMealById = selectedId ? meals.find((meal) => meal.id === selectedId) ?? null : null;
  // No implicit fallback meal: the panel must never describe a meal that no cell
  // shows as selected.
  const selectedMeal = explicitlySelectedSlot
    ? mealsBySlot.get(explicitlySelectedSlot.id) ?? null
    : selectedMealById;
  const selectedSlot = explicitlySelectedSlot
    ?? (selectedMeal ? slotsById.get(selectedMeal.meal_slot_id) ?? null : null);
  const skipTargetSlot = skipTargetSlotId ? slotsById.get(skipTargetSlotId) ?? null : null;
  const skipTargetMeal = skipTargetSlot ? mealsBySlot.get(skipTargetSlot.id) ?? null : null;
  const linesByMeal = new Map<string, CalculationLineRow[]>();
  for (const line of revision?.calculation_lines ?? []) {
    const current = linesByMeal.get(line.meal_id) ?? [];
    current.push(line);
    linesByMeal.set(line.meal_id, current);
  }
  const selectedLines = selectedMeal && selectedSlot?.service_status === "required"
    ? linesByMeal.get(selectedMeal.id) ?? []
    : [];
  const selectedMultiplier = selectedLines
    .map((line) => ({ line, mode: traceString(line.trace, "mode"), rule: traceString(line.trace, "dietary_rule") }))
    .find((entry) => entry.mode === "weighted_portion" && entry.rule === "standard");

  // Per-meal facts only. Camp-wide unresolved dietary review is already reported
  // once in the banner, so it must not stamp an identical warning on every meal.
  function statusForMeal(meal: MealRow): MealStatus {
    if (!meal.camp_recipe_copy_id) return "missing_recipe";
    if (zeroAttendanceMealIds.has(meal.id)) return "no_attendance";
    const hasSpecialReserve = visibleReserves(meal.meal_reserves)
      .some((reserve) => !["standard", "standardkost"].includes(reserve.dietary_label.toLocaleLowerCase("sv-SE")));
    return hasSpecialReserve ? "diet" : "clear";
  }

  function openNewMeal(slot?: MealSlotRow) {
    if (versionOptions.length === 0) return;
    setSelectedId(null);
    setSelectedSlotId(slot?.id ?? null);
    setEditingMealId(null);
    setEditingSlotId(slot?.id ?? null);
    setDraft({
      title: "",
      startsAt: slot ? dateTimeInputValue(slot.starts_at) : `${activeCamp?.startsOn ?? ""}T12:00`,
      mealType: slot?.meal_type ?? "lunch",
      recipeVersionId: "",
      reserves: emptyReserveDrafts(),
      repeatDates: []
    });
    setMessage(null);
  }

  function openMealEditor(meal: MealRow) {
    setSelectedId(meal.id);
    setSelectedSlotId(meal.meal_slot_id);
    setEditingMealId(meal.id);
    // The slot owns date, time and type, so editing stays bound to it.
    setEditingSlotId(meal.meal_slot_id);
    setDraft({
      title: meal.title,
      startsAt: dateTimeInputValue(meal.starts_at),
      mealType: meal.meal_type,
      recipeVersionId: meal.camp_recipe_copies?.source_recipe_version_id ?? "",
      reserves: visibleReserves(meal.meal_reserves)
        .map((reserve) => ({ id: reserve.id, dietaryLabel: reserve.dietary_label, portions: String(reserve.portions) })),
      repeatDates: []
    });
    setMessage(null);
  }

  function openExtraMeal(date: string, mealType: MealType) {
    if (versionOptions.length === 0) return;
    setSelectedId(null);
    setSelectedSlotId(null);
    setEditingMealId(null);
    setEditingSlotId(null);
    setDraft({
      title: "",
      startsAt: `${date}T${defaultMealTimes[mealType]}`,
      mealType,
      recipeVersionId: "",
      reserves: emptyReserveDrafts(),
      repeatDates: [date]
    });
    setMessage(null);
  }

  function selectSlot(slot: MealSlotRow, meal: MealRow | null) {
    setSelectedId(meal?.id ?? null);
    setSelectedSlotId(slot.id);
    setExpandedSlotId(slot.id);
    setEditingMealId(undefined);
    setEditingSlotId(null);
    setDraft(null);
    setMessage(null);
  }

  function closeSlotActions(slotId: string) {
    setExpandedSlotId(null);
    window.requestAnimationFrame(() => mealActionTriggerRefs.current.get(slotId)?.focus());
  }

  function handleSlotActionsKeyDown(event: KeyboardEvent<HTMLDivElement>, slotId: string) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeSlotActions(slotId);
  }

  function rememberMealActionTrigger(slotId: string, element: HTMLButtonElement | null) {
    if (element) mealActionTriggerRefs.current.set(slotId, element);
    else mealActionTriggerRefs.current.delete(slotId);
  }

  function closeMealEditor() {
    if (saving) return;
    setEditingMealId(undefined);
    setEditingSlotId(null);
    setDraft(null);
  }

  function updateReserve(id: string, patch: Partial<ReserveDraft>) {
    setDraft((current) => current ? {
      ...current,
      reserves: current.reserves.map((reserve) => reserve.id === id ? { ...reserve, ...patch } : reserve)
    } : current);
  }

  async function saveMeal() {
    if (!supabase || !scope || !draft || !draft.title.trim() || !draft.recipeVersionId) return;
    const targetSlotId = editingSlotId;
    const isRepeatingExtraMeal = editingMealId === null && editingSlotId === null;
    const repeatDates = [...new Set(draft.repeatDates)].filter(Boolean).sort();
    if (isRepeatingExtraMeal && repeatDates.length === 0) {
      setMessage({ kind: "error", text: "Välj minst en dag för det återkommande målet." });
      return;
    }
    setSaving(true);
    setMessage(null);
    const parsedStartsAt = new Date(draft.startsAt);
    if (Number.isNaN(parsedStartsAt.getTime())) {
      setMessage({ kind: "error", text: "Måltidstiden är ogiltig." });
      setSaving(false);
      return;
    }
    const reserves = draft.reserves
      .map((reserve) => ({
        dietary_label: reserve.dietaryLabel.trim(),
        portions: Math.max(0, Number.parseInt(reserve.portions || "0", 10) || 0)
      }))
      .filter((reserve) => reserve.dietary_label.length > 0 && reserve.portions > 0);
    const result = editingSlotId
      ? await supabase.rpc("save_meal_to_slot", {
          p_meal_id: (editingMealId ?? null) as unknown as string,
          p_meal_slot_id: editingSlotId,
          p_camp_id: scope.campId,
          p_title: draft.title.trim(),
          p_recipe_version_id: draft.recipeVersionId,
          p_reserves: reserves
        })
      : isRepeatingExtraMeal
        ? await supabase.rpc("save_repeating_extra_meals", {
            p_camp_id: scope.campId,
            p_service_dates: repeatDates,
            p_start_time: draft.startsAt.slice(11, 16),
            p_meal_type: draft.mealType,
            p_title: draft.title.trim(),
            p_recipe_version_id: draft.recipeVersionId,
            p_reserves: reserves
          })
        : await supabase.rpc("save_meal", {
          p_meal_id: (editingMealId ?? null) as unknown as string,
          p_camp_id: scope.campId,
          p_starts_at: parsedStartsAt.toISOString(),
          p_meal_type: draft.mealType,
          p_title: draft.title.trim(),
          p_recipe_version_id: draft.recipeVersionId,
          p_reserves: reserves
        });
    const { data, error } = result;
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
    setSelectedId(typeof data === "string" ? data : null);
    setSelectedSlotId(targetSlotId);
    setEditingMealId(undefined);
    setEditingSlotId(null);
    setDraft(null);
    setMessage({ kind: "success", text: isRepeatingExtraMeal ? "Extra måltider sparades. Beräkningen behöver köras om." : "Måltiden sparades. Beräkningen behöver köras om." });
    setSaving(false);
  }

  async function confirmDefaultPlan() {
    if (!supabase || !scope) return;
    setConfiguring(true);
    setMessage(null);
    const { error } = await supabase.rpc("confirm_default_meal_plan", { p_camp_id: scope.campId });
    if (error) {
      setMessage({ kind: "error", text: userFacingError(error, "Måltidstillfällena kunde inte skapas.") });
      setConfiguring(false);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["camp-schedule"] }),
      queryClient.invalidateQueries({ queryKey: ["camp-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["supply-export-readiness"] })
    ]);
    setMessage({ kind: "success", text: "Standardplanen skapades. Planera luckorna eller markera dagar utan servering." });
    setConfiguring(false);
  }

  async function setSlotServiceStatus(slot: MealSlotRow, serviceStatus: "required" | "no_service"): Promise<boolean> {
    if (!supabase) return false;
    const linkedMeal = mealsBySlot.get(slot.id) ?? null;
    setSlotSavingId(slot.id);
    setMessage(null);
    const { error } = await supabase.rpc("set_meal_slot_service_status", {
      p_slot_id: slot.id,
      p_service_status: serviceStatus
    });
    if (error) {
      setMessage({ kind: "error", text: userFacingError(error, "Måltidstillfället kunde inte ändras.") });
      setSlotSavingId(null);
      return false;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["camp-schedule"] }),
      queryClient.invalidateQueries({ queryKey: ["camp-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["supply-export-readiness"] })
    ]);
    setSelectedId(linkedMeal?.id ?? null);
    setSelectedSlotId(slot.id);
    setEditingMealId(undefined);
    setEditingSlotId(null);
    setDraft(null);
    setMessage({
      kind: "success",
      text: serviceStatus === "no_service"
        ? linkedMeal
          ? `${linkedMeal.title} markerades som ingen servering. Måltidsuppgifterna är bevarade och kan återställas.`
          : "Tillfället markerades som ingen servering."
        : linkedMeal
          ? `${linkedMeal.title} återställdes i matsedeln. Beräkningen behöver köras om.`
          : "Tillfället återställdes och behöver planeras."
    });
    setSlotSavingId(null);
    return true;
  }

  async function confirmSkip() {
    if (!skipTargetSlot) return;
    const changed = await setSlotServiceStatus(skipTargetSlot, "no_service");
    if (changed) setSkipTargetSlotId(null);
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

  function handleScheduleNextAction(kind: ScheduleNextActionKind) {
    if (kind === "confirm_meal_plan") {
      confirmPlanButtonRef.current?.scrollIntoView({ block: "center" });
      confirmPlanButtonRef.current?.focus();
      return;
    }
    if (kind === "plan_meal_slot") {
      const unplannedSlot = slots.find((slot) =>
        slot.service_status === "required" && !mealsBySlot.has(slot.id)
      );
      if (unplannedSlot) selectSlot(unplannedSlot, null);
      return;
    }
    if (kind === "choose_meal_recipe") {
      const mealWithoutRecipe = meals.find((meal) => !meal.camp_recipe_copy_id);
      if (mealWithoutRecipe) openMealEditor(mealWithoutRecipe);
      return;
    }
    if (kind === "review_zero_attendance") {
      const affectedMealId = scheduleQuery.data?.zeroAttendance[0]?.meal_id;
      const affectedMeal = affectedMealId ? meals.find((meal) => meal.id === affectedMealId) : null;
      const affectedSlot = affectedMeal ? slotsById.get(affectedMeal.meal_slot_id) : null;
      if (affectedMeal && affectedSlot) selectSlot(affectedSlot, affectedMeal);
      return;
    }
    if (kind === "calculate") void calculate();
  }

  if (!scope || !activeCamp || !activeMembership) {
    return <section className="page page--narrow"><p className="form-error">Välj organisation och läger först.</p></section>;
  }

  const nextAction = scheduleNextAction(readiness);
  const tutorialMealId = meals.find((meal) =>
    slotsById.get(meal.meal_slot_id)?.service_status === "required"
  )?.id ?? null;
  const nextActionPath = nextAction?.kind === "review_dietary_needs"
    ? "/specialkost"
    : nextAction?.kind === "choose_meal_recipe" && versionOptions.length === 0
      ? "/recept"
      : null;
  const nextActionLabel = nextAction?.kind === "choose_meal_recipe" && versionOptions.length === 0
    ? "Öppna recepten"
    : nextAction?.kind === "calculate" && calculating
      ? "Räknar om…"
      : nextAction?.label;
  const nextActionContent = nextAction ? (
    <>
      <CircleAlert aria-hidden="true" size={24} fill="currentColor" />
      <span className="warning-banner__copy" data-tutorial-id="schedule-status">
        <strong>{nextAction.title}</strong>
        <small>{nextAction.description}</small>
      </span>
      <span className="warning-banner__action">{nextActionLabel} <ChevronRight aria-hidden="true" size={17} /></span>
    </>
  ) : null;
  const selectedReserves = selectedMeal ? visibleReserves(selectedMeal.meal_reserves) : [];
  const isRepeatingExtraMeal = Boolean(draft && editingMealId === null && editingSlotId === null);
  const recurringPreview = draft && isRepeatingExtraMeal
    ? recurringExtraMealPreview({
        dates: draft.repeatDates,
        mealType: draft.mealType,
        time: draft.startsAt.slice(11, 16),
        slots,
        plannedSlotIds: new Set(meals.map((meal) => meal.meal_slot_id)),
        timeForSlot: (slot) => timeLabel(slot.starts_at, activeCamp.timezone)
      })
    : [];
  const recurringHasConflict = recurringPreview.some((item) => item.state === "conflict");

  return (
    <section className="page schedule-page" data-tutorial-id="schedule-page">
      <div
        className="page-heading page-heading--split schedule-heading"
        data-tutorial-id="schedule-heading"
      >
        <div>
          <p className="page-heading__eyebrow">Planera måltider</p>
          <h1>Matsedel</h1>
          <p>{[
            formatCampPeriod(activeCamp.startsOn, activeCamp.endsOn),
            readiness ? `${readiness.planned_slots}/${readiness.required_slots} tillfällen planerade` : `${meals.length} ${meals.length === 1 ? "måltid" : "måltider"}`,
            scheduleCalculationLabel(Boolean(revision), meals.length)
          ].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="page-actions">
          <Button
            className="secondary-button"
            data-tutorial-id="schedule-calculate"
            onPress={calculate}
            isDisabled={calculating || (readiness?.planned_slots ?? meals.length) === 0}
          >
            {calculating ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <Calculator aria-hidden="true" size={18} />} Räkna ut mängder
          </Button>
          <Button className="primary-button" onPress={() => openNewMeal()} isDisabled={versionOptions.length === 0}><CalendarPlus aria-hidden="true" size={19} /> Lägg till extra måltid</Button>
        </div>
      </div>

      {message?.kind === "error" ? <p className="form-error" role="alert"><CircleAlert aria-hidden="true" size={18} />{message.text}</p> : null}
      {message?.kind === "success" ? (
        <div className="schedule-toast" role="status" aria-live="polite" aria-atomic="true">
          <Check aria-hidden="true" size={19} />
          <span>{message.text}</span>
          <Button className="schedule-toast__close" aria-label="Stäng meddelandet" onPress={() => setMessage(null)}>
            <X aria-hidden="true" size={17} />
          </Button>
        </div>
      ) : null}

      {scheduleQuery.isLoading ? <LoaderCircle className="spin" aria-label="Läser matsedel" size={30} /> : scheduleQuery.error ? (
        <p className="form-error">{userFacingError(scheduleQuery.error, "Matsedeln kunde inte läsas.")}</p>
      ) : (
        <div className="schedule-layout">
          <div className="schedule-workspace">
            {nextAction && nextActionContent ? nextActionPath ? (
              <Link to={nextActionPath} className="warning-banner">
                {nextActionContent}
              </Link>
            ) : (
              <Button
                className="warning-banner"
                onPress={() => handleScheduleNextAction(nextAction.kind)}
                isDisabled={nextAction.kind === "calculate" && calculating}
              >
                {nextActionContent}
              </Button>
            ) : readiness ? (
              <div className="schedule-ready-banner">
                <Check aria-hidden="true" size={23} />
                <span className="warning-banner__copy" data-tutorial-id="schedule-status">
                  <strong>Matsedeln är klar</strong>
                  <small>{revision ? "Alla måltider är planerade och mängderna är aktuella." : "Alla måltider är planerade och granskade."}</small>
                </span>
              </div>
            ) : null}

            {!readiness?.meal_plan_confirmed ? (
              <div className="meal-plan-setup">
                <div>
                  <h2>Skapa lägrets måltidstillfällen</h2>
                  <p>Standardplanen lägger in frukost, lunch och middag för varje lägerdag. Därefter kan du markera första eller sista dagens tillfällen som ingen servering och lägga till extra mål.</p>
                </div>
                <Button ref={confirmPlanButtonRef} className="primary-button" onPress={confirmDefaultPlan} isDisabled={configuring}>
                  {configuring ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <CalendarPlus aria-hidden="true" size={18} />}
                  {configuring ? "Skapar plan…" : "Bekräfta standardplan"}
                </Button>
              </div>
            ) : null}

            {versionOptions.length === 0 ? (
              <div className="empty-panel"><h2>Välj recept innan du planerar rätterna</h2><p>Måltidstillfällena kan konfigureras nu, men varje planerad måltid behöver ett publicerat recept.</p><Link to="/recept" className="primary-button">Öppna recepten</Link></div>
            ) : null}

            <div className="schedule-table-wrap" data-tutorial-id="schedule-grid">
              <table className="schedule-table">
                <caption className="sr-only">Alla lägerdagar och konfigurerade måltidstillfällen</caption>
                <thead><tr><th scope="col"><span className="sr-only">Måltidstyp</span></th>{dateKeys.map((date, index) => {
                  const heading = dayHeading(`${date}T12:00:00`, activeCamp.timezone);
                  return (
                    <th scope="col" key={date}>
                      <strong data-tutorial-id={index === 0 ? "schedule-grid-heading" : undefined}>
                        {heading.weekday}
                      </strong>
                      <span>{heading.date}</span>
                    </th>
                  );
                })}</tr></thead>
                <tbody>{mealTypes.map((type) => <tr key={type}><th scope="row">{mealTypeLabels[type]}</th>{dateKeys.map((date) => {
                  const cellSlots = slots.filter((slot) => slot.meal_type === type && slot.service_date === date);
                  return (
                    <td key={`${type}-${date}`}>
                      <div className="meal-slot-stack">
                        {cellSlots.map((slot) => {
                          const meal = mealsBySlot.get(slot.id);
                          const isSelected = selectedSlotId === slot.id;
                          const isExpanded = expandedSlotId === slot.id;
                          const actionRegionId = `meal-slot-actions-${slot.id}`;
                          if (slot.service_status === "no_service") {
                            const restoreLabel = meal ? "Återställ måltid" : "Återställ tillfälle";
                            return (
                              <div
                                className={`meal-slot meal-slot--none${isSelected ? " meal-slot--selected" : ""}`}
                                key={slot.id}
                              >
                                <Button
                                  ref={(element) => rememberMealActionTrigger(slot.id, element)}
                                  className="meal-card__trigger"
                                  onPress={() => selectSlot(slot, meal ?? null)}
                                  aria-label={`Ingen servering, ${meal ? `${meal.title} bevarad, ` : ""}${mealTypeLabels[slot.meal_type]} ${slot.service_date}, öppna återställning`}
                                  aria-expanded={isExpanded}
                                  aria-controls={actionRegionId}
                                >
                                  <span><Ban aria-hidden="true" size={16} /> Ingen servering</span>
                                  {meal ? <strong>{meal.title} är bevarad</strong> : null}
                                  <span className="meal-slot__cta">{restoreLabel} <ChevronRight className="meal-card__chevron" aria-hidden="true" size={15} /></span>
                                </Button>
                                {isExpanded ? (
                                  <div
                                    className="meal-card__actions meal-card__actions--single"
                                    id={actionRegionId}
                                    role="group"
                                    aria-label={`Åtgärder för ${mealTypeLabels[slot.meal_type]} ${slot.service_date}`}
                                    onKeyDown={(event) => handleSlotActionsKeyDown(event, slot.id)}
                                  >
                                    <span className="meal-card__actions-title">{restoreLabel}</span>
                                    <Button className="meal-card__close" onPress={() => closeSlotActions(slot.id)} aria-label="Stäng måltidsval"><X aria-hidden="true" size={15} /></Button>
                                    <Button
                                      autoFocus
                                      className="meal-card__action meal-card__action--primary"
                                      onPress={() => setSlotServiceStatus(slot, "required")}
                                      isDisabled={slotSavingId === slot.id}
                                      aria-label={`${restoreLabel}, ${mealTypeLabels[slot.meal_type]} ${slot.service_date}`}
                                    >
                                      {slotSavingId === slot.id ? <LoaderCircle className="spin" aria-hidden="true" size={15} /> : <RotateCcw aria-hidden="true" size={15} />}
                                      {restoreLabel}
                                    </Button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          }
                          if (meal) {
                            return (
                              <div
                                key={slot.id}
                                className={`meal-cell${isSelected ? " meal-cell--selected" : ""}`}
                              >
                                <Button
                                  ref={(element) => rememberMealActionTrigger(slot.id, element)}
                                  className="meal-card__trigger"
                                  onPress={() => selectSlot(slot, meal)}
                                  aria-label={`${meal.title}, ${timeLabel(meal.starts_at, activeCamp.timezone)}, ${mealTypeLabels[meal.meal_type]}, öppna måltidsval`}
                                  aria-expanded={isExpanded}
                                  aria-controls={actionRegionId}
                                >
                                  <strong data-tutorial-id={meal.id === tutorialMealId
                                    ? "schedule-meal-example"
                                    : undefined}
                                  >{meal.title}</strong>
                                  <span className="meal-cell__meta"><span>{timeLabel(meal.starts_at, activeCamp.timezone)} · {linesByMeal.has(meal.id) ? "beräknad" : "ej beräknad"}</span><MealStatusIcon status={statusForMeal(meal)} /></span>
                                  <span className="meal-cell__hint">Ändra måltid <ChevronRight className="meal-card__chevron" aria-hidden="true" size={14} /></span>
                                </Button>
                                {isExpanded ? (
                                  <div
                                    className="meal-card__actions"
                                    id={actionRegionId}
                                    role="group"
                                    aria-label={`Åtgärder för ${meal.title}`}
                                    onKeyDown={(event) => handleSlotActionsKeyDown(event, slot.id)}
                                  >
                                    <span className="meal-card__actions-title">Ändra måltid</span>
                                    <Button className="meal-card__close" onPress={() => closeSlotActions(slot.id)} aria-label="Stäng måltidsval"><X aria-hidden="true" size={15} /></Button>
                                    <Button autoFocus className="meal-card__action meal-card__action--primary" onPress={() => openMealEditor(meal)} aria-label={`Redigera ${meal.title}`}>
                                      <Pencil aria-hidden="true" size={15} /> Redigera
                                    </Button>
                                    <Button className="meal-card__action meal-card__action--danger" onPress={() => setSkipTargetSlotId(slot.id)} aria-label={`Markera ${meal.title} som ingen servering`}>
                                      <Ban aria-hidden="true" size={15} /> Ingen servering
                                    </Button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          }
                          return (
                            <div
                              className={`meal-slot meal-slot--gap${isSelected ? " meal-slot--selected" : ""}`}
                              key={slot.id}
                            >
                              <Button
                                ref={(element) => rememberMealActionTrigger(slot.id, element)}
                                className="meal-card__trigger"
                                onPress={() => selectSlot(slot, null)}
                                aria-label={`Oplanerat, ${mealTypeLabels[slot.meal_type]} ${slot.service_date}, ${timeLabel(slot.starts_at, activeCamp.timezone)}, öppna planering`}
                                aria-expanded={isExpanded}
                                aria-controls={actionRegionId}
                              >
                                <strong>Oplanerat</strong>
                                <span>{timeLabel(slot.starts_at, activeCamp.timezone)}</span>
                                <span className="meal-slot__cta">Planera tillfälle <ChevronRight className="meal-card__chevron" aria-hidden="true" size={15} /></span>
                              </Button>
                              {isExpanded ? (
                                <div
                                  className="meal-card__actions"
                                  id={actionRegionId}
                                  role="group"
                                  aria-label={`Åtgärder för ${mealTypeLabels[slot.meal_type]} ${slot.service_date}`}
                                  onKeyDown={(event) => handleSlotActionsKeyDown(event, slot.id)}
                                >
                                  <span className="meal-card__actions-title">Planera tillfälle</span>
                                  <Button className="meal-card__close" onPress={() => closeSlotActions(slot.id)} aria-label="Stäng måltidsval"><X aria-hidden="true" size={15} /></Button>
                                  <Button
                                    autoFocus
                                    className="meal-card__action meal-card__action--primary"
                                    onPress={() => openNewMeal(slot)}
                                    isDisabled={versionOptions.length === 0}
                                    aria-label={`Lägg till ${mealTypeLabels[slot.meal_type]} ${slot.service_date}`}
                                  >
                                    <Plus aria-hidden="true" size={15} /> Lägg till måltid
                                  </Button>
                                  <Button
                                    className="meal-card__action meal-card__action--danger"
                                    onPress={() => setSkipTargetSlotId(slot.id)}
                                    aria-label={`Markera ${mealTypeLabels[slot.meal_type]} ${slot.service_date} som ingen servering`}
                                  >
                                    <Ban aria-hidden="true" size={15} /> Ingen servering
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                        {cellSlots.length === 0 && readiness?.meal_plan_confirmed && (type === "evening" || type === "other") ? (
                          <Button className="meal-slot-add" onPress={() => openExtraMeal(date, type)} isDisabled={versionOptions.length === 0}>
                            <Plus aria-hidden="true" size={15} /> Lägg till
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  );
                })}</tr>)}</tbody>
              </table>
            </div>

            <div className="schedule-legend" aria-label="Statusförklaring">
              <span><i className="legend-swatch legend-swatch--gap" aria-hidden="true" /> Oplanerat tillfälle</span>
              <span><Ban aria-hidden="true" size={15} /> Ingen servering</span>
              <span><CircleAlert className="meal-status--missing" aria-hidden="true" size={16} fill="currentColor" /> Recept saknas</span>
              <span><CircleAlert className="meal-status--missing" aria-hidden="true" size={16} fill="currentColor" /> Ingen deltagare eller reserv</span>
              <span><Circle className="meal-status--diet" aria-hidden="true" size={12} fill="currentColor" /> Har specialkostreserver</span>
              <span><Leaf className="meal-status--clear" aria-hidden="true" size={16} /> Recept klart</span>
            </div>
          </div>

          <aside className="meal-detail" aria-labelledby="meal-detail-title">
            {selectedSlot?.service_status === "no_service" ? (
              <>
                <div className="meal-detail__heading">
                  <div>
                    <p className="page-heading__eyebrow">Måltidstillfälle</p>
                    <h2 id="meal-detail-title">Ingen servering</h2>
                    <p>{dayHeading(selectedSlot.starts_at, activeCamp.timezone).weekday} · {timeLabel(selectedSlot.starts_at, activeCamp.timezone)} · {mealTypeLabels[selectedSlot.meal_type]}</p>
                  </div>
                </div>
                {selectedMeal ? (
                  <div className="skipped-meal-summary">
                    <Ban aria-hidden="true" size={22} />
                    <div>
                      <strong>{selectedMeal.title} är bevarad</strong>
                      <span>Recept, extra portioner och övriga uppgifter finns kvar men ingår inte i beräkningen.</span>
                    </div>
                  </div>
                ) : (
                  <p className="muted-copy">Tillfället ingår inte i lägrets måltidsplan.</p>
                )}
              </>
            ) : selectedMeal ? (
              <>
                <div className="meal-detail__heading"><div><h2 id="meal-detail-title">{selectedMeal.title}</h2><p>{dayHeading(selectedMeal.starts_at, activeCamp.timezone).weekday} · {timeLabel(selectedMeal.starts_at, activeCamp.timezone)} · {mealTypeLabels[selectedMeal.meal_type]}</p></div></div>
                {zeroAttendanceMealIds.has(selectedMeal.id) ? <p className="form-error" role="alert"><CircleAlert aria-hidden="true" size={18} />Ingen deltagare eller reserv är närvarande vid den här tiden. Ändra närvaro eller tid, lägg till en reservportion, eller markera tillfället som ingen servering.</p> : null}
                <div className="portion-count"><UsersRound aria-hidden="true" size={22} /><strong>{selectedMultiplier ? `Motsvarar ${decimal(Number(traceString(selectedMultiplier.line.trace, "multiplier")))} normalportioner` : "Inte beräknad"}</strong><span>Beräknat från deltagarnas portionsstorlek och närvaro</span></div>
                <div className="detail-section"><div className="detail-section__title"><h3>Recept för måltiden</h3><ChevronRight aria-hidden="true" size={17} /></div><dl><div><dt>Recept</dt><dd>{selectedMeal.camp_recipe_copies?.name ?? "Saknas"}</dd></div><div><dt>Version</dt><dd>{selectedMeal.camp_recipe_copies?.recipe_versions ? `Version ${selectedMeal.camp_recipe_copies.recipe_versions.version_number}` : "Version saknas"}</dd></div><div><dt>Extra portioner</dt><dd>{selectedReserves.length > 0 ? selectedReserves.map((reserve) => `${reserve.portions} ${reserve.dietary_label}`).join(", ") : "Inga"}</dd></div></dl></div>
                <div className="calculation-detail"><div className="detail-section__title"><h3>Beräknade mängder</h3><span>{selectedLines.length} {selectedLines.length === 1 ? "ingrediens" : "ingredienser"}</span></div>{selectedLines.length === 0 ? <p className="muted-copy">Räkna ut mängderna för att se ingredienserna här.</p> : <ul>{selectedLines.sort((left, right) => left.ingredient_name.localeCompare(right.ingredient_name, "sv-SE")).map((line) => {
                  const practical = practicalSupplyAmount(line.exact_amount, line.unit);
                  return <li key={line.id}><div><strong>{line.ingredient_name}</strong><span>{practical.display}</span></div><details><summary>Så räknades mängden ut</summary><p>Exakt beräkning: {decimal(line.exact_amount)} {line.unit}.</p><p>{readableFormula(line.trace)}</p><p>{traceGroups(line.trace)} {traceGroups(line.trace) === 1 ? "grupp ingår" : "grupper ingår"}.</p></details></li>;
                })}</ul>}</div>
              </>
            ) : selectedSlot ? (
              <div className="meal-action-panel">
                <div className="meal-detail__heading">
                  <div>
                    <p className="page-heading__eyebrow">Oplanerat tillfälle</p>
                    <h2 id="meal-detail-title">{mealTypeLabels[selectedSlot.meal_type]}</h2>
                    <p>{dayHeading(selectedSlot.starts_at, activeCamp.timezone).weekday} · {timeLabel(selectedSlot.starts_at, activeCamp.timezone)}</p>
                  </div>
                </div>
                <p className="muted-copy">Tillfället har ingen måltid ännu.</p>
              </div>
            ) : <div className="empty-panel"><h2 id="meal-detail-title">Välj en måltid</h2><p>Detaljer och nästa åtgärd visas här.</p></div>}
          </aside>
        </div>
      )}
      {draft ? (
        <ModalOverlay
          className="dialog-overlay"
          isOpen
          isDismissable={!saving}
          onOpenChange={(isOpen) => {
            if (!isOpen) closeMealEditor();
          }}
        >
          <Modal className="dialog-modal dialog-modal--wide">
            <Dialog className="meal-editor-dialog" aria-labelledby="meal-editor-dialog-title">
              <div className="meal-editor-dialog__heading">
                <div>
                  <p className="page-heading__eyebrow">{editingMealId ? "Redigera måltid" : "Ny måltid"}</p>
                  <h2 id="meal-editor-dialog-title">Måltidsunderlag</h2>
                  {editingSlotId ? <p>{mealTypeLabels[draft.mealType]} · {dateTimeInputValue(draft.startsAt).replace("T", " ")}</p> : null}
                </div>
                <Button className="icon-button" aria-label="Stäng måltidsformulär" onPress={closeMealEditor} isDisabled={saving}><X aria-hidden="true" size={21} /></Button>
              </div>
              <div className="meal-editor">
                <div className="meal-editor__fields">
                  <label>Titel<input name="meal-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
                  {editingSlotId ? null : isRepeatingExtraMeal ? (
                    <>
                      <label>Tid<input name="meal-start-time" type="time" value={draft.startsAt.slice(11, 16)} onChange={(event) => setDraft({ ...draft, startsAt: `${activeCamp.startsOn}T${event.target.value}` })} /></label>
                      <label>Typ<select name="meal-type" value={draft.mealType} onChange={(event) => setDraft({ ...draft, mealType: event.target.value as MealType })}>{mealTypes.map((type) => <option key={type} value={type}>{mealTypeLabels[type]}</option>)}</select></label>
                    </>
                  ) : (
                    <>
                      <label>Tid<input name="meal-starts-at" type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} /></label>
                      <label>Typ<select name="meal-type" value={draft.mealType} onChange={(event) => setDraft({ ...draft, mealType: event.target.value as MealType })}>{mealTypes.map((type) => <option key={type} value={type}>{mealTypeLabels[type]}</option>)}</select></label>
                    </>
                  )}
                  <label>Publicerad receptversion<select name="meal-recipe-version" value={draft.recipeVersionId} onChange={(event) => setDraft({ ...draft, recipeVersionId: event.target.value })}><option value="">Välj recept</option>{versionOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
                  {isRepeatingExtraMeal ? <fieldset className="meal-editor__repeat-dates"><legend>Upprepa på valda dagar</legend><p className="muted-copy">Samma extra mål skapas på de dagar du väljer. Krockar stoppas innan något sparas.</p><div>{dateKeys.map((date) => <label key={date}><input type="checkbox" checked={draft.repeatDates.includes(date)} onChange={(event) => setDraft({ ...draft, repeatDates: event.target.checked ? [...draft.repeatDates, date] : draft.repeatDates.filter((selectedDate) => selectedDate !== date) })} />{dayHeading(`${date}T12:00:00`, activeCamp.timezone).weekday} {dayHeading(`${date}T12:00:00`, activeCamp.timezone).date}</label>)}</div>{recurringPreview.length > 0 ? <ul>{recurringPreview.map((item) => <li key={item.date}>{dayHeading(`${item.date}T12:00:00`, activeCamp.timezone).weekday} {dayHeading(`${item.date}T12:00:00`, activeCamp.timezone).date}: {item.state === "new" ? "skapas" : item.state === "reuse" ? "återanvänder ledigt tillfälle" : item.reason}</li>)}</ul> : null}</fieldset> : null}
                </div>
                <div className="meal-reserve-editor"><div className="detail-section__title"><h3>Extra portioner</h3><Button className="text-button" onPress={() => setDraft({ ...draft, reserves: [...draft.reserves, { id: crypto.randomUUID(), dietaryLabel: "Standardkost", portions: "1" }] })}><Plus aria-hidden="true" size={16} /> Lägg till</Button></div>{draft.reserves.map((reserve) => <div className="meal-reserve-row" key={reserve.id}><label><span>Typ av specialkost</span><input name={`reserve-diet-${reserve.id}`} value={reserve.dietaryLabel} onChange={(event) => updateReserve(reserve.id, { dietaryLabel: event.target.value })} /></label><label><span>Antal</span><input name={`reserve-portions-${reserve.id}`} type="number" min="0" step="1" value={reserve.portions} onChange={(event) => updateReserve(reserve.id, { portions: event.target.value })} /></label><Button className="icon-button" aria-label={`Ta bort extra portion ${reserve.dietaryLabel}`} onPress={() => setDraft({ ...draft, reserves: draft.reserves.filter((item) => item.id !== reserve.id) })}><X aria-hidden="true" size={18} /></Button></div>)}</div>
                <div className="meal-editor__actions">
                  <Button className="button-link" onPress={closeMealEditor} isDisabled={saving}>Avbryt</Button>
                  <Button className="primary-button meal-editor__save" onPress={saveMeal} isDisabled={saving || !draft.title.trim() || !draft.recipeVersionId || (isRepeatingExtraMeal && (draft.repeatDates.length === 0 || recurringHasConflict))}>{saving ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <Save aria-hidden="true" size={18} />} Spara måltid</Button>
                </div>
              </div>
            </Dialog>
          </Modal>
        </ModalOverlay>
      ) : null}
      {skipTargetSlot ? (
        <ModalOverlay
          className="dialog-overlay"
          isOpen
          isDismissable={slotSavingId !== skipTargetSlot.id}
          onOpenChange={(isOpen) => {
            if (!isOpen && slotSavingId !== skipTargetSlot.id) setSkipTargetSlotId(null);
          }}
        >
          <Modal className="dialog-modal">
            <Dialog className="meal-skip-dialog" role="alertdialog" aria-labelledby="meal-skip-dialog-title">
              <div className="meal-skip-dialog__heading">
                <div>
                  <p className="page-heading__eyebrow">Bekräfta ingen servering</p>
                  <h2 id="meal-skip-dialog-title">Markera {skipTargetMeal ? skipTargetMeal.title : mealTypeLabels[skipTargetSlot.meal_type]} som ingen servering?</h2>
                </div>
                <Button className="icon-button" aria-label="Stäng bekräftelsen" onPress={() => setSkipTargetSlotId(null)} isDisabled={slotSavingId === skipTargetSlot.id}><X aria-hidden="true" size={21} /></Button>
              </div>
              <div className="meal-skip-dialog__body">
                <p>
                  Tillfället markeras som <strong>Ingen servering</strong> och tas bort från måltidstäckning och nästa beräkning.
                  {skipTargetMeal ? " Måltidsuppgifterna bevaras så att du kan återställa dem senare." : ""}
                </p>
                <div className="meal-skip-dialog__actions">
                  <Button className="button-link" onPress={() => setSkipTargetSlotId(null)} isDisabled={slotSavingId === skipTargetSlot.id}>Avbryt</Button>
                  <Button className="danger-button" onPress={confirmSkip} isDisabled={slotSavingId === skipTargetSlot.id}>
                    {slotSavingId === skipTargetSlot.id ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <Ban aria-hidden="true" size={18} />}
                    {slotSavingId === skipTargetSlot.id ? "Markerar…" : "Markera som ingen servering"}
                  </Button>
                </div>
              </div>
            </Dialog>
          </Modal>
        </ModalOverlay>
      ) : null}
    </section>
  );
}
