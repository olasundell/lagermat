import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuth } from "../auth/AuthContext";
import { fetchSupplyLists } from "../supplies/supplyApi";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { useIcaCatalogueSync } from "./useIcaCatalogueSync";

export function IcaCatalogueSyncAgent() {
  const { user } = useAuth();
  const { activeCamp, activeMembership } = useWorkspace();
  const scope = useMemo(
    () => user && activeMembership && activeCamp
      ? {
          userId: user.id,
          organizationId: activeMembership.organizationId,
          campId: activeCamp.id,
        }
      : null,
    [activeCamp, activeMembership, user],
  );
  const purchaseQuery = useQuery({
    queryKey: [
      "ica-sync-purchase-list",
      scope?.organizationId,
      scope?.campId,
    ],
    enabled: Boolean(scope),
    networkMode: "always",
    queryFn: () => fetchSupplyLists(scope!, ["purchase"]),
  });
  const purchaseList = purchaseQuery.data?.source === "server"
    ? purchaseQuery.data.lists.find((list) => list.kind === "purchase") ?? null
    : null;

  useIcaCatalogueSync(scope, purchaseList);
  return null;
}
