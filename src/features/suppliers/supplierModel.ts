import Decimal from "decimal.js";
import type { Tables } from "../../types/database";

export type SupplierAccount = Tables<"supplier_accounts">;
export type SupplierProduct = Tables<"supplier_products">;
export type SupplierOffer = Tables<"supplier_offers">;
export type IngredientSupplierMatch = Tables<"ingredient_supplier_matches">;
export type SupplierImportColumnProfile = Tables<"supplier_import_column_profiles">;
export type SupplierMatchCandidate = Tables<"supplier_match_candidates">;
export type PreferredSupplierMatch = Tables<"preferred_supplier_matches">;

export interface SupplierMatchDetail {
  account: SupplierAccount;
  product: SupplierProduct;
  offer: SupplierOffer | null;
  match: IngredientSupplierMatch;
}

export type SupplierOrderProposalStatus = "ready" | "unit_mismatch" | "invalid_mapping";

export type SupplierOrderProposalReason =
  | "invalid_required_amount"
  | "invalid_required_unit"
  | "invalid_amount_per_purchase_unit"
  | "invalid_minimum_order_units"
  | "invalid_purchase_unit"
  | "inactive_supplier_account"
  | "inactive_supplier_product"
  | "supplier_product_out_of_stock"
  | "supplier_product_discontinued"
  | "unit_mismatch"
  | "result_out_of_range";

export interface ReadySupplierOrderProposal {
  status: "ready";
  reason: null;
  purchaseUnits: number;
  orderedAmount: number;
  surplusAmount: number;
  packageNote: string;
}

export interface InvalidSupplierOrderProposal {
  status: Exclude<SupplierOrderProposalStatus, "ready">;
  reason: SupplierOrderProposalReason;
  purchaseUnits: null;
  orderedAmount: null;
  surplusAmount: null;
  packageNote: null;
}

export type SupplierOrderProposal =
  | ReadySupplierOrderProposal
  | InvalidSupplierOrderProposal;

type DecimalInput = number | string;

function normalizedUnit(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("sv-SE");
}

function finiteDecimal(value: DecimalInput): Decimal | null {
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

function invalidProposal(
  status: InvalidSupplierOrderProposal["status"],
  reason: SupplierOrderProposalReason,
): InvalidSupplierOrderProposal {
  return {
    status,
    reason,
    purchaseUnits: null,
    orderedAmount: null,
    surplusAmount: null,
    packageNote: null,
  };
}

export function proposeSupplierOrder(
  requiredAmount: DecimalInput,
  requiredUnit: string,
  detail: SupplierMatchDetail,
): SupplierOrderProposal {
  if (!detail.account.active) {
    return invalidProposal("invalid_mapping", "inactive_supplier_account");
  }
  if (!detail.product.active) {
    return invalidProposal("invalid_mapping", "inactive_supplier_product");
  }
  const availabilityStatus = detail.offer?.availability_status.trim().toLocaleLowerCase("sv-SE");
  if (availabilityStatus === "out_of_stock") {
    return invalidProposal("invalid_mapping", "supplier_product_out_of_stock");
  }
  if (availabilityStatus === "discontinued") {
    return invalidProposal("invalid_mapping", "supplier_product_discontinued");
  }

  const amount = finiteDecimal(requiredAmount);
  if (!amount || amount.isNegative()) {
    return invalidProposal("invalid_mapping", "invalid_required_amount");
  }

  const requirementUnit = normalizedUnit(requiredUnit);
  const mappingUnit = normalizedUnit(detail.match.required_unit);
  if (!requirementUnit || !mappingUnit) {
    return invalidProposal("invalid_mapping", "invalid_required_unit");
  }
  if (requirementUnit !== mappingUnit) {
    return invalidProposal("unit_mismatch", "unit_mismatch");
  }

  const amountPerPurchaseUnit = finiteDecimal(detail.match.amount_per_purchase_unit);
  if (!amountPerPurchaseUnit || !amountPerPurchaseUnit.greaterThan(0)) {
    return invalidProposal("invalid_mapping", "invalid_amount_per_purchase_unit");
  }

  const minimumOrderUnits = finiteDecimal(detail.product.minimum_order_units);
  if (
    !minimumOrderUnits
    || !minimumOrderUnits.greaterThan(0)
    || !minimumOrderUnits.isInteger()
    || minimumOrderUnits.greaterThan(Number.MAX_SAFE_INTEGER)
  ) {
    return invalidProposal("invalid_mapping", "invalid_minimum_order_units");
  }

  const purchaseUnit = detail.product.purchase_unit.trim();
  if (!purchaseUnit) {
    return invalidProposal("invalid_mapping", "invalid_purchase_unit");
  }

  const calculatedPurchaseUnits = amount.isZero()
    ? new Decimal(0)
    : Decimal.max(amount.dividedBy(amountPerPurchaseUnit).ceil(), minimumOrderUnits);
  const orderedAmount = calculatedPurchaseUnits.times(amountPerPurchaseUnit);
  const surplusAmount = orderedAmount.minus(amount);

  if (
    calculatedPurchaseUnits.greaterThan(Number.MAX_SAFE_INTEGER)
    || !orderedAmount.isFinite()
    || !surplusAmount.isFinite()
  ) {
    return invalidProposal("invalid_mapping", "result_out_of_range");
  }

  const purchaseUnits = calculatedPurchaseUnits.toNumber();
  const orderedAmountNumber = orderedAmount.toNumber();
  const surplusAmountNumber = surplusAmount.toNumber();
  const displayRequiredUnit = detail.match.required_unit.trim();
  const packageNote = [
    `${calculatedPurchaseUnits.toString()} ${purchaseUnit}`,
    `à ${amountPerPurchaseUnit.toString()} ${displayRequiredUnit}`,
    `= ${orderedAmount.toString()} ${displayRequiredUnit}`,
    `(behov ${amount.toString()} ${displayRequiredUnit}, överskott ${surplusAmount.toString()} ${displayRequiredUnit})`,
  ].join(" ");

  return {
    status: "ready",
    reason: null,
    purchaseUnits,
    orderedAmount: orderedAmountNumber,
    surplusAmount: surplusAmountNumber,
    packageNote,
  };
}
