import type { SupabaseClient } from "@supabase/supabase-js";
import { collectPages } from "../../lib/pagination";
import { supabase } from "../../lib/supabase";
import type { Database, Json, Tables } from "../../types/database";
import type { SupplyItemRow } from "../supplies/supplyModel";
import {
  CATALOGUE_MATCHER_VERSION,
  normalizeCatalogueText,
  normalizeSupplierUnit,
} from "./catalogueMatcher";
import type {
  SupplierCatalogueColumnMapping,
  SupplierCataloguePreview,
} from "./catalogueImportModel";
import {
  buildManuallySelectedCandidatePayload,
  buildStagedSupplierCatalogueRows,
  buildSupplierMatchCandidatePayloads,
  supplierCatalogueApiSourceFingerprint,
  supplierCatalogueSourceFingerprint,
  type SupplierCatalogueEnrichment,
  type SupplierCatalogueEnrichmentSource,
  type SupplierMatchCandidatePayload,
} from "./supplierCatalogueWorkflow";
import {
  normaliseIcaCatalogueResponse,
  type IcaCatalogueNormalisationResult,
} from "./icaCatalogue";
import { fetchIcaCatalogueBatch } from "./icaCatalogueClient";
import {
  ICA_KVANTUM_SICKLA,
  isIcaSicklaAccount,
  isIcaSicklaCatalogueProduct,
} from "./icaStore";
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
  warning: string | null;
}
const automaticIcaSyncStates = new Map<string, AutomaticIcaSyncState>();
const ICA_SEARCH_BATCH_SIZE = 10;
const ICA_MAX_AUTOMATIC_QUERIES = 80;
const ICA_SYNC_PROGRESS_DELAY_MS = 15_000;
const ICA_SYNC_LIMIT_DELAY_MS = 60_000;
const ICA_MATCHABLE_UNITS = new Set([
  "kg",
  "g",
  "mg",
  "hg",
  "l",
  "dl",
  "cl",
  "ml",
  "st",
]);

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

function icaQueryKey(query: string): string {
  return query.normalize("NFKC").trim().toLocaleLowerCase("sv-SE");
}

export function selectNextIcaCatalogueQueryBatch(
  queries: readonly string[],
  completedQueries: readonly string[],
  batchSize = ICA_SEARCH_BATCH_SIZE,
  deferredQueries: readonly string[] = [],
): string[] {
  const completedKeys = new Set(completedQueries.map(icaQueryKey));
  const deferredKeys = new Set(deferredQueries.map(icaQueryKey));
  return queries
    .filter((query) => {
      const key = icaQueryKey(query);
      return !completedKeys.has(key) && !deferredKeys.has(key);
    })
    .slice(0, batchSize);
}

export function buildIcaCatalogueQueries(
  items: readonly SupplyItemRow[],
): string[] {
  const queries = new Map<string, string>();
  for (const item of items) {
    if (
      !item.source_present
      || !ICA_MATCHABLE_UNITS.has(normalizeSupplierUnit(item.required_unit))
    ) {
      continue;
    }
    const query = item.item_name
      .normalize("NFKC")
      .replace(/[\p{Cc}\p{Cf}]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    if (query.length < 2) continue;
    const key = query.toLocaleLowerCase("sv-SE");
    if (!queries.has(key)) queries.set(key, query);
  }
  const ordered = [...queries.values()];
  if (ordered.length > ICA_MAX_AUTOMATIC_QUERIES) {
    throw new Error(
      `Inköpslistan har fler än ${ICA_MAX_AUTOMATIC_QUERIES} råvaror som kan sökas automatiskt hos ICA.`,
    );
  }
  return ordered;
}

interface IcaCatalogueRowsOutcome extends IcaCatalogueNormalisationResult {
  complete: boolean;
  completedQueries: string[];
}

async function fetchIcaCatalogueRows(
  client: SupabaseClient<Database>,
  scope: SupplierScope,
  queries: readonly string[],
): Promise<IcaCatalogueRowsOutcome> {
  if (!queries.length) {
    return {
      rows: [],
      rejectedProducts: [],
      duplicateCount: 0,
      complete: true,
      completedQueries: [],
    };
  }

  const products: unknown[] = [];
  const completedQueries: string[] = [];
  let complete = true;
  for (const batch of chunks(queries, ICA_SEARCH_BATCH_SIZE)) {
    const data = await fetchIcaCatalogueBatch(
      client,
      scope.organizationId,
      ICA_KVANTUM_SICKLA.id,
      batch,
    );
    products.push(...data.products);
    completedQueries.push(...data.source.searches.map((search) => search.query));
    if (!data.source.complete) {
      complete = false;
      break;
    }
  }

  return {
    ...normaliseIcaCatalogueResponse({
    productGroups: [{ decoratedProducts: products }],
    }, {
      storeId: ICA_KVANTUM_SICKLA.id,
      completedQueries,
    }),
    complete,
    completedQueries,
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
): Promise<number> {
  const canonicalKeys = [...new Set(
    items.filter((item) => item.source_present).map((item) => item.canonical_key),
  )];
  const accountResult = await client
    .from("supplier_accounts")
    .select("*")
    .eq("organization_id", scope.organizationId)
    .eq("id", supplierAccountId)
    .eq("active", true)
    .single();
  if (accountResult.error) throw accountResult.error;
  const account = accountResult.data;
  const [allProducts, approvedMatches, rejectedFingerprints] =
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
    ]);
  const products = isIcaSicklaAccount(account)
    ? allProducts.filter(isIcaSicklaCatalogueProduct)
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
  const candidates = buildSupplierMatchCandidatePayloads({
    organizationId: scope.organizationId,
    supplierAccountId,
    items,
    accounts: [account],
    products,
    offers,
    approvedMatches: currentApprovedMatches,
    rejectedFingerprintsByCanonicalKey: rejectedFingerprints,
    asOfDate: dateInStockholm(),
  });
  return replaceCandidates(client, scope, supplierAccountId, candidates);
}

async function publishIcaCatalogueRows(
  client: SupabaseClient<Database>,
  scope: SupplierScope,
  supplierAccountId: string,
  rows: Awaited<ReturnType<typeof fetchIcaCatalogueRows>>["rows"],
): Promise<{ importRunId: string; imported: number }> {
  if (!rows.length) {
    throw new Error(
      "ICA-katalogen gav inga artiklar med en verifierbar fast förpackningsstorlek.",
    );
  }
  const sourceFingerprint = await supplierCatalogueApiSourceFingerprint(
    "ica-public-webshop-v1",
    ICA_KVANTUM_SICKLA.id,
    rows,
  );
  const { data: importRunId, error: startError } = await client.rpc(
    "start_supplier_import",
    {
      p_organization_id: scope.organizationId,
      p_supplier_account_id: supplierAccountId,
      p_column_profile_id: null,
      p_source_name: `ica-kvantum-sickla-${ICA_KVANTUM_SICKLA.id}`,
      p_source_kind: "api",
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
  if (existingRun.status === "staging") {
    const numberedRows = rows.map((row, index) => ({
      ...row,
      source_row: index + 1,
      raw_data: {
        ...row.raw_data,
        source_row: index + 1,
      },
    }));
    for (const batch of chunks(numberedRows, 250)) {
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
  return { importRunId, imported };
}

function completedIcaQueriesFromProducts(
  products: readonly SupplierProduct[],
  expectedQueries: readonly string[],
): string[] {
  const expectedByKey = new Map(
    expectedQueries.map((query) => [icaQueryKey(query), query]),
  );
  const completed = new Map<string, string>();
  for (const product of products) {
    const metadata = product.source_metadata;
    if (
      !metadata
      || typeof metadata !== "object"
      || Array.isArray(metadata)
    ) {
      continue;
    }
    const searches = (
      metadata as Record<string, Json | undefined>
    ).ica_completed_searches;
    if (!Array.isArray(searches)) continue;
    for (const search of searches) {
      if (typeof search !== "string") continue;
      const key = icaQueryKey(search);
      const expected = expectedByKey.get(key);
      if (expected) completed.set(key, expected);
    }
  }
  return [...completed.values()];
}

interface IcaCatalogueSyncOutcome {
  warning: string | null;
  retryAfterMs: number | null;
}

async function syncIcaCatalogue(
  client: SupabaseClient<Database>,
  scope: SupplierScope,
  supplierAccountId: string,
  items: SupplyItemRow[],
): Promise<IcaCatalogueSyncOutcome> {
  const queries = buildIcaCatalogueQueries(items);
  if (!queries.length) return { warning: null, retryAfterMs: null };
  const signature = [
    scope.organizationId,
    supplierAccountId,
    dateInStockholm(),
    queries.join("\u001f"),
  ].join(":");
  let state = automaticIcaSyncStates.get(signature);
  if (!state) {
    const existingProducts = await fetchProductsForAccount(
      client,
      scope,
      supplierAccountId,
    );
    state = {
      completedQueryKeys: new Set(
        completedIcaQueriesFromProducts(
          existingProducts.filter(isIcaSicklaCatalogueProduct),
          queries,
        ).map(icaQueryKey),
      ),
      deferredQueryKeys: new Set(),
      retryAt: 0,
      warning: null,
    };
    automaticIcaSyncStates.set(signature, state);
  }

  const now = Date.now();
  if (state.retryAt > now) {
    return {
      warning: state.warning,
      retryAfterMs: Math.max(1_000, state.retryAt - now),
    };
  }

  const completedQueries = queries.filter((query) =>
    state!.completedQueryKeys.has(icaQueryKey(query))
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
    state.warning = null;
    state.retryAt = 0;
    return { warning: null, retryAfterMs: null };
  }

  const normalized = await fetchIcaCatalogueRows(client, scope, batch);
  if (normalized.rows.length) {
    await publishIcaCatalogueRows(
      client,
      scope,
      supplierAccountId,
      normalized.rows,
    );
  }
  for (const query of normalized.completedQueries) {
    const key = icaQueryKey(query);
    state.completedQueryKeys.add(key);
    state.deferredQueryKeys.delete(key);
  }
  if (!normalized.complete) {
    const firstIncompleteQuery = batch.find((query) =>
      !state!.completedQueryKeys.has(icaQueryKey(query))
    );
    if (firstIncompleteQuery) {
      state.deferredQueryKeys.add(icaQueryKey(firstIncompleteQuery));
    }
  }

  const completedCount = queries.filter((query) =>
    state!.completedQueryKeys.has(icaQueryKey(query))
  ).length;
  if (completedCount === queries.length) {
    state.warning = null;
    state.retryAt = 0;
    return { warning: null, retryAfterMs: null };
  }

  const retryAfterMs = normalized.complete
    ? ICA_SYNC_PROGRESS_DELAY_MS
    : ICA_SYNC_LIMIT_DELAY_MS;
  state.retryAt = Date.now() + retryAfterMs;
  state.warning = normalized.complete
    ? `Scoutmat hämtar ICA-sortimentet stegvis. ${completedCount} av ${queries.length} råvarusökningar är klara; nästa steg körs automatiskt.`
    : `ICA begränsade kataloghämtningen tillfälligt. ${completedCount} av ${queries.length} råvarusökningar är klara; den blockerade sökningen läggs sist och Scoutmat fortsätter automatiskt om en stund. Endast riktiga artiklar från ICA Kvantum Sickla används.`;
  return { warning: state.warning, retryAfterMs };
}

export async function ensureSupplierCatalogueMatches(
  scope: SupplierScope,
  supplierAccountId: string,
  items: SupplyItemRow[],
): Promise<{
  generated: boolean;
  warning: string | null;
  retryAfterMs: number | null;
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
  if (icaAccount) {
    try {
      const outcome = await syncIcaCatalogue(
        client,
        scope,
        supplierAccountId,
        items,
      );
      warning = outcome.warning;
      retryAfterMs = outcome.retryAfterMs;
    } catch {
      const existingProducts = await fetchProductsForAccount(
        client,
        scope,
        supplierAccountId,
      );
      warning = existingProducts.some(isIcaSicklaCatalogueProduct)
        ? "ICA:s sortiment kunde inte uppdateras just nu. Senast hämtade riktiga ICA-artiklar används."
        : "ICA:s sortiment kunde inte hämtas just nu. Inga reservartiklar visas; försök igen senare.";
      retryAfterMs = ICA_SYNC_LIMIT_DELAY_MS;
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
      .contains("source_metadata", {
        source: "ica_public_webshop",
        store_id: ICA_KVANTUM_SICKLA.id,
      });
  }
  const { data: productState, count, error } = await stateQuery
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw error;

  if ((count ?? 0) === 0) {
    return { generated: false, warning, retryAfterMs };
  }

  const canonicalSignature = [...new Set(
    items
      .filter((item) => item.source_present)
      .map((item) => `${item.canonical_key}:${item.required_unit}`),
  )].sort().join("|");
  const signature = [
    scope.organizationId,
    supplierAccountId,
    count,
    productState?.[0]?.updated_at ?? "",
    CATALOGUE_MATCHER_VERSION,
    canonicalSignature,
  ].join(":");
  if (automaticMatchSignatures.has(signature)) {
    return { generated: false, warning, retryAfterMs };
  }

  automaticMatchSignatures.add(signature);
  try {
    await generateCandidates(client, scope, supplierAccountId, items);
  } catch (error) {
    automaticMatchSignatures.delete(signature);
    throw error;
  }
  return { generated: true, warning, retryAfterMs };
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
  const base = () => {
    let catalogueQuery = client
      .from("supplier_products")
      .select(PRODUCT_COLUMNS)
      .eq("organization_id", scope.organizationId)
      .eq("supplier_account_id", supplierAccountId)
      .eq("active", true);
    if (isIcaSicklaAccount(account)) {
      catalogueQuery = catalogueQuery
        .eq("product_data_source", "import:api")
        .contains("source_metadata", {
          source: "ica_public_webshop",
          store_id: ICA_KVANTUM_SICKLA.id,
        });
    }
    return catalogueQuery;
  };
  const [nameResult, articleResult] = await Promise.all([
    base().ilike("normalized_search_name", `%${search}%`).order("id").limit(10),
    base().ilike("supplier_article_number", `%${search}%`).order("id").limit(10),
  ]);
  if (nameResult.error) throw nameResult.error;
  if (articleResult.error) throw articleResult.error;

  const products = new Map<string, SupplierProduct>();
  for (const product of [...(articleResult.data ?? []), ...(nameResult.data ?? [])]) {
    products.set(product.id, product);
  }
  return [...products.values()]
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
  if (isIcaSicklaAccount(account) && !isIcaSicklaCatalogueProduct(product)) {
    throw new Error("Endast artiklar hämtade från ICA Kvantum Sickla kan väljas.");
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
