import { createPrintableSupplyHtml, createSupplyCsv, type SupplyExportDocument } from "./exportModel";

export function downloadSupplyCsv(document: SupplyExportDocument): void {
  const url = URL.createObjectURL(new Blob([createSupplyCsv(document)], { type: "text/csv;charset=utf-8" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `${document.fileStem}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function openPrintableSupplyExport(document: SupplyExportDocument): Window | null {
  const popup = window.open("", "_blank", "popup,width=1100,height=820");
  if (!popup) return null;
  popup.document.open();
  popup.document.write(createPrintableSupplyHtml(document));
  popup.document.close();
  return popup;
}
