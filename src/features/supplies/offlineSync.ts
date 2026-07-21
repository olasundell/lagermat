import { offlineDb, notifyOfflineStateChanged, type EditableSupplyChanges, type EditableSupplyValues, type PendingMutation, type SupplyConflictField } from "../../lib/offlineDb";
import { supabase } from "../../lib/supabase";
import type { Json } from "../../types/database";
import type { SupplyItemPatch, SupplyScope } from "./supplyApi";
import type { SupplyItemRow, SupplyListKind, SupplyListRow } from "./supplyModel";

export interface CachedListResult {
  lists: SupplyListRow[];
  cachedAt: string | null;
}

export interface MutationServerResult {
  status: "applied" | "conflict";
  replayed: boolean;
  item_id: string;
  server_version: number;
  server_values: EditableSupplyValues;
  conflicts: SupplyConflictField[];
}

function snapshotId(scope: SupplyScope): string {
  return `${scope.userId}:${scope.organizationId}:${scope.campId}`;
}

function editableValues(item: SupplyItemRow): EditableSupplyValues {
  return {
    ordered_amount: item.ordered_amount,
    ordered_unit: item.ordered_unit,
    package_note: item.package_note,
    comment: item.comment,
    completed: item.completed
  };
}

function normalizedPatch(patch: SupplyItemPatch): EditableSupplyValues {
  return {
    ordered_amount: patch.orderedAmount,
    ordered_unit: patch.orderedUnit.trim() || null,
    package_note: patch.packageNote.trim() || null,
    comment: patch.comment.trim() || null,
    completed: patch.completed
  };
}

export function changedValues(base: EditableSupplyValues, desired: EditableSupplyValues): EditableSupplyChanges {
  const changes: EditableSupplyChanges = {};
  for (const field of Object.keys(base) as Array<keyof EditableSupplyValues>) {
    if (base[field] !== desired[field]) Object.assign(changes, { [field]: desired[field] });
  }
  return changes;
}

export async function cacheSupplyLists(scope: SupplyScope, lists: SupplyListRow[]): Promise<void> {
  await offlineDb.supplySnapshots.put({
    id: snapshotId(scope),
    userId: scope.userId,
    organizationId: scope.organizationId,
    campId: scope.campId,
    lists,
    cachedAt: new Date().toISOString()
  });

  const mutations = await offlineDb.mutations
    .filter((mutation) => mutation.userId === scope.userId && mutation.organizationId === scope.organizationId && mutation.campId === scope.campId)
    .sortBy("createdAt");
  for (const mutation of mutations) await updateCachedItem(scope, mutation.entityId, mutation.changes);
}

export async function readCachedSupplyLists(scope: SupplyScope, kinds: SupplyListKind[]): Promise<CachedListResult> {
  const snapshot = await offlineDb.supplySnapshots.get(snapshotId(scope));
  return {
    lists: (snapshot?.lists ?? []).filter((list) => kinds.includes(list.kind)),
    cachedAt: snapshot?.cachedAt ?? null
  };
}

async function updateCachedItem(
  scope: SupplyScope,
  itemId: string,
  values: EditableSupplyChanges,
  serverVersion?: number
): Promise<void> {
  const id = snapshotId(scope);
  const snapshot = await offlineDb.supplySnapshots.get(id);
  if (!snapshot) return;
  const lists = snapshot.lists.map((list) => ({
    ...list,
    supply_list_items: list.supply_list_items.map((item) => item.id === itemId
      ? { ...item, ...values, row_version: serverVersion ?? item.row_version }
      : item)
  }));
  await offlineDb.supplySnapshots.put({ ...snapshot, lists, cachedAt: new Date().toISOString() });
}

async function overlayRemainingMutations(scope: SupplyScope, itemId: string): Promise<void> {
  const remaining = await offlineDb.mutations
    .where("entityId")
    .equals(itemId)
    .filter((mutation) => mutation.userId === scope.userId && mutation.organizationId === scope.organizationId && mutation.campId === scope.campId)
    .sortBy("createdAt");
  for (const mutation of remaining) await updateCachedItem(scope, itemId, mutation.changes);
}

export async function queueSupplyItemChange(
  scope: SupplyScope,
  listId: string,
  item: SupplyItemRow,
  patch: SupplyItemPatch
): Promise<boolean> {
  const baseValues = editableValues(item);
  const changes = changedValues(baseValues, normalizedPatch(patch));
  if (Object.keys(changes).length === 0) return false;

  const mutation: PendingMutation = {
    id: crypto.randomUUID(),
    userId: scope.userId,
    organizationId: scope.organizationId,
    campId: scope.campId,
    listId,
    entityId: item.id,
    itemName: item.item_name,
    baseVersion: item.row_version,
    baseValues,
    changes,
    status: "pending",
    conflicts: [],
    serverVersion: null,
    serverValues: null,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null
  };
  await offlineDb.transaction("rw", offlineDb.mutations, offlineDb.supplySnapshots, async () => {
    await offlineDb.mutations.add(mutation);
    await updateCachedItem(scope, item.id, changes);
  });
  notifyOfflineStateChanged();
  return true;
}

export async function syncPendingMutations(scope: SupplyScope): Promise<void> {
  if (!supabase) return;
  const pending = await offlineDb.mutations
    .where("status")
    .equals("pending")
    .filter((mutation) => mutation.userId === scope.userId && mutation.organizationId === scope.organizationId && mutation.campId === scope.campId)
    .sortBy("createdAt");

  for (const mutation of pending) {
    await offlineDb.mutations.update(mutation.id, { attempts: mutation.attempts + 1, lastError: null });
    const { data, error } = await supabase.rpc("apply_supply_item_mutation", {
      p_organization_id: mutation.organizationId,
      p_camp_id: mutation.campId,
      p_item_id: mutation.entityId,
      p_client_mutation_id: mutation.id,
      p_base_version: mutation.baseVersion,
      p_base_values: mutation.baseValues as unknown as Json,
      p_changes: mutation.changes as unknown as Json
    });
    if (error) {
      await offlineDb.mutations.update(mutation.id, { lastError: error.message });
      notifyOfflineStateChanged();
      return;
    }

    const result = data as unknown as MutationServerResult;
    if (result.status === "conflict") {
      await offlineDb.mutations.update(mutation.id, {
        status: "conflict",
        conflicts: result.conflicts,
        serverVersion: result.server_version,
        serverValues: result.server_values,
        lastError: null
      });
      notifyOfflineStateChanged();
      continue;
    }

    await offlineDb.mutations.delete(mutation.id);
    await updateCachedItem(scope, mutation.entityId, result.server_values, result.server_version);
    await overlayRemainingMutations(scope, mutation.entityId);
    notifyOfflineStateChanged();
  }
}

export async function resolveConflictWithServer(scope: SupplyScope, mutation: PendingMutation): Promise<void> {
  if (!mutation.serverValues || !mutation.serverVersion) return;
  await offlineDb.mutations.delete(mutation.id);
  await updateCachedItem(scope, mutation.entityId, mutation.serverValues, mutation.serverVersion);
  await overlayRemainingMutations(scope, mutation.entityId);
  notifyOfflineStateChanged();
}

export async function resolveConflictWithLocal(scope: SupplyScope, mutation: PendingMutation): Promise<void> {
  if (!mutation.serverValues || !mutation.serverVersion) return;
  const replacement: PendingMutation = {
    ...mutation,
    id: crypto.randomUUID(),
    baseVersion: mutation.serverVersion,
    baseValues: mutation.serverValues,
    status: "pending",
    conflicts: [],
    serverVersion: null,
    serverValues: null,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null
  };
  await offlineDb.mutations.delete(mutation.id);
  await offlineDb.mutations.add(replacement);
  await updateCachedItem(scope, mutation.entityId, mutation.serverValues, mutation.serverVersion);
  await updateCachedItem(scope, mutation.entityId, mutation.changes);
  notifyOfflineStateChanged();
}

export async function readMutationState(scope: SupplyScope): Promise<{ pending: number; conflicts: PendingMutation[] }> {
  const mutations = await offlineDb.mutations
    .filter((mutation) => mutation.userId === scope.userId && mutation.organizationId === scope.organizationId && mutation.campId === scope.campId)
    .toArray();
  return {
    pending: mutations.filter((mutation) => mutation.status === "pending").length,
    conflicts: mutations.filter((mutation) => mutation.status === "conflict")
  };
}
