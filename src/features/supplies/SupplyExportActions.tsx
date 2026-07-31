import { useQuery } from "@tanstack/react-query";
import { FileDown, Printer } from "lucide-react";
import { Button } from "react-aria-components";
import {
  createSupplyExportDocument
} from "./exportModel";
import { downloadSupplyCsv, openPrintableSupplyExport } from "./browserExport";
import { fetchSupplyExportReadiness, type SupplyScope } from "./supplyApi";
import type { PracticalSupplyAmount, SupplyListRow } from "./supplyModel";

export function SupplyExportActions({
  scope,
  list,
  organizationName,
  campName,
  timeZone,
  disabled,
  practicalAmounts,
}: {
  scope: SupplyScope;
  list: SupplyListRow;
  organizationName: string;
  campName: string;
  timeZone: string;
  disabled: boolean;
  practicalAmounts?: ReadonlyMap<string, PracticalSupplyAmount>;
}) {
  const readinessQuery = useQuery({
    queryKey: ["supply-export-readiness", scope.organizationId, scope.campId],
    enabled: !disabled,
    queryFn: () => fetchSupplyExportReadiness(scope),
    staleTime: 0,
    retry: false
  });
  const isDisabled = disabled || readinessQuery.isLoading || !readinessQuery.data;

  function buildDocument() {
    if (!readinessQuery.data) return null;
    return createSupplyExportDocument({
      list,
      organizationName,
      campName,
      timeZone,
      readiness: readinessQuery.data,
      practicalAmounts,
    });
  }

  function downloadCsv() {
    const document = buildDocument();
    if (document) downloadSupplyCsv(document);
  }

  function openPdf() {
    const document = buildDocument();
    if (document) openPrintableSupplyExport(document);
  }

  return (
    <div className="supply-export-actions" aria-label={`Exportera ${list.title}`}>
      <Button className="secondary-button" onPress={downloadCsv} isDisabled={isDisabled}>
        <FileDown aria-hidden="true" size={17} /> Ladda ned CSV
      </Button>
      <Button className="secondary-button" onPress={openPdf} isDisabled={isDisabled}>
        <Printer aria-hidden="true" size={17} /> Förhandsgranska och skriv ut
      </Button>
      {readinessQuery.error ? <span role="alert">Det gick inte att kontrollera underlaget.</span> : null}
      {disabled ? <span>Spara väntande ändringar innan du exporterar.</span> : null}
    </div>
  );
}
