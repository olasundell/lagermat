export function selectedOrganizationKey(userId: string): string {
  return `lagermat:selected-organization:${userId}`;
}

export function selectedCampKey(userId: string, organizationId: string): string {
  return `lagermat:selected-camp:${userId}:${organizationId}`;
}

export function clearWorkspaceSelectionsForUser(
  userId: string,
  storage: Pick<Storage, "key" | "length" | "removeItem"> = window.localStorage
): void {
  const organizationKey = selectedOrganizationKey(userId);
  const campPrefix = `lagermat:selected-camp:${userId}:`;
  const matchingKeys: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === organizationKey || key?.startsWith(campPrefix)) {
      matchingKeys.push(key);
    }
  }

  for (const key of matchingKeys) storage.removeItem(key);
}
