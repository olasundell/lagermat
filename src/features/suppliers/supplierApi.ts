import type { SupabaseClient } from "@supabase/supabase-js";
import { collectPages } from "../../lib/pagination";
import { supabase } from "../../lib/supabase";
import type { Database } from "../../types/database";
import type {
  SupplierCatalogueApprovedMatchView,
  SupplierCatalogueCandidateView,
  SupplierCatalogueColumnProfileView,
} from "./SupplierCataloguePanel";
import type {
  SupplierCatalogueColumnMapping,
  SupplierCatalogueImportTable,
} from "./catalogueImportModel";
import type {
  IngredientSupplierMatch,
  PreferredSupplierMatch,
  SupplierAccount,
  SupplierImportColumnProfile,
  SupplierMatchDetail,
  SupplierMatchCandidate,
  SupplierOffer,
  SupplierProduct,
} from "./supplierModel";
import { CATALOGUE_MATCHER_VERSION } from "./catalogueMatcher";
import { hasCurrentIcaCataloguePackaging } from "./icaCatalogue";
import {
  isIcaSicklaAccount,
  isIcaSicklaCatalogueProduct,
} from "./icaStore";

export interface SupplierScope {
  organizationId: string;
  campId?: string;
}

export interface SupplierFoundationSnapshot {
  accounts: SupplierAccount[];
  products: SupplierProduct[];
  offers: SupplierOffer[];
  matches: IngredientSupplierMatch[];
  details: SupplierMatchDetail[];
  candidates: SupplierCatalogueCandidateView[];
  columnProfiles: SupplierCatalogueColumnProfileView[];
  approvedMatches: SupplierCatalogueApprovedMatchView[];
}

export interface SaveSupplierAccountInput {
  accountKey: string;
  providerKey: string;
  providerLocationId: string | null;
  displayName: string;
  customerNumber: string | null;
}

export interface SaveSupplierProductMatchInput {
  canonicalKey: string;
  supplierAccountId: string;
  supplierArticleNumber: string;
  displayName: string;
  purchaseUnit: string;
  packageAmount: number;
  packageUnit: string;
  amountPerPurchaseUnit: number;
  requiredUnit: string;
  gtin: string | null;
  minimumOrderUnits: number;
  price: number | null;
  currency: string;
  availabilityStatus: string;
  priceValidFrom: string | null;
  priceValidTo: string | null;
}

const ACCOUNT_COLUMNS = "id, organization_id, account_key, provider_key, provider_location_id, display_name, customer_number, active, created_by, created_at, updated_at" as const;
const PRODUCT_COLUMNS = "id, organization_id, supplier_account_id, supplier_article_number, display_name, gtin, purchase_unit, package_amount, package_unit, minimum_order_units, active, product_data_source, source_updated_at, created_by, created_at, updated_at, source_metadata, normalized_search_name, brand, category, packaging_metadata, catch_weight, product_fingerprint, latest_import_run_id" as const;
const OFFER_COLUMNS = "id, organization_id, supplier_product_id, price, currency, availability_status, valid_from, valid_to, fetched_at, created_at, updated_at" as const;
const MATCH_COLUMNS = "id, organization_id, canonical_key, supplier_account_id, supplier_product_id, required_unit, amount_per_purchase_unit, approved_product_fingerprint, approved_by, approved_at, created_at, updated_at" as const;
const PREFERRED_COLUMNS = "organization_id, canonical_key, supplier_account_id, ingredient_supplier_match_id, supplier_product_id, selected_by, selected_at, updated_at" as const;
const CANDIDATE_COLUMNS = "id, organization_id, supplier_account_id, canonical_key, supplier_product_id, import_run_id, matcher_version, status, score, signals, product_fingerprint, required_unit, amount_per_purchase_unit, generated_by, generated_at, decided_by, decided_at, decision_source, updated_at" as const;
const PROFILE_COLUMNS = "id, organization_id, supplier_account_id, profile_name, source_kind, column_mapping, created_by, created_at, updated_at" as const;

function supplierClient(): SupabaseClient<Database> {
  if (!supabase) {
    throw new Error("Databasen är inte konfigurerad.");
  }
  return supabase;
}

function requireOnline(): void {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("Leverantörsdata är endast tillgänglig när du är online.");
  }
}

function timestamp(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateInStockholm(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function isCurrentOffer(offer: SupplierOffer, currentDate: string): boolean {
  return (!offer.valid_from || offer.valid_from <= currentDate)
    && (!offer.valid_to || offer.valid_to >= currentDate);
}

function compareOffers(left: SupplierOffer, right: SupplierOffer): number {
  const fetchedDifference = timestamp(right.fetched_at, Number.NEGATIVE_INFINITY)
    - timestamp(left.fetched_at, Number.NEGATIVE_INFINITY);
  if (fetchedDifference !== 0) return fetchedDifference;

  const validFromDifference = timestamp(right.valid_from, Number.NEGATIVE_INFINITY)
    - timestamp(left.valid_from, Number.NEGATIVE_INFINITY);
  if (validFromDifference !== 0) return validFromDifference;

  const updatedDifference = timestamp(right.updated_at, Number.NEGATIVE_INFINITY)
    - timestamp(left.updated_at, Number.NEGATIVE_INFINITY);
  if (updatedDifference !== 0) return updatedDifference;

  return right.id.localeCompare(left.id, "sv-SE");
}

export function selectCurrentOffers(offers: SupplierOffer[], now: Date = new Date()): SupplierOffer[] {
  const selectedByProduct = new Map<string, SupplierOffer>();
  const currentDate = dateInStockholm(now);

  for (const offer of offers.filter((candidate) => isCurrentOffer(candidate, currentDate))) {
    const selected = selectedByProduct.get(offer.supplier_product_id);
    if (!selected || compareOffers(offer, selected) < 0) {
      selectedByProduct.set(offer.supplier_product_id, offer);
    }
  }

  return [...selectedByProduct.values()].sort((left, right) =>
    left.supplier_product_id.localeCompare(right.supplier_product_id, "sv-SE")
  );
}

function buildDetails(
  accounts: SupplierAccount[],
  products: SupplierProduct[],
  offers: SupplierOffer[],
  matches: IngredientSupplierMatch[],
): SupplierMatchDetail[] {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const productsById = new Map(products.map((product) => [product.id, product]));
  const offersByProductId = new Map(
    offers.map((offer) => [offer.supplier_product_id, offer]),
  );

  const details: SupplierMatchDetail[] = [];
  for (const match of matches) {
    const product = productsById.get(match.supplier_product_id);
    if (!product) continue;

    const account = accountsById.get(product.supplier_account_id);
    if (!account || !account.active || !product.active) continue;

    details.push({
      account,
      product,
      offer: offersByProductId.get(product.id) ?? null,
      match,
    });
  }

  return details.sort((left, right) => {
    const canonicalDifference = left.match.canonical_key.localeCompare(
      right.match.canonical_key,
      "sv-SE",
    );
    return canonicalDifference !== 0
      ? canonicalDifference
      : left.match.id.localeCompare(right.match.id, "sv-SE");
  });
}

const COLUMN_MAPPING_TARGETS = new Set<SupplierCatalogueColumnMapping["target"]>([
  "ignore",
  "supplier_article_number",
  "display_name",
  "purchase_unit",
  "total_quantity",
  "total_amount",
  "total_unit",
  "gtin",
  "price",
  "minimum_order_units",
  "inner_unit_count",
  "inner_unit_label",
  "valid_from",
  "valid_to",
  "category",
  "brand",
  "catch_weight",
]);

function columnProfileView(
  profile: SupplierImportColumnProfile,
): SupplierCatalogueColumnProfileView | null {
  if (
    profile.source_kind !== "csv"
    && profile.source_kind !== "xlsx"
  ) {
    return null;
  }
  if (!Array.isArray(profile.column_mapping)) return null;
  const mapping: SupplierCatalogueColumnMapping[] = [];
  for (const entry of profile.column_mapping) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const value = entry as Record<string, unknown>;
    if (
      typeof value.index !== "number"
      || !Number.isInteger(value.index)
      || typeof value.source !== "string"
      || typeof value.target !== "string"
      || !COLUMN_MAPPING_TARGETS.has(value.target as SupplierCatalogueColumnMapping["target"])
    ) {
      return null;
    }
    mapping.push({
      index: value.index,
      source: value.source,
      target: value.target as SupplierCatalogueColumnMapping["target"],
    });
  }
  const separator = profile.profile_name.indexOf(":");
  return {
    supplierAccountId: profile.supplier_account_id,
    sourceKind: profile.source_kind as SupplierCatalogueImportTable["sourceKind"],
    headerSignature: separator >= 0
      ? profile.profile_name.slice(0, separator)
      : profile.profile_name,
    mapping: mapping.sort((left, right) => left.index - right.index),
  };
}

async function fetchProductsByIds(
  client: SupabaseClient<Database>,
  organizationId: string,
  ids: readonly string[],
): Promise<SupplierProduct[]> {
  const rows: SupplierProduct[] = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const idBatch = ids.slice(offset, offset + 200);
    if (!idBatch.length) continue;
    const { data, error } = await client
      .from("supplier_products")
      .select(PRODUCT_COLUMNS)
      .eq("organization_id", organizationId)
      .in("id", idBatch)
      .order("id");
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

async function fetchMatchesByIds(
  client: SupabaseClient<Database>,
  organizationId: string,
  ids: readonly string[],
): Promise<IngredientSupplierMatch[]> {
  const rows: IngredientSupplierMatch[] = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const idBatch = ids.slice(offset, offset + 200);
    if (!idBatch.length) continue;
    const { data, error } = await client
      .from("ingredient_supplier_matches")
      .select(MATCH_COLUMNS)
      .eq("organization_id", organizationId)
      .in("id", idBatch)
      .order("id");
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

async function fetchRowsByProductIds(
  client: SupabaseClient<Database>,
  organizationId: string,
  productIds: readonly string[],
): Promise<SupplierOffer[]> {
  const rows: SupplierOffer[] = [];
  for (let offset = 0; offset < productIds.length; offset += 200) {
    const productIdBatch = productIds.slice(offset, offset + 200);
    if (!productIdBatch.length) continue;
    const page = await collectPages(async (pageOffset, pageSize) => {
      const { data, error } = await client
        .from("supplier_offers")
        .select(OFFER_COLUMNS)
        .eq("organization_id", organizationId)
        .in("supplier_product_id", productIdBatch)
        .order("id")
        .range(pageOffset, pageOffset + pageSize - 1);
      if (error) throw error;
      return data ?? [];
    });
    rows.push(...page);
  }
  return rows;
}

function currentPreferredMatches(
  preferredMatches: PreferredSupplierMatch[],
  matches: IngredientSupplierMatch[],
  products: SupplierProduct[],
): PreferredSupplierMatch[] {
  const matchesById = new Map(matches.map((match) => [match.id, match]));
  const productsById = new Map(products.map((product) => [product.id, product]));
  return preferredMatches.filter((preferred) => {
    const match = matchesById.get(preferred.ingredient_supplier_match_id);
    const product = productsById.get(preferred.supplier_product_id);
    return Boolean(
      match
      && product
      && product.active
      && match.supplier_account_id === preferred.supplier_account_id
      && match.supplier_product_id === product.id
      && match.approved_product_fingerprint === product.product_fingerprint
    );
  });
}

function signalRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function supplierCandidateReasons(signalsValue: unknown): string[] {
  if (
    !signalsValue
    || typeof signalsValue !== "object"
    || Array.isArray(signalsValue)
  ) {
    return [];
  }
  const signals = signalsValue as Record<string, unknown>;
  const semanticExplanation =
    signalRecord(signals.semantic_rerank)?.explanation;
  const marginExplanation =
    signals.resolution_reason === "safe_margin_not_met"
      && typeof signals.margin_to_next === "number"
    ? `Bara ${signals.margin_to_next} poäng skiljer till nästa möjliga artikel; minst 8 krävs för en säker träff.`
    : null;
  const explanations = signals.explanations;
  const deterministicReasons = Array.isArray(explanations)
    ? explanations.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const message = (entry as Record<string, unknown>).message;
    return typeof message === "string" && message.trim() ? [message.trim()] : [];
      })
    : [];
  return [...new Set([
    ...(typeof semanticExplanation === "string"
        && semanticExplanation.trim()
      ? [semanticExplanation.trim()]
      : []),
    ...(marginExplanation ? [marginExplanation] : []),
    ...deterministicReasons,
  ])];
}

function candidateReasons(candidate: SupplierMatchCandidate): string[] {
  return supplierCandidateReasons(candidate.signals);
}

function candidateViews(
  candidates: SupplierMatchCandidate[],
  products: SupplierProduct[],
): SupplierCatalogueCandidateView[] {
  const productsById = new Map(products.map((product) => [product.id, product]));
  return candidates.flatMap((candidate) => {
    const product = productsById.get(candidate.supplier_product_id);
    if (!product || (candidate.status !== "safe" && candidate.status !== "review")) {
      return [];
    }
    return [{
      id: candidate.id,
      supplierAccountId: candidate.supplier_account_id,
      canonicalKey: candidate.canonical_key,
      supplierProductId: candidate.supplier_product_id,
      status: "pending" as const,
      classification: candidate.status,
      score: candidate.score,
      matcherVersion: candidate.matcher_version,
      amountPerPurchaseUnit: candidate.amount_per_purchase_unit,
      requiredUnit: candidate.required_unit,
      reasons: candidateReasons(candidate),
      semanticAssisted:
        signalRecord(
          signalRecord(candidate.signals)?.semantic_rerank,
        )?.adapter === "netlify-ai-gateway",
      product,
    }];
  });
}

export async function fetchSupplierFoundation(
  scope: SupplierScope,
  canonicalKeys: readonly string[] = [],
): Promise<SupplierFoundationSnapshot> {
  const client = supplierClient();
  requireOnline();

  const uniqueCanonicalKeys = [...new Set(canonicalKeys)];
  const [accountResult, profileResult] = await Promise.all([
    client
      .from("supplier_accounts")
      .select(ACCOUNT_COLUMNS)
      .eq("organization_id", scope.organizationId)
      .order("id"),
    client
      .from("supplier_import_column_profiles")
      .select(PROFILE_COLUMNS)
      .eq("organization_id", scope.organizationId)
      .order("id"),
  ]);

  if (accountResult.error) throw accountResult.error;
  if (profileResult.error) throw profileResult.error;

  const accounts = accountResult.data ?? [];
  const columnProfiles = (profileResult.data ?? [])
    .map(columnProfileView)
    .filter((profile): profile is SupplierCatalogueColumnProfileView => Boolean(profile));
  if (!uniqueCanonicalKeys.length) {
    return {
      accounts,
      products: [],
      offers: [],
      matches: [],
      details: [],
      candidates: [],
      columnProfiles,
      approvedMatches: [],
    };
  }

  const [preferredMatches, openCandidates] = await Promise.all([
    collectPages(async (offset, pageSize) => {
      const { data, error } = await client
        .from("preferred_supplier_matches")
        .select(PREFERRED_COLUMNS)
        .eq("organization_id", scope.organizationId)
        .in("canonical_key", uniqueCanonicalKeys)
        .order("canonical_key")
        .order("supplier_account_id")
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      return data ?? [];
    }),
    collectPages(async (offset, pageSize) => {
      const { data, error } = await client
        .from("supplier_match_candidates")
        .select(CANDIDATE_COLUMNS)
        .eq("organization_id", scope.organizationId)
        .in("canonical_key", uniqueCanonicalKeys)
        .eq("matcher_version", CATALOGUE_MATCHER_VERSION)
        .in("status", ["safe", "review"])
        .order("canonical_key")
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      return data ?? [];
    }),
  ]);
  const productIds = [...new Set([
    ...preferredMatches.map((preferred) => preferred.supplier_product_id),
    ...openCandidates.map((candidate) => candidate.supplier_product_id),
  ])];
  const matchIds = [...new Set(
    preferredMatches.map((preferred) => preferred.ingredient_supplier_match_id),
  )];
  const [fetchedProducts, matches] = await Promise.all([
    fetchProductsByIds(client, scope.organizationId, productIds),
    fetchMatchesByIds(client, scope.organizationId, matchIds),
  ]);
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const products = fetchedProducts.filter((product) => {
    const account = accountsById.get(product.supplier_account_id);
    return !isIcaSicklaAccount(account)
      || (
        isIcaSicklaCatalogueProduct(product)
        && hasCurrentIcaCataloguePackaging(product)
      );
  });
  const currentPreferred = currentPreferredMatches(
    preferredMatches,
    matches,
    products,
  );
  const currentMatchIds = new Set(
    currentPreferred.map((preferred) => preferred.ingredient_supplier_match_id),
  );
  const currentMatches = matches.filter((match) => currentMatchIds.has(match.id));
  const relevantProductIds = new Set([
    ...currentPreferred.map((preferred) => preferred.supplier_product_id),
    ...openCandidates.map((candidate) => candidate.supplier_product_id),
  ]);
  const relevantProducts = products.filter((product) => relevantProductIds.has(product.id));
  const fetchedOffers = await fetchRowsByProductIds(
    client,
    scope.organizationId,
    relevantProducts.map((product) => product.id),
  );
  const offers = selectCurrentOffers(fetchedOffers);

  return {
    accounts,
    products: relevantProducts,
    offers,
    matches: currentMatches,
    details: buildDetails(accounts, relevantProducts, offers, currentMatches),
    candidates: candidateViews(openCandidates, relevantProducts),
    columnProfiles,
    approvedMatches: currentPreferred.map((preferred) => ({
      supplierAccountId: preferred.supplier_account_id,
      canonicalKey: preferred.canonical_key,
    })),
  };
}

export async function ensureIcaSicklaSupplierAccount(
  scope: SupplierScope,
): Promise<string> {
  const client = supplierClient();
  requireOnline();
  const { data, error } = await client.rpc(
    "ensure_ica_sickla_supplier_account",
    {
      p_organization_id: scope.organizationId,
    },
  );
  if (error) throw error;
  return data;
}

export async function saveSupplierAccount(
  scope: SupplierScope,
  input: SaveSupplierAccountInput,
): Promise<void> {
  const client = supplierClient();
  requireOnline();

  const { error } = await client.rpc("save_supplier_account_identity", {
    p_organization_id: scope.organizationId,
    p_account_key: input.accountKey,
    p_provider_key: input.providerKey,
    p_provider_location_id: input.providerLocationId ?? "",
    p_display_name: input.displayName,
    p_customer_number: input.customerNumber ?? "",
  });
  if (error) throw error;
}

export async function saveSupplierProductMatch(
  scope: SupplierScope,
  input: SaveSupplierProductMatchInput,
): Promise<void> {
  const client = supplierClient();
  requireOnline();
  const { data: account, error: accountError } = await client
    .from("supplier_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("organization_id", scope.organizationId)
    .eq("id", input.supplierAccountId)
    .eq("active", true)
    .single();
  if (accountError) throw accountError;
  if (isIcaSicklaAccount(account)) {
    throw new Error(
      "ICA-artiklar matchas från butikens hämtade sortiment och kan inte skrivas in manuellt.",
    );
  }

  const { error } = await client.rpc("save_supplier_product_match", {
    p_organization_id: scope.organizationId,
    p_canonical_key: input.canonicalKey,
    p_supplier_account_id: input.supplierAccountId,
    p_supplier_article_number: input.supplierArticleNumber,
    p_display_name: input.displayName,
    p_purchase_unit: input.purchaseUnit,
    p_package_amount: input.packageAmount,
    p_package_unit: input.packageUnit,
    p_amount_per_purchase_unit: input.amountPerPurchaseUnit,
    p_required_unit: input.requiredUnit,
    p_currency: input.currency,
    p_availability_status: input.availabilityStatus,
    p_minimum_order_units: input.minimumOrderUnits,
    ...(input.gtin ? { p_gtin: input.gtin } : {}),
    ...(input.price !== null ? { p_price: input.price } : {}),
    ...(input.priceValidFrom ? { p_price_valid_from: input.priceValidFrom } : {}),
    ...(input.priceValidTo ? { p_price_valid_to: input.priceValidTo } : {}),
  });
  if (error) throw error;
}
