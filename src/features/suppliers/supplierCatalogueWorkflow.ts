import type { SupplyItemRow } from "../supplies/supplyModel";
import {
  CATALOGUE_MATCHER_VERSION,
  CATALOGUE_NORMALIZATION_VERSION,
  matchSupplierCatalogue,
  type CatalogueMatchCandidate,
} from "./catalogueMatcher";
import type {
  SupplierCataloguePreview,
  SupplierCataloguePreviewRow,
} from "./catalogueImportModel";
import type {
  IngredientSupplierMatch,
  SupplierAccount,
  SupplierOffer,
  SupplierProduct,
} from "./supplierModel";

export type SupplierCatalogueEnrichmentSource = "dabas" | "fixture" | "none";

export interface SupplierCatalogueEnrichment {
  gtin: string;
  displayName: string | null;
  brand: string | null;
  packageDescription: string | null;
  manufacturerArticleNumber: string | null;
}

export interface StagedSupplierCatalogueRow {
  source_row: number;
  raw_data: Record<string, unknown>;
  normalized_data: Record<string, unknown>;
}

export interface SupplierMatchCandidatePayload {
  canonical_key: string;
  supplier_product_id: string;
  status: "safe" | "review";
  score: number;
  signals: Record<string, unknown>;
  product_fingerprint: string;
  required_unit: string;
  amount_per_purchase_unit: number;
  import_run_id: string | null;
}

interface BuildSupplierCandidatesInput {
  organizationId: string;
  supplierAccountId: string;
  items: SupplyItemRow[];
  accounts: SupplierAccount[];
  products: SupplierProduct[];
  offers: SupplierOffer[];
  approvedMatches: IngredientSupplierMatch[];
  rejectedFingerprintsByCanonicalKey: ReadonlyMap<string, readonly string[]>;
  asOfDate: string;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")
  }}`;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sourceIdentity(row: SupplierCataloguePreviewRow): Record<string, unknown> {
  return {
    source_row: row.sourceRow,
    supplier_article_number: row.supplierArticleNumber,
    display_name: row.displayName,
    purchase_unit: row.purchaseUnit,
    package_amount: row.totalAmount,
    package_unit: row.totalUnit,
    gtin: row.gtin,
    price: row.price,
    minimum_order_units: row.minimumOrderUnits,
    inner_unit_count: row.innerUnitCount,
    inner_unit_label: row.innerUnitLabel,
    valid_from: row.validFrom,
    valid_to: row.validTo,
    category: row.category,
    brand: row.brand,
    catch_weight: row.catchWeight,
  };
}

export async function supplierCatalogueSourceFingerprint(
  preview: SupplierCataloguePreview,
): Promise<string> {
  const importableRows = preview.rows
    .filter((row) => row.status !== "blocked")
    .map(sourceIdentity)
    .sort((left, right) => Number(left.source_row) - Number(right.source_row));
  return sha256Hex(stableJson({
    version: "supplier-catalogue-file-v1",
    header_signature: preview.headerSignature,
    rows: importableRows,
  }));
}

export async function supplierCatalogueApiSourceFingerprint(
  adapter: string,
  storeId: string,
  rows: readonly StagedSupplierCatalogueRow[],
): Promise<string> {
  const products = rows
    .map((row) => row.normalized_data)
    .sort((left, right) =>
      String(left.supplier_article_number ?? "").localeCompare(
        String(right.supplier_article_number ?? ""),
        "sv-SE",
        { numeric: true },
      )
    );
  return sha256Hex(stableJson({
    version: "supplier-catalogue-api-v1",
    adapter,
    store_id: storeId,
    products,
  }));
}

function compactRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== null && value !== undefined),
  );
}

export function buildStagedSupplierCatalogueRows(
  preview: SupplierCataloguePreview,
  enrichment: readonly SupplierCatalogueEnrichment[] = [],
): StagedSupplierCatalogueRow[] {
  const enrichmentByGtin = new Map(enrichment.map((product) => [product.gtin, product]));

  return preview.rows
    .filter((row) => row.status !== "blocked" && row.totalAmount !== null)
    .map((row) => {
      const enriched = row.gtin ? enrichmentByGtin.get(row.gtin) : undefined;
      const normalizedData = compactRecord({
        supplier_article_number: row.supplierArticleNumber,
        display_name: row.displayName,
        purchase_unit: row.purchaseUnit,
        package_amount: row.totalAmount,
        package_unit: row.totalUnit,
        gtin: row.gtin,
        price: row.price,
        currency: "SEK",
        availability_status: "unknown",
        minimum_order_units: row.minimumOrderUnits ?? 1,
        valid_from: row.validFrom,
        valid_to: row.validTo,
        category: row.category,
        brand: row.brand ?? enriched?.brand ?? null,
        catch_weight: row.catchWeight ?? false,
        packaging_metadata: compactRecord({
          normalization_version: "supplier-import-v1",
          source_total_amount: row.totalAmount,
          source_total_unit: row.totalUnit,
          inner_unit_count: row.innerUnitCount,
          inner_unit_label: row.innerUnitLabel,
          dabas_package_description: enriched?.packageDescription,
        }),
        metadata: compactRecord({
          importer_row_fingerprint: row.rowFingerprint,
          source_status: row.status,
          dabas_display_name: enriched?.displayName,
          dabas_manufacturer_article_number: enriched?.manufacturerArticleNumber,
        }),
      });

      return {
        source_row: row.sourceRow,
        raw_data: {
          ...sourceIdentity(row),
          importer_row_fingerprint: row.rowFingerprint,
          issues: row.issues.map((issue) => ({
            severity: issue.severity,
            code: issue.code,
            message: issue.message,
          })),
        },
        normalized_data: normalizedData,
      };
    });
}

function currentProductFingerprint(product: SupplierProduct): string | null {
  const fingerprint = (
    product as SupplierProduct & { product_fingerprint?: unknown }
  ).product_fingerprint;
  return typeof fingerprint === "string" && /^[0-9a-f]{64}$/.test(fingerprint)
    ? fingerprint
    : null;
}

function latestImportRunId(product: SupplierProduct): string | null {
  const importRunId = (
    product as SupplierProduct & { latest_import_run_id?: unknown }
  ).latest_import_run_id;
  return typeof importRunId === "string" ? importRunId : null;
}

function isEligibleReviewCandidate(
  candidate: CatalogueMatchCandidate,
): boolean {
  return candidate.amount_per_purchase_unit !== null
    && candidate.amount_per_purchase_unit > 0
    && !candidate.explanations.some((explanation) => explanation.kind === "blocker");
}

function candidatePayload(
  item: SupplyItemRow,
  candidate: CatalogueMatchCandidate,
  status: SupplierMatchCandidatePayload["status"],
  marginToNext: number | null,
  resolutionReason: string,
  manuallySelected = false,
): SupplierMatchCandidatePayload | null {
  const productFingerprint = currentProductFingerprint(candidate.product);
  if (
    !productFingerprint
    || candidate.amount_per_purchase_unit === null
    || candidate.amount_per_purchase_unit <= 0
  ) {
    return null;
  }

  return {
    canonical_key: item.canonical_key,
    supplier_product_id: candidate.product.id,
    status,
    score: candidate.score.total,
    signals: {
      matcher_version: CATALOGUE_MATCHER_VERSION,
      normalization_version: CATALOGUE_NORMALIZATION_VERSION,
      resolution_reason: resolutionReason,
      margin_to_next: marginToNext,
      manually_selected: manuallySelected,
      score: candidate.score,
      explanations: candidate.explanations.map((explanation) => ({
        kind: explanation.kind,
        code: explanation.code,
        points: explanation.points,
        message: explanation.message,
      })),
    },
    product_fingerprint: productFingerprint,
    required_unit: item.required_unit,
    amount_per_purchase_unit: candidate.amount_per_purchase_unit,
    import_run_id: latestImportRunId(candidate.product),
  };
}

export function buildSupplierMatchCandidatePayloads({
  organizationId,
  supplierAccountId,
  items,
  accounts,
  products,
  offers,
  approvedMatches,
  rejectedFingerprintsByCanonicalKey,
  asOfDate,
}: BuildSupplierCandidatesInput): SupplierMatchCandidatePayload[] {
  return items
    .filter((item) => item.source_present)
    .flatMap((item) => {
      const result = matchSupplierCatalogue({
        ingredient: {
          organization_id: organizationId,
          canonical_key: item.canonical_key,
          display_name: item.item_name,
          unit: item.required_unit,
        },
        accounts,
        products,
        offers,
        approved_matches: approvedMatches.filter((match) =>
          match.canonical_key === item.canonical_key
          && (
            match as IngredientSupplierMatch & { supplier_account_id?: string }
          ).supplier_account_id === supplierAccountId
        ),
        rejected_fingerprints:
          rejectedFingerprintsByCanonicalKey.get(item.canonical_key) ?? [],
        supplier_account_ids: [supplierAccountId],
        as_of_date: asOfDate,
      });

      if (result.status === "approved_exact" || result.status === "no_match") {
        return [];
      }
      const candidate = result.status === "safe"
        ? result.selected
        : result.candidates.find(isEligibleReviewCandidate) ?? null;
      if (!candidate) return [];

      const payload = candidatePayload(
        item,
        candidate,
        result.status === "safe" ? "safe" : "review",
        result.margin_to_next,
        result.reason,
      );
      return payload ? [payload] : [];
    });
}

export function buildManuallySelectedCandidatePayload(
  organizationId: string,
  supplierAccount: SupplierAccount,
  item: SupplyItemRow,
  product: SupplierProduct,
  offer: SupplierOffer | null,
  asOfDate: string,
): SupplierMatchCandidatePayload {
  const result = matchSupplierCatalogue({
    ingredient: {
      organization_id: organizationId,
      canonical_key: item.canonical_key,
      display_name: item.item_name,
      unit: item.required_unit,
    },
    accounts: [supplierAccount],
    products: [product],
    offers: offer ? [offer] : [],
    approved_matches: [],
    rejected_fingerprints: [],
    supplier_account_ids: [supplierAccount.id],
    as_of_date: asOfDate,
  });
  const candidate = result.candidates[0];
  if (!candidate || !isEligibleReviewCandidate(candidate)) {
    throw new Error(
      "Artikeln har en viktvara eller en enhet som inte kan kopplas säkert till råvaran.",
    );
  }
  const payload = candidatePayload(
    item,
    candidate,
    "review",
    result.margin_to_next,
    "manually_selected_alternative",
    true,
  );
  if (!payload) {
    throw new Error("Artikeln saknar ett aktuellt produktfingeravtryck.");
  }
  return payload;
}
