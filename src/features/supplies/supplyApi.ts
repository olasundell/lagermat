import { supabase } from "../../lib/supabase";
import { cacheSupplyLists, queueSupplyItemChange, readCachedSupplyLists, syncPendingMutations } from "./offlineSync";
import type { SupplyItemRow, SupplyListKind, SupplyListRow, SupplyListStatus } from "./supplyModel";
import type { SupplyExportReadiness } from "./exportModel";

export interface SupplyScope {
  userId: string;
  organizationId: string;
  campId: string;
}

export interface SupplyListSnapshot {
  lists: SupplyListRow[];
  source: "server" | "cache";
  cachedAt: string | null;
}

export interface SupplyItemPatch {
  orderedAmount: number | null;
  orderedUnit: string;
  packageNote: string;
  comment: string;
  completed: boolean;
}

export async function fetchCurrentCalculation(scope: SupplyScope): Promise<{ id: string } | null> {
  if (!supabase) throw new Error("Databasen är inte konfigurerad.");
  const { data, error } = await supabase
    .from("calculation_revisions")
    .select("id")
    .eq("organization_id", scope.organizationId)
    .eq("camp_id", scope.campId)
    .eq("status", "current")
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchSupplyLists(scope: SupplyScope, kinds: SupplyListKind[]): Promise<SupplyListSnapshot> {
  if (!navigator.onLine) {
    const cached = await readCachedSupplyLists(scope, kinds);
    if (cached.cachedAt) return { ...cached, source: "cache" };
    throw new Error("Inga inköpslistor har sparats på den här datorn ännu.");
  }
  try {
    if (!supabase) throw new Error("Databasen är inte konfigurerad.");
    const { data, error } = await supabase
      .from("supply_lists")
      .select("id, list_key, kind, status, title, range_start, range_end, version, source_present, calculation_revisions(revision_number, status), supply_list_items(id, item_key, canonical_key, category, item_name, required_amount, required_unit, ordered_amount, ordered_unit, package_note, comment, completed, row_version, source_present, manually_moved)")
      .eq("organization_id", scope.organizationId)
      .eq("camp_id", scope.campId)
      .eq("source_present", true)
      .in("kind", kinds)
      .order("range_start", { ascending: true, nullsFirst: true });
    if (error) throw error;
    const lists = (data ?? []) as unknown as SupplyListRow[];
    await cacheSupplyLists(scope, lists);
    const cached = await readCachedSupplyLists(scope, kinds);
    return { ...cached, source: "server" };
  } catch (error) {
    const cached = await readCachedSupplyLists(scope, kinds);
    if (cached.cachedAt) return { ...cached, source: "cache" };
    throw error;
  }
}

export async function generateSupplyLists(scope: SupplyScope): Promise<void> {
  if (!supabase) throw new Error("Databasen är inte konfigurerad.");
  const { error } = await supabase.rpc("generate_supply_lists", {
    p_organization_id: scope.organizationId,
    p_camp_id: scope.campId
  });
  if (error) throw error;
}

export function createSupplyReadinessProblems(data: {
  meal_plan_confirmed: boolean;
  unplanned_slots: number;
  unresolved_dietary_needs: number;
  meals_without_recipe: number;
  calculation_stale: boolean;
}): string[] {
  const problems: string[] = [];
  if (!data.meal_plan_confirmed) {
    problems.push("Lägrets måltidstillfällen är inte bekräftade");
  }
  if (data.unplanned_slots > 0) {
    problems.push(data.unplanned_slots === 1
      ? "1 måltidstillfälle är oplanerat"
      : `${data.unplanned_slots} måltidstillfällen är oplanerade`);
  }
  if (data.unresolved_dietary_needs > 0) {
    problems.push(data.unresolved_dietary_needs === 1
      ? "1 specialkostuppgift återstår"
      : `${data.unresolved_dietary_needs} specialkostuppgifter återstår`);
  }
  if (data.meals_without_recipe > 0) {
    problems.push(data.meals_without_recipe === 1
      ? "1 måltid saknar recept"
      : `${data.meals_without_recipe} måltider saknar recept`);
  }
  if (data.calculation_stale) problems.push("Beräkningen saknas eller är inaktuell");
  return problems;
}

export async function fetchSupplyExportReadiness(scope: SupplyScope): Promise<SupplyExportReadiness> {
  if (!supabase) throw new Error("Databasen är inte konfigurerad.");
  const { data, error } = await supabase
    .rpc("get_camp_readiness", { p_organization_id: scope.organizationId, p_camp_id: scope.campId })
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Det gick inte att kontrollera om underlaget är redo.");
  const problems = createSupplyReadinessProblems(data);
  return { canFinalize: data.can_finalize, problems };
}

export async function saveSupplyItem(
  scope: SupplyScope,
  listId: string,
  item: SupplyItemRow,
  patch: SupplyItemPatch
): Promise<void> {
  const queued = await queueSupplyItemChange(scope, listId, item, patch);
  if (queued && navigator.onLine) await syncPendingMutations(scope);
}

export async function moveDeliveryItem(item: SupplyItemRow, targetListId: string): Promise<void> {
  if (!supabase) throw new Error("Databasen är inte konfigurerad.");
  const { error } = await supabase.rpc("move_delivery_item", {
    p_item_id: item.id,
    p_target_list_id: targetListId,
    p_expected_version: item.row_version
  });
  if (error) throw error;
}

export async function changeSupplyListStatus(list: SupplyListRow, status: SupplyListStatus): Promise<void> {
  if (!supabase) throw new Error("Databasen är inte konfigurerad.");
  const { error } = await supabase.rpc("set_supply_list_status", {
    p_list_id: list.id,
    p_expected_version: list.version,
    p_status: status
  });
  if (error) throw error;
}
