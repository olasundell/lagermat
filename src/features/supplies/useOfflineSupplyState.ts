import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { PendingMutation } from "../../lib/offlineDb";
import type { SupplyScope } from "./supplyApi";
import { readMutationState, syncPendingMutations } from "./offlineSync";

export interface OfflineSupplyState {
  online: boolean;
  pending: number;
  conflicts: PendingMutation[];
}

export function useOfflineSupplyState(scope: SupplyScope | null): OfflineSupplyState {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const mutationQuery = useQuery({
    queryKey: ["offline-supply-state", scope?.userId, scope?.organizationId, scope?.campId],
    enabled: Boolean(scope),
    networkMode: "always",
    queryFn: () => readMutationState(scope!),
    initialData: { pending: 0, conflicts: [] }
  });

  useEffect(() => {
    const handleConnectivityChange = () => {
      const isOnline = navigator.onLine;
      setOnline(isOnline);
      if (isOnline && scope) {
        void syncPendingMutations(scope).finally(() => mutationQuery.refetch());
      } else {
        void mutationQuery.refetch();
      }
    };
    const handleMutationChange = () => void mutationQuery.refetch();
    window.addEventListener("online", handleConnectivityChange);
    window.addEventListener("offline", handleConnectivityChange);
    window.addEventListener("lagermat:offline-state-changed", handleMutationChange);
    return () => {
      window.removeEventListener("online", handleConnectivityChange);
      window.removeEventListener("offline", handleConnectivityChange);
      window.removeEventListener("lagermat:offline-state-changed", handleMutationChange);
    };
  }, [mutationQuery, scope]);

  return { online, ...mutationQuery.data };
}
