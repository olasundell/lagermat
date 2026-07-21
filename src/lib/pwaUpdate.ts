export interface PwaUpdateState {
  available: boolean;
  activate: (() => Promise<void>) | null;
}

let state: PwaUpdateState = { available: false, activate: null };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function announcePwaUpdate(activate: () => Promise<void>): void {
  state = { available: true, activate };
  emit();
}

export function dismissPwaUpdate(): void {
  state = { available: false, activate: null };
  emit();
}

export function subscribeToPwaUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPwaUpdateState(): PwaUpdateState {
  return state;
}
