import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { SupplyListRow } from "../supplies/supplyModel";
import type { SupplyScope } from "../supplies/supplyApi";
import { ensureSupplierCatalogueMatches } from "./supplierCatalogueApi";
import { ensureIcaSicklaSupplierAccount } from "./supplierApi";

function purchaseItems(list: SupplyListRow | null) {
  return (list?.supply_list_items ?? []).filter((item) => item.source_present);
}

export function useIcaCatalogueSync(
  scope: SupplyScope | null,
  purchaseList: SupplyListRow | null,
) {
  const queryClient = useQueryClient();
  const items = useMemo(() => purchaseItems(purchaseList), [purchaseList]);
  const queryKey = useMemo(() => [
      "ica-catalogue-sync",
      scope?.organizationId,
      scope?.campId,
      purchaseList?.id,
      purchaseList?.version,
    ] as const, [
      purchaseList?.id,
      purchaseList?.version,
      scope?.campId,
      scope?.organizationId,
    ]);

  const sync = useQuery({
    queryKey,
    enabled: Boolean(scope && purchaseList && items.length > 0),
    queryFn: async () => {
      const supplierAccountId = await ensureIcaSicklaSupplierAccount(scope!);
      const outcome = await ensureSupplierCatalogueMatches(
        scope!,
        supplierAccountId,
        items,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["camp-overview", scope!.organizationId, scope!.campId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["supplier-foundation", scope!.organizationId],
        }),
      ]);
      return outcome;
    },
    refetchInterval: (query) => {
      const retryAfterMs = query.state.data?.retryAfterMs;
      return typeof retryAfterMs === "number" ? retryAfterMs : false;
    },
    refetchIntervalInBackground: true,
  });

  const retryNow = useCallback(async () => {
    if (!scope || !purchaseList || items.length === 0) return;
    const supplierAccountId = await ensureIcaSicklaSupplierAccount(scope);
    const outcome = await ensureSupplierCatalogueMatches(
      scope,
      supplierAccountId,
      items,
      { forceIcaSync: true },
    );
    queryClient.setQueryData(queryKey, outcome);
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["camp-overview", scope.organizationId, scope.campId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["supplier-foundation", scope.organizationId],
      }),
    ]);
  }, [
    items,
    purchaseList,
    queryClient,
    queryKey,
    scope,
  ]);

  return { ...sync, retryNow };
}
