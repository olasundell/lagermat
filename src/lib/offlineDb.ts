import Dexie, { type EntityTable } from "dexie";
import type { SupplyListRow } from "../features/supplies/supplyModel";

export interface EditableSupplyValues {
  ordered_amount: number | null;
  ordered_unit: string | null;
  package_note: string | null;
  comment: string | null;
  completed: boolean;
}

export type EditableSupplyChanges = Partial<EditableSupplyValues>;

export interface SupplyConflictField {
  field: keyof EditableSupplyValues;
  base: unknown;
  server: unknown;
  client: unknown;
}

export interface CachedSupplySnapshot {
  id: string;
  userId: string;
  organizationId: string;
  campId: string;
  lists: SupplyListRow[];
  cachedAt: string;
}

export interface PendingMutation {
  id: string;
  userId: string;
  organizationId: string;
  campId: string;
  listId: string;
  entityId: string;
  itemName: string;
  baseVersion: number;
  baseValues: EditableSupplyValues;
  changes: EditableSupplyChanges;
  status: "pending" | "conflict";
  conflicts: SupplyConflictField[];
  serverVersion: number | null;
  serverValues: EditableSupplyValues | null;
  createdAt: string;
  attempts: number;
  lastError: string | null;
}

export interface CachedWorkspaceMembership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: "admin" | "planner";
}

export interface CachedWorkspaceCamp {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  timezone: string;
}

export interface CachedWorkspaceSnapshot {
  id: string;
  userId: string;
  memberships: CachedWorkspaceMembership[];
  campsByOrganization: Record<string, CachedWorkspaceCamp[]>;
  cachedAt: string;
}

class LagermatOfflineDatabase extends Dexie {
  supplySnapshots!: EntityTable<CachedSupplySnapshot, "id">;
  mutations!: EntityTable<PendingMutation, "id">;
  workspaceSnapshots!: EntityTable<CachedWorkspaceSnapshot, "id">;

  constructor() {
    super("lagermat-local-v1");
    this.version(1).stores({
      deliveryItems: "id, deliveryId, updatedAt",
      mutations: "id, entityId, createdAt"
    });
    this.version(2).stores({
      deliveryItems: null,
      supplySnapshots: "id, [userId+organizationId+campId], cachedAt",
      mutations: "id, [userId+organizationId+campId], entityId, status, createdAt",
      workspaceSnapshots: "id, userId, cachedAt"
    });
  }
}

export const offlineDb = new LagermatOfflineDatabase();

export function notifyOfflineStateChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("lagermat:offline-state-changed"));
  }
}

export async function countPendingMutations(userId?: string): Promise<number> {
  if (!userId) return offlineDb.mutations.count();
  return offlineDb.mutations.filter((mutation) => mutation.userId === userId).count();
}

export async function clearOfflineDataForUser(userId: string): Promise<void> {
  await offlineDb.transaction(
    "rw",
    offlineDb.mutations,
    offlineDb.supplySnapshots,
    offlineDb.workspaceSnapshots,
    async () => {
      await offlineDb.mutations.filter((mutation) => mutation.userId === userId).delete();
      await offlineDb.supplySnapshots.filter((snapshot) => snapshot.userId === userId).delete();
      await offlineDb.workspaceSnapshots.where("userId").equals(userId).delete();
    }
  );
  notifyOfflineStateChanged();
}
