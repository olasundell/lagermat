import { AlertTriangle, CloudOff, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "react-aria-components";
import type { PendingMutation } from "../../lib/offlineDb";
import { resolveConflictWithLocal, resolveConflictWithServer, syncPendingMutations } from "./offlineSync";
import type { SupplyScope } from "./supplyApi";
import type { OfflineSupplyState } from "./useOfflineSupplyState";

const fieldLabels: Record<string, string> = {
  ordered_amount: "beställt antal",
  ordered_unit: "beställd enhet",
  package_note: "förpackning",
  comment: "kommentar",
  completed: "avbockning"
};

export function SupplySyncStatus({
  scope,
  state,
  cached,
  cachedAt,
  onRefresh
}: {
  scope: SupplyScope;
  state: OfflineSupplyState;
  cached: boolean;
  cachedAt: string | null;
  onRefresh: () => Promise<void>;
}) {
  const [syncing, setSyncing] = useState(false);

  async function sync() {
    setSyncing(true);
    try {
      await syncPendingMutations(scope);
      await onRefresh();
    } finally {
      setSyncing(false);
    }
  }

  async function resolve(mutation: PendingMutation, choice: "server" | "local") {
    if (choice === "server") await resolveConflictWithServer(scope, mutation);
    else {
      await resolveConflictWithLocal(scope, mutation);
      await syncPendingMutations(scope);
    }
    await onRefresh();
  }

  if (!cached && state.online && state.pending === 0 && state.conflicts.length === 0) return null;

  return (
    <aside className="sync-status" aria-label="Offlinestatus">
      <div className="sync-status__summary">
        <CloudOff aria-hidden="true" size={22} />
        <span>
          <strong>{cached || !state.online ? "Offline – visar senast sparade uppgifter" : "Ändringar väntar på att sparas"}</strong>
          {cachedAt ? ` · sparad ${new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(new Date(cachedAt))}` : ""}
          {state.pending ? ` · ${state.pending} ${state.pending === 1 ? "ändring väntar" : "ändringar väntar"}` : ""}
        </span>
        {state.online && state.pending > 0 ? <Button className="secondary-button" onPress={sync} isDisabled={syncing}><RefreshCw className={syncing ? "spin" : ""} aria-hidden="true" size={16} /> Försök spara igen</Button> : null}
      </div>
      {state.conflicts.map((mutation) => (
        <article className="sync-conflict" key={mutation.id}>
          <AlertTriangle aria-hidden="true" size={20} />
          {mutation.policyReason ? (
            <>
              <div>
                <strong>Ändringen av {mutation.itemName} kan inte sparas</strong>
                <p>{mutation.policyReason === "finalised_delivery"
                  ? "Leveransen är slutmarkerad och kan inte ändras. Ta bort den osparade ändringen."
                  : "Varan är kvitterad. Ta bort den osparade ändringen, markera sedan varan som kvar innan du ändrar den."}</p>
              </div>
              <div className="sync-conflict__actions">
                <Button className="secondary-button" onPress={() => resolve(mutation, "server")}>Ta bort osparad ändring</Button>
              </div>
            </>
          ) : (
            <>
              <div><strong>Två versioner av {mutation.itemName}</strong><p>Följande uppgifter ändrades både här och i den senast sparade versionen: {mutation.conflicts.map((conflict) => fieldLabels[conflict.field] ?? conflict.field).join(", ")}. Välj vilken version du vill behålla.</p></div>
              <div className="sync-conflict__actions">
                <Button className="secondary-button" onPress={() => resolve(mutation, "server")}>Behåll senast sparade</Button>
                <Button className="primary-button" onPress={() => resolve(mutation, "local")}>Spara min version</Button>
              </div>
            </>
          )}
        </article>
      ))}
    </aside>
  );
}
