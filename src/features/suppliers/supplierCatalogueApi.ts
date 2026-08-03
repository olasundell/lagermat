import type { SupabaseClient } from "@supabase/supabase-js";
import { collectPages } from "../../lib/pagination";
import { supabase } from "../../lib/supabase";
import type { Database, Json, Tables } from "../../types/database";
import type { SupplyItemRow } from "../supplies/supplyModel";
import {
  CATALOGUE_MATCHER_VERSION,
  normalizeCatalogueText,
} from "./catalogueMatcher";
import type {
  SupplierCatalogueColumnMapping,
  SupplierCataloguePreview,
} from "./catalogueImportModel";
import {
  applySupplierSemanticReranks,
  buildManuallySelectedCandidatePayload,
  buildIngredientContextsFromCalculationLines,
  buildStagedSupplierCatalogueRows,
  buildSupplierMatchGeneration,
  supplierCatalogueSourceFingerprint,
  type SupplierCatalogueEnrichment,
  type SupplierCatalogueEnrichmentSource,
  type SupplierMatchCandidatePayload,
  type SupplierSemanticMatchApplication,
} from "./supplierCatalogueWorkflow";
import {
  SUPPLIER_SEMANTIC_MAX_GROUPS_PER_REQUEST,
} from "./supplierSemanticMatch";
import { fetchSupplierSemanticReranks } from "./supplierSemanticMatchClient";
import {
  hasCurrentIcaCataloguePackaging,
} from "./icaCatalogue";
import { fetchIcaCatalogueBatch } from "./icaCatalogueClient";
import {
  ICA_CATALOGUE_NORMALISATION_VERSION,
  ICA_KVANTUM_SICKLA,
  isIcaCatalogueProductForCompletedSearch,
  isIcaSicklaAccount,
  isIcaSicklaCatalogueProduct,
  isLocalIcaFixtureProduct,
} from "./icaStore";
import {
  ICA_CATALOGUE_RUNTIME_SOURCE,
  type IcaCatalogueRuntimeSource,
} from "./icaCatalogueRuntime";
import type {
  IcaCatalogueSyncPhase,
  IcaCatalogueSyncProgress,
} from "./icaCatalogueSyncModel";
import {
  icaCatalogueQueryKey,
  normaliseIcaCatalogueQuery,
} from "./icaCatalogueSyncModel";
import { selectCurrentOffers, type SupplierScope } from "./supplierApi";
import type {
  IngredientSupplierMatch,
  SupplierAccount,
  SupplierOffer,
  SupplierProduct,
} from "./supplierModel";

const PRODUCT_COLUMNS = "id, organization_id, supplier_account_id, supplier_article_number, display_name, gtin, purchase_unit, package_amount, package_unit, minimum_order_units, active, product_data_source, source_updated_at, created_by, created_at, updated_at, source_metadata, normalized_search_name, brand, category, packaging_metadata, catch_weight, product_fingerprint, latest_import_run_id" as const;

const OFFER_COLUMNS = "id, organization_id, supplier_product_id, price, currency, availability_status, valid_from, valid_to, fetched_at, created_at, updated_at" as const;

const MATCH_COLUMNS = "id, organization_id, canonical_key, supplier_product_id, supplier_account_id, required_unit, amount_per_purchase_unit, approved_product_fingerprint, approved_by, approved_at, created_at, updated_at" as const;

type SupplierMatchCandidate = Tables<"supplier_match_candidates">;
const automaticMatchSignatures = new Set<string>();
interface AutomaticIcaSyncState {
  completedQueryKeys: Set<string>;
  deferredQueryKeys: Set<string>;
  retryAt: number;
  lastAttemptedAt: number | null;
  warning: string | null;
  syntheticLocalFixture: boolean;
  phase: Exclude<IcaCatalogueSyncPhase, "complete">;
}
const automaticIcaSyncStates = new Map<string, AutomaticIcaSyncState>();
const ICA_SEARCH_BATCH_SIZE = 10;
const ICA_SEARCH_BATCH_MAX_CODE_POINTS = 600;
const ICA_SEARCH_STATE_BATCH_SIZE = 100;
const ICA_SYNC_PROGRESS_DELAY_MS = 15_000;
const ICA_SYNC_LIMIT_DELAY_MS = 60_000;

function isCurrentIcaCatalogueProduct(product: SupplierProduct): boolean {
  return isIcaSicklaCatalogueProduct(product)
    && hasCurrentIcaCataloguePackaging(product);
}

export interface SupplierCatalogueImportOutcome {
  imported: number;
  matched: number;
  dabasConfigured: boolean;
  enrichmentSource: SupplierCatalogueEnrichmentSource;
}

interface DabasEnrichmentResponse {
  configured?: boolean;
  adapter?: SupplierCatalogueEnrichmentSource;
  products?: SupplierCatalogueEnrichment[];
  failures?: string[];
}

function catalogueClient(): SupabaseClient<Database> {
  if (!supabase) throw new Error("Databasen är inte konfigurerad.");
  return supabase;
}

function requireOnline(): void {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("Katalogimport kräver nätanslutning.");
  }
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

function dateInStockholm(value: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function json(value: unknown): Json {
  return value as Json;
}

export function selectNextIcaCatalogueQueryBatch(
  queries: readonly string[],
  completedQueries: readonly string[],
  batchSize = ICA_SEARCH_BATCH_SIZE,
  deferredQueries: readonly string[] = [],
): string[] {
  const completedKeys = new Set(completedQueries.map(icaCatalogueQueryKey));
  const deferredKeys = new Set(deferredQueries.map(icaCatalogueQueryKey));
  const batch: string[] = [];
  let codePoints = 0;
  for (const query of queries) {
      const key = icaCatalogueQueryKey(query);
    if (completedKeys.has(key) || deferredKeys.has(key)) continue;
    const queryCodePoints = Array.from(query).length;
    if (
      batch.length >= batchSize
      || codePoints + queryCodePoints > ICA_SEARCH_BATCH_MAX_CODE_POINTS
    ) {
      break;
    }
    batch.push(query);
    codePoints += queryCodePoints;
  }
  return batch;
}

export function buildIcaCatalogueQueries(
  items: readonly SupplyItemRow[],
): string[] {
  const queries = new Map<string, string>();
  for (const entry of buildIcaCatalogueSearchEntries(items)) {
    const key = icaCatalogueQueryKey(entry.query);
    if (!queries.has(key)) queries.set(key, entry.query);
  }
  return [...queries.values()];
}

interface IcaCatalogueSearchEntry {
  canonicalKey: string;
  query: string;
}

function buildIcaCatalogueSearchEntries(
  items: readonly SupplyItemRow[],
): IcaCatalogueSearchEntry[] {
  const queries = new Map<string, string>();
  for (const item of items) {
    if (!item.source_present) continue;
    const query = normaliseIcaCatalogueQuery(item.item_name);
    if (query.length < 2) continue;
    if (!queries.has(item.canonical_key)) {
      queries.set(item.canonical_key, query);
    }
  }
  return [...queries].map(([canonicalKey, query]) => ({
    canonicalKey,
    query,
  }));
}

type IcaCatalogueSearchStatus =
  | "pending"
  | "syncing"
  | "retrying"
  | "complete"
  | "error";

interface PersistedIcaCatalogueSearchState {
  canonical_key: string;
  search_query: string;
  search_date: string;
  status: IcaCatalogueSearchStatus;
}

type CachedIcaCatalogueSource = IcaCatalogueRuntimeSource | "mixed" | null;

export function completedIcaCatalogueQueriesFromState({
  entries,
  persistedStates,
  searchDate,
  cachedSource,
  runtimeSource,
}: {
  entries: readonly IcaCatalogueSearchEntry[];
  persistedStates: readonly PersistedIcaCatalogueSearchState[];
  searchDate: string;
  cachedSource: CachedIcaCatalogueSource;
  runtimeSource: IcaCatalogueRuntimeSource;
}): string[] {
  if (cachedSource === "mixed") return [];
  if (cachedSource !== null && cachedSource !== runtimeSource) return [];
  // A public search with no result has no product row from which to recover
  // provenance, but its completed state is still a valid result for today.
  if (cachedSource === null && runtimeSource === "fixture") return [];

  return entries.filter((entry) => persistedStates.some((persisted) =>
    persisted.status === "complete"
    && persisted.search_date === searchDate
    && persisted.canonical_key === entry.canonicalKey
    && icaCatalogueQueryKey(persisted.search_query)
      === icaCatalogueQueryKey(entry.query)
  )).map((entry) => entry.query);
}

function cachedIcaCatalogueSource(
  products: readonly SupplierProduct[],
): CachedIcaCatalogueSource {
  const hasFixture = products.some(isLocalIcaFixtureProduct);
  const hasPublic = products.some((product) =>
    isIcaSicklaCatalogueProduct(product) && !isLocalIcaFixtureProduct(product)
  );
  if (hasFixture && hasPublic) return "mixed";
  if (hasFixture) return "fixture";
  if (hasPublic) return "public";
  return null;
}

async function recordIcaCatalogueSearchStates(
  client: SupabaseClient<Database>,
  scope: SupplierScope,
  supplierAccountId: string,
  entries: readonly IcaCatalogueSearchEntry[],
  status: IcaCatalogueSearchStatus,
  searchDate: string,
  retryAt: number | null = null,
  lastError: string | null = null,
): Promise<void> {
  if (!scope.campId || entries.length === 0) return;
  for (const batch of chunks([...entries], ICA_SEARCH_STATE_BATCH_SIZE)) {
    const { error } = await client.rpc("record_supplier_catalogue_search_states", {
      p_organization_id: scope.organizationId,
      p_camp_id: scope.campId,
      p_supplier_account_id: supplierAccountId,
      p_states: json(batch.map((entry) => ({
        canonical_key: entry.canonicalKey,
        search_query: entry.query,
        search_date: searchDate,
        status,
        retry_at: retryAt === null ? null : new Date(retryAt).toISOString(),
        last_error: lastError,
      }))),
    });
    if (error) throw error;
  }
}

async function fetchIcaCatalogueSearchStates(
  client: SupabaseClient<Database>,
  scope: SupplierScope,
  supplierAccountId: string,
): Promise<PersistedIcaCatalogueSearchState[]> {
  if (!scope.campId) return [];
  const { data, error } = await client
    .from("supplier_catalogue_search_states")
    .select("canonical_key, search_query, search_date, status")
    .eq("organization_id", scope.organizationId)
    .eq("camp_id", scope.campId)
    .eq("supplier_account_id", supplierAccountId);
  if (error) throw error;
  return (data ?? []) as PersistedIcaCatalogueSearchState[];
}

function entriesForQueryKeys(
  entries: readonly IcaCatalogueSearchEntry[],
  queryKeys: ReadonlySet<string>,
): IcaCatalogueSearchEntry[] {
  return entries.filter((entry) => queryKeys.has(icaCatalogueQueryKey(entry.query)));
}

interface IcaCatalogueRowsOutcome {
  complete: boolean;
  completedQueries: string[];
  syntheticLocalFixture: boolean;
}

async function fetchIcaCatalogueRows(
  client: SupabaseClient<Database>,
  scope: SupplierScope,
  queries: readonly string[],
): Promise<IcaCatalogueRowsOutcome> {
  if (!queries.length) {
    return {
      complete: true,
      completedQueries: [],
      syntheticLocalFixture: false,
    };
  }

  const completedQueries: string[] = [];
  let source: "ica_public_webshop" | "ica_local_fixture" = "ica_public_webshop";
  let complete = true;
  for (const batch of chunks(queries, ICA_SEARCH_BATCH_SIZE)) {
    const data = await fetchIcaCatalogueBatch(
      client,
      scope.organizationId,
      ICA_KVANTUM_SICKLA.id,
      batch,
    );
    source = data.source.channel === "local-fixture"
      ? "ica_local_fixture"
      : "ica_public_webshop";
    completedQueries.push(...data.source.searches.map((search) => search.query));
    if (!data.source.complete) {
      complete = false;
      break;
    }
  }

  return {
    complete,
    completedQueries,
    syntheticLocalFixture: source === "ica_local_fixture",
  };
}

async function enrichGtins(
  client: SupabaseClient<Database>,
  scope: SupplierScope,
  preview: SupplierCataloguePreview,
): Promise<{
  configured: boolean;
  source: SupplierCatalogueEnrichmentSource;
  products: SupplierCatalogueEnrichment[];
}> {
  const gtins = [...new Set(
    preview.rows
      .filter((row) => row.status !== "blocked")
      .map((row) => row.gtin)
      .filter((gtin): gtin is string => Boolean(gtin)),
  )];
  if (!gtins.length) return { configured: false, source: "none", products: [] };

  const products: SupplierCatalogueEnrichment[] = [];
  let configured = false;
  let source: SupplierCatalogueEnrichmentSource = "none";
  try {
    for (const batch of chunks(gtins, 50)) {
      const { data, error } = await client.functions.invoke<DabasEnrichmentResponse>(
        "supplier-catalogue",
        {
          body: {
            action: "enrich-gtins",
            organizationId: scope.organizationId,
            gtins: batch,
          },
        },
      );
      if (error) throw error;
      configured ||= data?.configured === true;
      if (data?.adapter === "dabas" || data?.adapter === "fixture") {
        source = data.adapter;
      }
      products.push(...(data?.products ?? []));
    }
  } catch {
    // Dabas is optional. A missing key or temporarily unavailable enrichment
    // service must never prevent the supplier catalogue itself from importing.
    return { configured: false, source: "none", products: [] };
  }
  return { configured, source, products };
}

async function fetchProductsForAccount(
  client: SupabaseClient<Database>,
  scope: SupplierScope,
  supplierAccountId: string,
): Promise<SupplierProduct[]> {
  return collectPages(async (offset, pageSize) => {
    const { data, error } = await client
      .from("supplier_products")
      .select(PRODUCT_COLUMNS)
      .eq("organization_id", scope.organizationId)
      .eq("supplier_account_id", supplierAccountId)
      .eq("active", true)
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    return data ?? [];
  }, 500);
}

async function fetchOffersForProducts(
  client: SupabaseClient<Database>,
  scope: SupplierScope,
  productIds: readonly string[],
): Promise<SupplierOffer[]> {
  const offers: SupplierOffer[] = [];
  for (const productIdBatch of chunks([...new Set(productIds)], 200)) {
    if (!productIdBatch.length) continue;
    const page = await collectPages(async (offset, pageSize) => {
      const { data, error } = await client
        .from("supplier_offers")
        .select(OFFER_COLUMNS)
        .eq("organization_id", scope.organizationId)
        .in("supplier_product_id", productIdBatch)
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      return data ?? [];
    }, 500);
    offers.push(...page);
  }
  return selectCurrentOffers(offers);
}

async function fetchApprovedMatches(
  client: SupabaseClient<Database>,
  scope: SupplierScope,
  supplierAccountId: string,
  canonicalKeys: readonly string[],
): Promise<IngredientSupplierMatch[]> {
  if (!canonicalKeys.length) return [];
  const matches = await collectPages(async (offset, pageSize) => {
    const { data, error } = await client
      .from("ingredient_supplier_matches")
      .select(MATCH_COLUMNS)
      .eq("organization_id", scope.organizationId)
      .eq("supplier_account_id", supplierAccountId)
      .in("canonical_key", [...new Set(canonicalKeys)])
      .not("approved_by", "is", null)
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    return data ?? [];
  }, 500);
  return matches;
}

async function fetchRejectedFingerprints(
  client: SupabaseClient<Database>,
  scope: SupplierScope,
  supplierAccountId: string,
  canonicalKeys: readonly string[],
): Promise<Map<string, string[]>> {
  if (!canonicalKeys.length) return new Map();
  const rejected = await collectPages(async (offset, pageSize) => {
    const { data, error } = await client
      .from("supplier_match_candidates")
      .select("canonical_key, product_fingerprint")
      .eq("organization_id", scope.organizationId)
      .eq("supplier_account_id", supplierAccountId)
      .eq("status", "rejected")
      .in("canonical_key", [...new Set(canonicalKeys)])
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    return data ?? [];
  }, 500);

  const byCanonicalKey = new Map<string, string[]>();
  for (const candidate of rejected) {
    const fingerprints = byCanonicalKey.get(candidate.canonical_key) ?? [];
    fingerprints.push(candidate.product_fingerprint);
    byCanonicalKey.set(candidate.canonical_key, fingerprints);
  }
  return byCanonicalKey;
}

async function fetchIngredientContexts(
  client: SupabaseClient<Database>,
  scope: SupplierScope,
  canonicalKeys: readonly string[],
) {
  if (!scope.campId || !canonicalKeys.length) return new Map();

  const { data: revision, error: revisionError } = await client
    .from("calculation_revisions")
    .select("id")
    .eq("organization_id", scope.organizationId)
    .eq("camp_id", scope.campId)
    .eq("status", "current")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (revisionError) throw revisionError;
  if (!revision) return new Map();

  const lines = await collectPages(async (offset, pageSize) => {
    const { data, error } = await client
      .from("calculation_lines")
      .select("canonical_key, trace")
      .eq("organization_id", scope.organizationId)
      .eq("camp_id", scope.campId!)
      .eq("calculation_revision_id", revision.id)
      .in("canonical_key", [...new Set(canonicalKeys)])
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    return data ?? [];
  }, 500);
  return buildIngredientContextsFromCalculationLines(lines);
}

async function replaceCandidates(
  client: SupabaseClient<Database>,
  scope: SupplierScope,
  supplierAccountId: string,
  candidates: readonly SupplierMatchCandidatePayload[],
): Promise<number> {
  if (candidates.length > 500) {
    throw new Error("Inköpslistan har fler än 500 råvaror och kan inte matchas i en körning.");
  }
  const { data, error } = await client.rpc("replace_supplier_match_candidates", {
    p_organization_id: scope.organizationId,
    p_supplier_account_id: supplierAccountId,
    p_matcher_version: CATALOGUE_MATCHER_VERSION,
    p_candidates: json(candidates),
  });
  if (error) throw error;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const inserted = (data as Record<string, Json | undefined>).inserted_candidates;
    if (typeof inserted === "number") return inserted;
  }
  return candidates.length;
}

async function generateCandidates(
  client: SupabaseClient<Database>,
  scope: SupplierScope,
  supplierAccountId: string,
  items: SupplyItemRow[],
  icaSync?: {
    completedEntries: IcaCatalogueSearchEntry[];
    searchDate: string;
    syntheticLocalFixture: boolean;
  },
): Promise<number> {
  const accountResult = await client
    .from("supplier_accounts")
    .select("*")
    .eq("organization_id", scope.organizationId)
    .eq("id", supplierAccountId)
    .eq("active", true)
    .single();
  if (accountResult.error) throw accountResult.error;
  const account = accountResult.data;
  const matchableItems = isIcaSicklaAccount(account) && icaSync
    ? items.filter((item) => icaSync.completedEntries.some((entry) =>
        entry.canonicalKey === item.canonical_key
      ))
    : items;
  const canonicalKeys = [...new Set(
    matchableItems
      .filter((item) => item.source_present)
      .map((item) => item.canonical_key),
  )];
  const [allProducts, approvedMatches, rejectedFingerprints, ingredientContexts] =
    await Promise.all([
      fetchProductsForAccount(client, scope, supplierAccountId),
      fetchApprovedMatches(
        client,
        scope,
        supplierAccountId,
        canonicalKeys,
      ),
      fetchRejectedFingerprints(
        client,
        scope,
        supplierAccountId,
        canonicalKeys,
      ),
      fetchIngredientContexts(client, scope, canonicalKeys),
    ]);
  const products = isIcaSicklaAccount(account)
    ? allProducts.filter((product) =>
        isCurrentIcaCatalogueProduct(product)
        && (!icaSync || icaSync.completedEntries.some((entry) =>
          isIcaCatalogueProductForCompletedSearch(
            product,
            entry.query,
            icaSync.searchDate,
            icaSync.syntheticLocalFixture,
          )
        ))
      )
    : allProducts;
  const offers = await fetchOffersForProducts(
    client,
    scope,
    products.map((product) => product.id),
  );
  const currentApprovedMatches = approvedMatches.filter((match) => {
    const product = products.find((candidate) => candidate.id === match.supplier_product_id);
    return product
      && match.approved_product_fingerprint === product.product_fingerprint;
  });
  const generation = buildSupplierMatchGeneration({
    organizationId: scope.organizationId,
    supplierAccountId,
    items: matchableItems,
    accounts: [account],
    products,
    offers,
    approvedMatches: currentApprovedMatches,
    rejectedFingerprintsByCanonicalKey: rejectedFingerprints,
    ingredientContextsByCanonicalKey: ingredientContexts,
    asOfDate: dateInStockholm(),
  });
  if (!scope.campId || !isIcaSicklaAccount(account)) {
    return replaceCandidates(
      client,
      scope,
      supplierAccountId,
      generation.payloads,
    );
  }
  const semanticApplications: SupplierSemanticMatchApplication[] = [];
  for (
    const batch of chunks(
      generation.semanticGroups,
      SUPPLIER_SEMANTIC_MAX_GROUPS_PER_REQUEST,
    )
  ) {
    try {
      const response = await fetchSupplierSemanticReranks(
        client,
        scope.organizationId,
        scope.campId,
        supplierAccountId,
        batch,
      );
      if (
        response.configured
        && response.adapter !== "none"
        && response.model
      ) {
        semanticApplications.push({
          adapter: response.adapter,
          model: response.model,
          results: response.results,
        });
      }
    } catch {
      // Semantic assistance is advisory. Deterministic, safety-filtered
      // candidates remain available when the model or its cache is unavailable.
    }
  }
  const candidates = applySupplierSemanticReranks(
    generation,
    semanticApplications,
  );
  return replaceCandidates(client, scope, supplierAccountId, candidates);
}

interface IcaCatalogueSyncOutcome {
  warning: string | null;
  retryAfterMs: number | null;
  progress: IcaCatalogueSyncProgress;
}

function icaSyncProgress(
  queries: readonly string[],
  completedQueryKeys: ReadonlySet<string>,
  phase: IcaCatalogueSyncPhase,
  retryAfterMs: number | null,
  retryAt: number | null,
  lastAttemptedAt: number | null,
  syntheticLocalFixture = false,
): IcaCatalogueSyncProgress {
  return {
    phase,
    completedQueries: queries.filter((query) =>
      completedQueryKeys.has(icaCatalogueQueryKey(query))
    ),
    totalQueries: queries.length,
    retryAfterMs,
    retryAt,
    lastAttemptedAt,
    syntheticLocalFixture,
  };
}

export function automaticIcaSyncSignature(
  scope: SupplierScope,
  supplierAccountId: string,
  searchDate: string,
  queries: readonly string[],
): string {
  return [
    scope.organizationId,
    scope.campId ?? "",
    supplierAccountId,
    searchDate,
    queries.join("\u001f"),
  ].join(":");
}

async function syncIcaCatalogue(
  client: SupabaseClient<Database>,
  scope: SupplierScope,
  supplierAccountId: string,
  items: SupplyItemRow[],
  force = false,
): Promise<IcaCatalogueSyncOutcome> {
  const entries = buildIcaCatalogueSearchEntries(items);
  const queries = buildIcaCatalogueQueries(items);
  const searchDate = dateInStockholm();
  if (!queries.length) {
    return {
      warning: null,
      retryAfterMs: null,
      progress: {
        phase: "complete",
        completedQueries: [],
        totalQueries: 0,
        retryAfterMs: null,
        retryAt: null,
        lastAttemptedAt: null,
      },
    };
  }
  await recordIcaCatalogueSearchStates(
    client,
    scope,
    supplierAccountId,
    entries,
    "pending",
    searchDate,
  );
  const signature = automaticIcaSyncSignature(
    scope,
    supplierAccountId,
    searchDate,
    queries,
  );
  let state = automaticIcaSyncStates.get(signature);
  if (!state) {
    const [existingProducts, persistedStates] = await Promise.all([
      fetchProductsForAccount(client, scope, supplierAccountId),
      fetchIcaCatalogueSearchStates(client, scope, supplierAccountId),
    ]);
    const cachedSource = cachedIcaCatalogueSource(existingProducts);
    const completedFromState = completedIcaCatalogueQueriesFromState({
      entries,
      persistedStates,
      searchDate,
      cachedSource,
      runtimeSource: ICA_CATALOGUE_RUNTIME_SOURCE,
    });
    const completedQueryKeys = new Set(
      completedFromState.map(icaCatalogueQueryKey),
    );
    state = {
      completedQueryKeys,
      deferredQueryKeys: new Set(),
      retryAt: 0,
      lastAttemptedAt: null,
      warning: null,
      phase: "syncing",
      // The explicit local launcher is the authority for what source may be
      // used. A cached source from another runtime is refreshed before it can
      // contribute candidates.
      syntheticLocalFixture: ICA_CATALOGUE_RUNTIME_SOURCE === "fixture",
    };
    automaticIcaSyncStates.set(signature, state);
    if (completedQueryKeys.size > 0) {
      await recordIcaCatalogueSearchStates(
        client,
        scope,
        supplierAccountId,
        entriesForQueryKeys(entries, completedQueryKeys),
        "complete",
        searchDate,
      );
    }
  }

  if (force) {
    state.retryAt = 0;
    state.deferredQueryKeys.clear();
    state.warning = null;
    state.phase = "syncing";
  }

  const now = Date.now();
  if (state.retryAt > now) {
    const retryAfterMs = Math.max(1_000, state.retryAt - now);
    return {
      warning: state.warning,
      retryAfterMs,
      progress: icaSyncProgress(
        queries,
        state.completedQueryKeys,
        state.phase,
        retryAfterMs,
        state.retryAt,
        state.lastAttemptedAt,
        state.syntheticLocalFixture,
      ),
    };
  }

  const completedQueries = queries.filter((query) =>
    state!.completedQueryKeys.has(icaCatalogueQueryKey(query))
  );
  let batch = selectNextIcaCatalogueQueryBatch(
    queries,
    completedQueries,
    ICA_SEARCH_BATCH_SIZE,
    [...state.deferredQueryKeys],
  );
  if (
    !batch.length
    && state.completedQueryKeys.size < queries.length
  ) {
    state.deferredQueryKeys.clear();
    batch = selectNextIcaCatalogueQueryBatch(
      queries,
      completedQueries,
    );
  }
  if (!batch.length) {
    state.warning = state.syntheticLocalFixture
      ? "Lokalt syntetiskt ICA-sortiment används för denna utvecklingsmiljö."
      : null;
    state.retryAt = 0;
    return {
      warning: state.warning,
      retryAfterMs: null,
      progress: icaSyncProgress(
        queries,
        state.completedQueryKeys,
        "complete",
        null,
        null,
        state.lastAttemptedAt,
        state.syntheticLocalFixture,
      ),
    };
  }

  const batchKeys = new Set(batch.map(icaCatalogueQueryKey));
  state.lastAttemptedAt = Date.now();
  await recordIcaCatalogueSearchStates(
    client,
    scope,
    supplierAccountId,
    entriesForQueryKeys(entries, batchKeys),
    "syncing",
    searchDate,
  );

  let normalized: IcaCatalogueRowsOutcome;
  try {
    normalized = await fetchIcaCatalogueRows(client, scope, batch);
  } catch (error) {
    const retryAfterMs = ICA_SYNC_LIMIT_DELAY_MS;
    state.retryAt = Date.now() + retryAfterMs;
    state.phase = "error";
    state.warning =
      "ICA:s sortiment kunde inte hämtas just nu. Scoutmat försöker igen automatiskt.";
    const incompleteKeys = new Set(queries
      .map(icaCatalogueQueryKey)
      .filter((key) => !state!.completedQueryKeys.has(key)));
    await recordIcaCatalogueSearchStates(
      client,
      scope,
      supplierAccountId,
      entriesForQueryKeys(entries, incompleteKeys),
      "error",
      searchDate,
      state.retryAt,
      error instanceof Error ? error.message.slice(0, 500) : "Okänt fel",
    );
    throw error;
  }

  for (const query of normalized.completedQueries) {
    const key = icaCatalogueQueryKey(query);
    state.completedQueryKeys.add(key);
    state.deferredQueryKeys.delete(key);
  }
  // The server permits fixture mode only for a local Supabase URL. Always use
  // the channel from the latest completed batch so turning fixture mode off
  // cannot leave the planner-facing state stuck on old synthetic rows.
  state.syntheticLocalFixture = normalized.syntheticLocalFixture;
  if (normalized.syntheticLocalFixture) {
    state.warning = "Lokalt syntetiskt ICA-sortiment används för denna utvecklingsmiljö.";
  }
  const newlyCompletedKeys = new Set(
    normalized.completedQueries.map(icaCatalogueQueryKey),
  );
  await recordIcaCatalogueSearchStates(
    client,
    scope,
    supplierAccountId,
    entriesForQueryKeys(entries, newlyCompletedKeys),
    "complete",
    searchDate,
  );
  if (!normalized.complete) {
    const firstIncompleteQuery = batch.find((query) =>
      !state!.completedQueryKeys.has(icaCatalogueQueryKey(query))
    );
    if (firstIncompleteQuery) {
      state.deferredQueryKeys.add(icaCatalogueQueryKey(firstIncompleteQuery));
    }
  }

  const completedCount = queries.filter((query) =>
    state!.completedQueryKeys.has(icaCatalogueQueryKey(query))
  ).length;
  if (completedCount === queries.length) {
    state.warning = normalized.syntheticLocalFixture
      ? "Lokalt syntetiskt ICA-sortiment används för denna utvecklingsmiljö."
      : null;
    state.retryAt = 0;
    return {
      warning: state.warning,
      retryAfterMs: null,
      progress: icaSyncProgress(
        queries,
        state.completedQueryKeys,
        "complete",
        null,
        null,
        state.lastAttemptedAt,
        state.syntheticLocalFixture,
      ),
    };
  }

  const retryAfterMs = normalized.complete
    ? normalized.syntheticLocalFixture
      ? 100
      : ICA_SYNC_PROGRESS_DELAY_MS
    : ICA_SYNC_LIMIT_DELAY_MS;
  state.retryAt = Date.now() + retryAfterMs;
  state.phase = normalized.complete ? "syncing" : "rate_limited";
  state.warning = normalized.complete
    ? `Scoutmat hämtar ICA-sortimentet stegvis. ${completedCount} av ${queries.length} råvarusökningar är klara; nästa steg körs automatiskt.`
    : `ICA begränsade kataloghämtningen tillfälligt. ${completedCount} av ${queries.length} råvarusökningar är klara; den blockerade sökningen läggs sist och Scoutmat fortsätter automatiskt om en stund. Endast riktiga artiklar från ICA Kvantum Sickla används.`;
  const incompleteKeys = new Set(queries
    .map(icaCatalogueQueryKey)
    .filter((key) => !state!.completedQueryKeys.has(key)));
  await recordIcaCatalogueSearchStates(
    client,
    scope,
    supplierAccountId,
    entriesForQueryKeys(entries, incompleteKeys),
    normalized.complete ? "syncing" : "retrying",
    searchDate,
    state.retryAt,
  );
  return {
    warning: state.warning,
    retryAfterMs,
    progress: icaSyncProgress(
      queries,
      state.completedQueryKeys,
      state.phase,
      retryAfterMs,
      state.retryAt,
      state.lastAttemptedAt,
      state.syntheticLocalFixture,
    ),
  };
}

export async function ensureSupplierCatalogueMatches(
  scope: SupplierScope,
  supplierAccountId: string,
  items: SupplyItemRow[],
  options: { forceIcaSync?: boolean } = {},
): Promise<{
  generated: boolean;
  warning: string | null;
  retryAfterMs: number | null;
  icaSyncProgress: IcaCatalogueSyncProgress | null;
}> {
  const client = catalogueClient();
  requireOnline();
  const { data: account, error: accountError } = await client
    .from("supplier_accounts")
    .select("*")
    .eq("organization_id", scope.organizationId)
    .eq("id", supplierAccountId)
    .eq("active", true)
    .single();
  if (accountError) throw accountError;

  const icaAccount = isIcaSicklaAccount(account);
  let warning: string | null = null;
  let retryAfterMs: number | null = null;
  let icaProgress: IcaCatalogueSyncProgress | null = null;
  if (icaAccount) {
    try {
      const outcome = await syncIcaCatalogue(
        client,
        scope,
        supplierAccountId,
        items,
        options.forceIcaSync === true,
      );
      warning = outcome.warning;
      retryAfterMs = outcome.retryAfterMs;
      icaProgress = outcome.progress;
    } catch {
      const [existingProducts, persistedStates] = await Promise.all([
        fetchProductsForAccount(client, scope, supplierAccountId),
        fetchIcaCatalogueSearchStates(client, scope, supplierAccountId),
      ]);
      const cachedSource = cachedIcaCatalogueSource(existingProducts);
      const cachedSourceMatchesRuntime = cachedSource !== "mixed"
        && cachedSource !== null
        && cachedSource === ICA_CATALOGUE_RUNTIME_SOURCE;
      warning = cachedSourceMatchesRuntime && cachedSource === "fixture"
        ? "ICA:s sortiment kunde inte uppdateras just nu. Senast hämtade lokala syntetiska fixture-artiklar visas fortfarande."
        : cachedSourceMatchesRuntime && cachedSource === "public"
        ? "ICA:s sortiment kunde inte uppdateras just nu. Senast hämtade riktiga ICA-artiklar används."
        : "ICA:s sortiment kunde inte hämtas just nu. Inga reservartiklar visas; försök igen senare.";
      retryAfterMs = ICA_SYNC_LIMIT_DELAY_MS;
      const entries = buildIcaCatalogueSearchEntries(items);
      const queries = buildIcaCatalogueQueries(items);
      const searchDate = dateInStockholm();
      const completedQueries = completedIcaCatalogueQueriesFromState({
        entries,
        persistedStates,
        searchDate,
        cachedSource,
        runtimeSource: ICA_CATALOGUE_RUNTIME_SOURCE,
      });
      icaProgress = {
        phase: "error",
        completedQueries,
        totalQueries: queries.length,
        retryAfterMs,
        retryAt: Date.now() + retryAfterMs,
        lastAttemptedAt: Date.now(),
        syntheticLocalFixture: ICA_CATALOGUE_RUNTIME_SOURCE === "fixture",
      };
    }
  }

  let stateQuery = client
    .from("supplier_products")
    .select("updated_at", { count: "exact" })
    .eq("organization_id", scope.organizationId)
    .eq("supplier_account_id", supplierAccountId)
    .eq("active", true);
  if (icaAccount) {
    stateQuery = stateQuery
      .eq("product_data_source", "import:api")
      .contains("packaging_metadata", {
        normalization_version: ICA_CATALOGUE_NORMALISATION_VERSION,
      });
  }
  const { data: productState, count, error } = await stateQuery
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw error;

  if ((count ?? 0) === 0) {
    return {
      generated: false,
      warning,
      retryAfterMs,
      icaSyncProgress: icaProgress,
    };
  }

  let calculationRevisionId = "";
  if (scope.campId) {
    const { data: revision, error: revisionError } = await client
      .from("calculation_revisions")
      .select("id")
      .eq("organization_id", scope.organizationId)
      .eq("camp_id", scope.campId)
      .eq("status", "current")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (revisionError) throw revisionError;
    calculationRevisionId = revision?.id ?? "";
  }

  const canonicalSignature = [...new Set(
    items
      .filter((item) => item.source_present)
      .map((item) => [
        item.canonical_key,
        item.required_unit,
        item.category,
        item.comment ?? "",
      ].join(":")),
  )].sort().join("|");
  const signature = [
    scope.organizationId,
    scope.campId ?? "",
    calculationRevisionId,
    supplierAccountId,
    count,
    productState?.[0]?.updated_at ?? "",
    CATALOGUE_MATCHER_VERSION,
    icaProgress?.syntheticLocalFixture ? "fixture" : "public",
    icaProgress?.completedQueries.map(icaCatalogueQueryKey).sort().join(",") ?? "",
    canonicalSignature,
  ].join(":");
  if (automaticMatchSignatures.has(signature)) {
    return {
      generated: false,
      warning,
      retryAfterMs,
      icaSyncProgress: icaProgress,
    };
  }

  automaticMatchSignatures.add(signature);
  try {
    const completedQueryKeys = new Set(
      icaProgress?.completedQueries.map(icaCatalogueQueryKey) ?? [],
    );
    await generateCandidates(
      client,
      scope,
      supplierAccountId,
      items,
      icaAccount
        ? {
            completedEntries: buildIcaCatalogueSearchEntries(items).filter(
              (entry) => completedQueryKeys.has(icaCatalogueQueryKey(entry.query)),
            ),
            searchDate: dateInStockholm(),
            syntheticLocalFixture: icaProgress?.syntheticLocalFixture === true,
          }
        : undefined,
    );
  } catch (error) {
    automaticMatchSignatures.delete(signature);
    throw error;
  }
  return {
    generated: true,
    warning,
    retryAfterMs,
    icaSyncProgress: icaProgress,
  };
}

export async function importSupplierCatalogueAndMatch(
  scope: SupplierScope,
  supplierAccountId: string,
  preview: SupplierCataloguePreview,
  mapping: SupplierCatalogueColumnMapping[],
  items: SupplyItemRow[],
): Promise<SupplierCatalogueImportOutcome> {
  const client = catalogueClient();
  requireOnline();
  const { data: account, error: accountError } = await client
    .from("supplier_accounts")
    .select("*")
    .eq("organization_id", scope.organizationId)
    .eq("id", supplierAccountId)
    .eq("active", true)
    .single();
  if (accountError) throw accountError;
  if (isIcaSicklaAccount(account)) {
    throw new Error(
      "ICA-sortimentet hämtas automatiskt från ICA Kvantum Sickla och kan inte ersättas med en fil.",
    );
  }
  const importableRows = preview.rows.filter((row) => row.status !== "blocked");
  if (!importableRows.length) {
    throw new Error("Katalogen innehåller inga giltiga artiklar att importera.");
  }

  const profileName = `${preview.headerSignature}:${preview.sheetName}`.slice(0, 120);
  const { data: profileId, error: profileError } = await client.rpc(
    "save_supplier_import_column_profile",
    {
      p_organization_id: scope.organizationId,
      p_supplier_account_id: supplierAccountId,
      p_profile_name: profileName,
      p_source_kind: preview.filename.toLocaleLowerCase("sv-SE").endsWith(".csv")
        ? "csv"
        : "xlsx",
      p_column_mapping: json(mapping),
    },
  );
  if (profileError) throw profileError;

  const sourceFingerprint = await supplierCatalogueSourceFingerprint(preview);
  const sourceKind = preview.filename.toLocaleLowerCase("sv-SE").endsWith(".csv")
    ? "csv"
    : "xlsx";
  const { data: importRunId, error: startError } = await client.rpc(
    "start_supplier_import",
    {
      p_organization_id: scope.organizationId,
      p_supplier_account_id: supplierAccountId,
      p_column_profile_id: profileId,
      p_source_name: preview.filename,
      p_source_kind: sourceKind,
      p_source_fingerprint: sourceFingerprint,
    },
  );
  if (startError) throw startError;

  const { data: existingRun, error: runError } = await client
    .from("supplier_import_runs")
    .select("id, status, valid_row_count")
    .eq("organization_id", scope.organizationId)
    .eq("supplier_account_id", supplierAccountId)
    .eq("id", importRunId)
    .single();
  if (runError) throw runError;

  let imported = existingRun.valid_row_count;
  let enrichment = {
    configured: false,
    source: "none" as SupplierCatalogueEnrichmentSource,
    products: [] as SupplierCatalogueEnrichment[],
  };
  if (existingRun.status === "staging") {
    enrichment = await enrichGtins(client, scope, preview);
    const stagedRows = buildStagedSupplierCatalogueRows(preview, enrichment.products);
    for (const batch of chunks(stagedRows, 250)) {
      const { error } = await client.rpc("stage_supplier_import_rows", {
        p_organization_id: scope.organizationId,
        p_supplier_account_id: supplierAccountId,
        p_import_run_id: importRunId,
        p_rows: json(batch),
      });
      if (error) throw error;
    }
    const { data: finalized, error: finalizeError } = await client.rpc(
      "finalize_supplier_import",
      {
        p_organization_id: scope.organizationId,
        p_supplier_account_id: supplierAccountId,
        p_import_run_id: importRunId,
      },
    );
    if (finalizeError) throw finalizeError;
    if (finalized && typeof finalized === "object" && !Array.isArray(finalized)) {
      const importedRows = (finalized as Record<string, Json | undefined>).imported_rows;
      if (typeof importedRows === "number") imported = importedRows;
    }
  }

  const matched = await generateCandidates(client, scope, supplierAccountId, items);
  return {
    imported,
    matched,
    dabasConfigured: enrichment.configured,
    enrichmentSource: enrichment.source,
  };
}

function sanitizedSearchQuery(query: string): string {
  return normalizeCatalogueText(query.replace(/[%_*,()]/g, " ")).slice(0, 120);
}

export async function searchSupplierCatalogueProducts(
  scope: SupplierScope,
  supplierAccountId: string,
  query: string,
): Promise<SupplierProduct[]> {
  const client = catalogueClient();
  requireOnline();
  const search = sanitizedSearchQuery(query);
  if (search.length < 2) return [];

  const { data: account, error: accountError } = await client
    .from("supplier_accounts")
    .select("*")
    .eq("organization_id", scope.organizationId)
    .eq("id", supplierAccountId)
    .eq("active", true)
    .single();
  if (accountError) throw accountError;
  const icaSourceMetadata: Array<Record<string, string | boolean> | null> =
    isIcaSicklaAccount(account)
    ? [{
      source: "ica_public_webshop",
      store_id: ICA_KVANTUM_SICKLA.id,
    }, {
      source: "ica_local_fixture",
      store_id: ICA_KVANTUM_SICKLA.id,
      synthetic_local_fixture: true,
    }]
    : [null];
  const base = (sourceMetadata: Record<string, string | boolean> | null) => {
    let catalogueQuery = client
      .from("supplier_products")
      .select(PRODUCT_COLUMNS)
      .eq("organization_id", scope.organizationId)
      .eq("supplier_account_id", supplierAccountId)
      .eq("active", true);
    if (sourceMetadata) {
      catalogueQuery = catalogueQuery
        .eq("product_data_source", "import:api")
        .contains("source_metadata", sourceMetadata);
    }
    return catalogueQuery;
  };
  const results = await Promise.all(icaSourceMetadata.flatMap((sourceMetadata) => [
    base(sourceMetadata).ilike("normalized_search_name", `%${search}%`).order("id").limit(10),
    base(sourceMetadata).ilike("supplier_article_number", `%${search}%`).order("id").limit(10),
  ]));
  for (const result of results) {
    if (result.error) throw result.error;
  }

  const products = new Map<string, SupplierProduct>();
  for (const result of results) {
    for (const product of result.data ?? []) {
      products.set(product.id, product);
    }
  }
  let visibleProducts = [...products.values()];
  if (isIcaSicklaAccount(account)) {
    const states = await fetchIcaCatalogueSearchStates(
      client,
      scope,
      supplierAccountId,
    );
    const currentSearches = states.filter((state) =>
      state.status === "complete"
      && state.search_date === dateInStockholm()
    );
    visibleProducts = visibleProducts.filter((product) =>
      currentSearches.some((state) =>
        isIcaCatalogueProductForCompletedSearch(
          product,
          state.search_query,
          state.search_date,
        )
      )
    );
  }
  return visibleProducts
    .sort((left, right) =>
      left.supplier_article_number.localeCompare(
        right.supplier_article_number,
        "sv-SE",
        { numeric: true },
      )
    )
    .slice(0, 10);
}

export async function decideSupplierMatchCandidate(
  scope: SupplierScope,
  candidateId: string,
  decision: "accepted" | "rejected",
): Promise<void> {
  const client = catalogueClient();
  requireOnline();
  const { error } = await client.rpc("decide_supplier_match_candidate", {
    p_organization_id: scope.organizationId,
    p_candidate_id: candidateId,
    p_decision: decision,
  });
  if (error) throw error;
}

export async function approveSafeSupplierMatchCandidates(
  scope: SupplierScope,
  supplierAccountId: string,
  candidateIds: string[],
): Promise<void> {
  const client = catalogueClient();
  requireOnline();
  const { error } = await client.rpc("approve_safe_supplier_match_candidates", {
    p_organization_id: scope.organizationId,
    p_supplier_account_id: supplierAccountId,
    p_matcher_version: CATALOGUE_MATCHER_VERSION,
    p_candidate_ids: candidateIds,
  });
  if (error) throw error;
}

function openCandidatePayload(candidate: SupplierMatchCandidate): SupplierMatchCandidatePayload {
  return {
    canonical_key: candidate.canonical_key,
    supplier_product_id: candidate.supplier_product_id,
    status: candidate.status === "safe" ? "safe" : "review",
    score: candidate.score,
    signals: candidate.signals as Record<string, unknown>,
    product_fingerprint: candidate.product_fingerprint,
    required_unit: candidate.required_unit,
    amount_per_purchase_unit: candidate.amount_per_purchase_unit,
    import_run_id: candidate.import_run_id,
  };
}

export async function suggestSupplierCatalogueAlternative(
  scope: SupplierScope,
  account: SupplierAccount,
  item: SupplyItemRow,
  product: SupplierProduct,
): Promise<void> {
  const client = catalogueClient();
  requireOnline();
  if (isIcaSicklaAccount(account)) {
    const searchStates = await fetchIcaCatalogueSearchStates(
      client,
      scope,
      account.id,
    );
    const currentIcaProduct = isIcaSicklaCatalogueProduct(product)
      && searchStates.some((state) =>
        state.status === "complete"
        && state.search_date === dateInStockholm()
        && isIcaCatalogueProductForCompletedSearch(
          product,
          state.search_query,
          state.search_date,
        )
      );
    if (!currentIcaProduct) {
      throw new Error(
        "Endast artiklar från dagens genomförda sökning hos ICA Kvantum Sickla kan väljas.",
      );
    }
  }
  const [offers, openCandidates] = await Promise.all([
    fetchOffersForProducts(client, scope, [product.id]),
    collectPages(async (offset, pageSize) => {
      const { data, error } = await client
        .from("supplier_match_candidates")
        .select("*")
        .eq("organization_id", scope.organizationId)
        .eq("supplier_account_id", account.id)
        .in("status", ["safe", "review"])
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      return data ?? [];
    }, 500),
  ]);
  const offer = offers.find((candidate) => candidate.supplier_product_id === product.id) ?? null;
  const selected = buildManuallySelectedCandidatePayload(
    scope.organizationId,
    account,
    item,
    product,
    offer,
    dateInStockholm(),
  );
  const retained = openCandidates
    .filter((candidate) => candidate.canonical_key !== item.canonical_key)
    .map(openCandidatePayload);
  await replaceCandidates(client, scope, account.id, [...retained, selected]);
}
