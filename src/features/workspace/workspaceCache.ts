import { offlineDb, type CachedWorkspaceCamp, type CachedWorkspaceMembership } from "../../lib/offlineDb";

export async function cacheMemberships(userId: string, memberships: CachedWorkspaceMembership[]): Promise<void> {
  const existing = await offlineDb.workspaceSnapshots.get(userId);
  await offlineDb.workspaceSnapshots.put({
    id: userId,
    userId,
    memberships,
    campsByOrganization: existing?.campsByOrganization ?? {},
    cachedAt: new Date().toISOString()
  });
}

export async function readCachedMemberships(userId: string): Promise<CachedWorkspaceMembership[]> {
  return (await offlineDb.workspaceSnapshots.get(userId))?.memberships ?? [];
}

export async function cacheCamps(userId: string, organizationId: string, camps: CachedWorkspaceCamp[]): Promise<void> {
  const existing = await offlineDb.workspaceSnapshots.get(userId);
  await offlineDb.workspaceSnapshots.put({
    id: userId,
    userId,
    memberships: existing?.memberships ?? [],
    campsByOrganization: { ...(existing?.campsByOrganization ?? {}), [organizationId]: camps },
    cachedAt: new Date().toISOString()
  });
}

export async function readCachedCamps(userId: string, organizationId: string): Promise<CachedWorkspaceCamp[]> {
  return (await offlineDb.workspaceSnapshots.get(userId))?.campsByOrganization[organizationId] ?? [];
}
