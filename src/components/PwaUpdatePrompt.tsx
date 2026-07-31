import { RefreshCw, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "react-aria-components";
import { countPendingMutations } from "../lib/offlineDb";
import {
  dismissPwaUpdate,
  getPwaUpdateState,
  subscribeToPwaUpdate
} from "../lib/pwaUpdate";

export function PwaUpdatePrompt() {
  const update = useSyncExternalStore(subscribeToPwaUpdate, getPwaUpdateState, getPwaUpdateState);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!update.available) return;
    const refreshPending = () => void countPendingMutations().then(setPending);
    refreshPending();
    window.addEventListener("lagermat:offline-state-changed", refreshPending);
    return () => window.removeEventListener("lagermat:offline-state-changed", refreshPending);
  }, [update.available]);

  if (!update.available) return null;

  return (
    <aside className="pwa-update" aria-live="polite" aria-label="Ny version av Lägermat">
      <RefreshCw aria-hidden="true" size={22} />
      <div>
        <strong>En ny version finns</strong>
        <span>{pending > 0
          ? `Synkronisera ${pending} väntande ändring${pending === 1 ? "" : "ar"} innan appen uppdateras.`
          : "Uppdatera när det passar. Sidan laddas om en gång."}</span>
      </div>
      <Button
        className="primary-button"
        isDisabled={pending > 0 || !update.activate}
        onPress={() => void update.activate?.().catch(() => undefined)}
      >
        Uppdatera
      </Button>
      <Button className="icon-button" aria-label="Påminn mig senare" onPress={dismissPwaUpdate}>
        <X aria-hidden="true" size={21} />
      </Button>
    </aside>
  );
}
