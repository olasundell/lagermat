export interface AnonymousSessionIdentity {
  userId: string;
}

export interface DemoRecoveryDependencies<TInstance> {
  clearOfflineDataForUser: (userId: string) => Promise<void>;
  clearWorkspaceSelectionsForUser: (userId: string) => void;
  signOutLocal: () => Promise<void>;
  signInAnonymously: () => Promise<AnonymousSessionIdentity>;
  provisionCurrentSession: () => Promise<TInstance>;
  abandonNewSession: () => Promise<void>;
}

export interface RecoveredDemoSession<TInstance> {
  userId: string;
  instance: TInstance;
}

export async function recoverExpiredDemoSession<TInstance>(
  expiredUserId: string,
  dependencies: DemoRecoveryDependencies<TInstance>
): Promise<RecoveredDemoSession<TInstance>> {
  if (!expiredUserId.trim()) {
    throw new Error("Den utgångna demoanvändaren saknar id.");
  }

  await dependencies.clearOfflineDataForUser(expiredUserId);
  dependencies.clearWorkspaceSelectionsForUser(expiredUserId);
  await dependencies.signOutLocal();

  const identity = await dependencies.signInAnonymously();
  if (!identity.userId || identity.userId === expiredUserId) {
    await dependencies.abandonNewSession();
    throw new Error("Ett nytt demoläger kunde inte öppnas med en anonym användare.");
  }

  try {
    const instance = await dependencies.provisionCurrentSession();
    return { userId: identity.userId, instance };
  } catch (error) {
    try {
      await dependencies.abandonNewSession();
    } catch {
      // The original provisioning failure is the actionable error. Server-side
      // orphan cleanup remains the final safety net if local sign-out also fails.
    }
    throw error;
  }
}
