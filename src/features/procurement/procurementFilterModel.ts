import type { SupplierCatalogueCandidateView } from "../suppliers/SupplierCataloguePanel";
import { isIcaSicklaAccount } from "../suppliers/icaStore";
import type { SupplierAccount, SupplierMatchDetail } from "../suppliers/supplierModel";
import type { SupplyItemRow } from "../supplies/supplyModel";

export type ProcurementOrderFilter = "all" | "not_ordered" | "ordered";
export type ProcurementIcaFilter = "all" | "ready" | "review" | "missing";

export function icaStatusForPurchaseItem(
  item: SupplyItemRow,
  supplierDetails: SupplierMatchDetail[],
  supplierCandidates: SupplierCatalogueCandidateView[],
  accounts: SupplierAccount[],
): Exclude<ProcurementIcaFilter, "all"> {
  if (supplierDetails.some((detail) =>
    detail.match.canonical_key === item.canonical_key && isIcaSicklaAccount(detail.account)
  )) return "ready";
  if (supplierCandidates.some((candidate) =>
    candidate.canonicalKey === item.canonical_key
      && candidate.status === "pending"
      && isIcaSicklaAccount(accounts.find((account) => account.id === candidate.supplierAccountId))
  )) return "review";
  return "missing";
}

export function filterProcurementItems({
  items,
  query,
  category,
  orderFilter,
  icaFilter,
  supplierDetails,
  supplierCandidates,
  accounts,
}: {
  items: SupplyItemRow[];
  query: string;
  category: string;
  orderFilter: ProcurementOrderFilter;
  icaFilter: ProcurementIcaFilter;
  supplierDetails: SupplierMatchDetail[];
  supplierCandidates: SupplierCatalogueCandidateView[];
  accounts: SupplierAccount[];
}): Set<string> {
  const needle = query.trim().toLocaleLowerCase("sv-SE");
  return new Set(items.filter((item) => {
    const icaProductNames = [
      ...supplierDetails
        .filter((detail) => detail.match.canonical_key === item.canonical_key && isIcaSicklaAccount(detail.account))
        .map((detail) => detail.product.display_name),
      ...supplierCandidates
        .filter((candidate) => candidate.canonicalKey === item.canonical_key
          && isIcaSicklaAccount(accounts.find((account) => account.id === candidate.supplierAccountId)))
        .map((candidate) => candidate.product.display_name),
    ];
    const text = [item.item_name, item.category, item.comment ?? "", ...icaProductNames]
      .join(" ")
      .toLocaleLowerCase("sv-SE");
    const matchesOrder = orderFilter === "all"
      || (orderFilter === "ordered" ? item.ordered_amount !== null : item.ordered_amount === null);
    return (!needle || text.includes(needle))
      && (category === "all" || item.category === category)
      && matchesOrder
      && (icaFilter === "all" || icaStatusForPurchaseItem(item, supplierDetails, supplierCandidates, accounts) === icaFilter);
  }).map((item) => item.id));
}
