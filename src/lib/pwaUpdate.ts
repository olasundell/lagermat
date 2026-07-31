export interface PwaUpdateState {
  available: boolean;
  applying: boolean;
  activate: (() => Promise<void>) | null;
}

const DEFERRED_UPDATE_KEY = "scoutmat:pwa-update-deferred";
let state: PwaUpdateState = {
  available: false,
  applying: false,
  activate: null,
};
const listeners = new Set<() => void>();

function updateStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function updateDeferred(): boolean {
  return updateStorage()?.getItem(DEFERRED_UPDATE_KEY) === "true";
}

function setUpdateDeferred(deferred: boolean): void {
  const storage = updateStorage();
  if (!storage) return;
  if (deferred) storage.setItem(DEFERRED_UPDATE_KEY, "true");
  else storage.removeItem(DEFERRED_UPDATE_KEY);
}

function emit() {
  for (const listener of listeners) listener();
}

export function announcePwaUpdate(activate: () => Promise<void>): void {
  if (updateDeferred()) {
    state = { available: false, applying: false, activate: null };
    emit();
    return;
  }

  async function activateUpdate(): Promise<void> {
    if (state.applying) return;
    setUpdateDeferred(true);
    state = { available: false, applying: true, activate: null };
    emit();
    try {
      await activate();
    } catch (error) {
      setUpdateDeferred(false);
      state = {
        available: true,
        applying: false,
        activate: activateUpdate,
      };
      emit();
      throw error;
    }
  }

  state = {
    available: true,
    applying: false,
    activate: activateUpdate,
  };
  emit();
}

export function dismissPwaUpdate(): void {
  setUpdateDeferred(true);
  state = { available: false, applying: false, activate: null };
  emit();
}

export function subscribeToPwaUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPwaUpdateState(): PwaUpdateState {
  return state;
}

export function resetPwaUpdateForTests(): void {
  setUpdateDeferred(false);
  state = { available: false, applying: false, activate: null };
  emit();
}
