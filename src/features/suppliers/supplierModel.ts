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

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readableDecimal(value: Decimal): string {
  return value.toString().replace(".", ",");
}

function readablePackageAmount(value: Decimal, unit: string): string {
  const normalized = normalizedUnit(unit);
  if (normalized === "kg" && value.abs().lessThan(1)) {
    return `${readableDecimal(value.times(1000))} g`;
  }
  if (normalized === "l" && value.abs().lessThan(1)) {
    return `${readableDecimal(value.times(1000))} ml`;
  }
  return `${readableDecimal(value)} ${unit.trim()}`;
}

function purchaseUnitLabel(value: string, units: Decimal): string {
  const purchaseUnit = value.trim();
  if (units.abs().equals(1)) return purchaseUnit;
  const plurals: Record<string, string> = {
    ask: "askar",
    burk: "burkar",
    flaska: "flaskor",
    förpackning: "förpackningar",
    kartong: "kartonger",
    påse: "påsar",
    rulle: "rullar",
    styck: "stycken",
    säck: "säckar",
    tub: "tuber",
  };
  return plurals[normalizedUnit(purchaseUnit)] ?? purchaseUnit;
}

export function describeSupplierPurchaseQuantity(
  product: Pick<SupplierProduct, "packaging_metadata" | "purchase_unit">,
  purchaseUnits: DecimalInput,
  amountPerPurchaseUnit: DecimalInput,
  requiredUnit: string,
): string {
  const units = finiteDecimal(purchaseUnits);
  const amount = finiteDecimal(amountPerPurchaseUnit);
  const purchaseUnit = product.purchase_unit.trim();
  if (!units || !amount || !purchaseUnit) return "";
  const displayedPurchaseUnit = purchaseUnitLabel(purchaseUnit, units);

  const metadata = metadataRecord(product.packaging_metadata);
  const innerCount = finiteDecimal(metadata?.inner_unit_count as DecimalInput);
  const innerLabel = typeof metadata?.inner_unit_label === "string"
    ? metadata.inner_unit_label.trim()
    : "";
  if (
    !innerCount
    || !innerCount.isInteger()
    || !innerCount.greaterThan(0)
    || !innerLabel
  ) {
    return `${readableDecimal(units)} ${displayedPurchaseUnit}`;
  }

  const totalInnerUnits = units.times(innerCount);
  const amountPerInnerUnit = amount.dividedBy(innerCount);
  return `${readableDecimal(totalInnerUnits)} ${innerLabel} (${
    readableDecimal(units)
  } ${displayedPurchaseUnit} à ${readableDecimal(innerCount)} × ${
    readablePackageAmount(amountPerInnerUnit, requiredUnit)
  })`;
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

interface SupplierOrderCalculationProduct {
  purchase_unit: string;
  minimum_order_units: number;
  packaging_metadata: SupplierProduct["packaging_metadata"];
}

function calculateSupplierOrder(
  requiredAmount: DecimalInput,
  requiredUnit: string,
  mappingUnitValue: string,
  amountPerPurchaseUnitValue: DecimalInput,
  product: SupplierOrderCalculationProduct,
): SupplierOrderProposal {
  const amount = finiteDecimal(requiredAmount);
  if (!amount || amount.isNegative()) {
    return invalidProposal("invalid_mapping", "invalid_required_amount");
  }

  const requirementUnit = normalizedUnit(requiredUnit);
  const mappingUnit = normalizedUnit(mappingUnitValue);
  if (!requirementUnit || !mappingUnit) {
    return invalidProposal("invalid_mapping", "invalid_required_unit");
  }
  if (requirementUnit !== mappingUnit) {
    return invalidProposal("unit_mismatch", "unit_mismatch");
  }

  const amountPerPurchaseUnit = finiteDecimal(amountPerPurchaseUnitValue);
  if (!amountPerPurchaseUnit || !amountPerPurchaseUnit.greaterThan(0)) {
    return invalidProposal("invalid_mapping", "invalid_amount_per_purchase_unit");
  }

  const minimumOrderUnits = finiteDecimal(product.minimum_order_units);
  if (
    !minimumOrderUnits
    || !minimumOrderUnits.greaterThan(0)
    || !minimumOrderUnits.isInteger()
    || minimumOrderUnits.greaterThan(Number.MAX_SAFE_INTEGER)
  ) {
    return invalidProposal("invalid_mapping", "invalid_minimum_order_units");
  }

  const purchaseUnit = product.purchase_unit.trim();
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
  const displayRequiredUnit = mappingUnitValue.trim();
  const basicPurchaseQuantity = `${
    calculatedPurchaseUnits.toString()
  } ${purchaseUnitLabel(purchaseUnit, calculatedPurchaseUnits)}`;
  const describedPurchaseQuantity = describeSupplierPurchaseQuantity(
    product,
    calculatedPurchaseUnits.toString(),
    amountPerPurchaseUnit.toString(),
    displayRequiredUnit,
  );
  const packageNote = [
    describedPurchaseQuantity === basicPurchaseQuantity
      ? `${basicPurchaseQuantity} à ${amountPerPurchaseUnit.toString()} ${displayRequiredUnit}`
      : describedPurchaseQuantity,
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

export interface SupplierOrderCandidateInput {
  amountPerPurchaseUnit: number;
  requiredUnit: string;
  product: Pick<
    SupplierProduct,
    "active" | "minimum_order_units" | "packaging_metadata" | "purchase_unit"
  >;
}

export function proposeSupplierCandidateOrder(
  requiredAmount: DecimalInput,
  requiredUnit: string,
  candidate: SupplierOrderCandidateInput,
): SupplierOrderProposal {
  if (!candidate.product.active) {
    return invalidProposal("invalid_mapping", "inactive_supplier_product");
  }
  return calculateSupplierOrder(
    requiredAmount,
    requiredUnit,
    candidate.requiredUnit,
    candidate.amountPerPurchaseUnit,
    candidate.product,
  );
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

  return calculateSupplierOrder(
    requiredAmount,
    requiredUnit,
    detail.match.required_unit,
    detail.match.amount_per_purchase_unit,
    detail.product,
  );
}
