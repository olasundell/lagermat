import { useQuery } from "@tanstack/react-query";
import { FileDown } from "lucide-react";
import { useState } from "react";
import { Button } from "react-aria-components";
import { fetchSupplyExportReadiness, type SupplyScope } from "../supplies/supplyApi";
import type { SupplyListRow } from "../supplies/supplyModel";
import {
  createSupplierOrderCsv,
  createSupplierOrderUnderlay,
} from "./supplierExportModel";
import type { SupplierAccount, SupplierMatchDetail } from "./supplierModel";

export function SupplierOrderExportActions({
  scope,
  list,
  accounts,
  details,
  organizationName,
  campName,
  disabled,
}: {
  scope: SupplyScope;
  list: SupplyListRow;
  accounts: SupplierAccount[];
  details: SupplierMatchDetail[];
  organizationName: string;
  campName: string;
  disabled: boolean;
}) {
  const activeAccounts = accounts.filter((account) => account.active);
  const [supplierAccountId, setSupplierAccountId] = useState(activeAccounts[0]?.id ?? "");
  const selectedSupplierAccountId = activeAccounts.some((account) => account.id === supplierAccountId)
    ? supplierAccountId
    : activeAccounts[0]?.id ?? "";
  const selectedSupplier = activeAccounts.find((account) => account.id === selectedSupplierAccountId) ?? null;
  const readinessQuery = useQuery({
    queryKey: ["supply-export-readiness", scope.organizationId, scope.campId],
    enabled: !disabled && Boolean(selectedSupplier),
    queryFn: () => fetchSupplyExportReadiness(scope),
    staleTime: 0,
    retry: false,
  });
  const exportDisabled = disabled || !selectedSupplier || readinessQuery.isLoading || !readinessQuery.data;

  function download() {
    if (!selectedSupplier || !readinessQuery.data) return;
    const underlay = createSupplierOrderUnderlay({
      organizationName,
      campName,
      supplier: selectedSupplier,
      items: list.supply_list_items,
      details,
      readiness: readinessQuery.data,
    });
    const url = URL.createObjectURL(new Blob([createSupplierOrderCsv(underlay)], {
      type: "text/csv;charset=utf-8",
    }));
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${underlay.fileStem}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!activeAccounts.length) return null;

  return (
    <div className="supplier-export-actions" aria-label="Leverantörsanpassat underlag">
      <label>Leverantör
        <select value={selectedSupplierAccountId} onChange={(event) => setSupplierAccountId(event.target.value)} disabled={disabled}>
          {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.display_name}</option>)}
        </select>
      </label>
      <Button className="secondary-button" onPress={download} isDisabled={exportDisabled}>
        <FileDown aria-hidden="true" size={17} /> Ladda ned leverantörsunderlag
      </Button>
      <span>CSV med artikelnummer, kolliförslag och omatchade rader. Ingen order skickas.</span>
      {readinessQuery.error ? <small role="alert">Det gick inte att kontrollera underlaget.</small> : null}
    </div>
  );
}
