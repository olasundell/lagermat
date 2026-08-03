import type { SupplierAccount, SupplierProduct } from "./supplierModel";

export const ICA_CATALOGUE_NORMALISATION_VERSION =
  "ica-public-catalogue-v2";
export const LOCAL_ICA_FIXTURE_WARNING =
  "LOKAL SYNTETISK TESTARTIKEL – INTE BUTIKSDATA";

export const ICA_KVANTUM_SICKLA = {
  id: "1004021",
  name: "ICA Kvantum Sickla",
  address: "Siroccogatan 4, Nacka",
  storeUrl:
    "https://www.ica.se/butiker/kvantum/nacka/ica-kvantum-sickla-1004021/",
  shopUrl: "https://handlaprivatkund.ica.se/stores/1004021",
} as const;

export function isIcaSicklaAccount(account: SupplierAccount | null | undefined): boolean {
  return account?.provider_key === "ica"
    && account.provider_location_id === ICA_KVANTUM_SICKLA.id;
}

export function isIcaSicklaCatalogueProduct(product: SupplierProduct): boolean {
  const metadata = product.source_metadata;
  const allowedSource = metadata !== null
    && typeof metadata === "object"
    && !Array.isArray(metadata)
    && (
      metadata.source === "ica_public_webshop"
      || (
        metadata.source === "ica_local_fixture"
        && metadata.synthetic_local_fixture === true
      )
    );
  return product.product_data_source === "import:api"
    && allowedSource
    && metadata.store_id === ICA_KVANTUM_SICKLA.id;
}

export function isLocalIcaFixtureProduct(product: SupplierProduct): boolean {
  const metadata = product.source_metadata;
  return isIcaSicklaCatalogueProduct(product)
    && metadata !== null
    && typeof metadata === "object"
    && !Array.isArray(metadata)
    && metadata.source === "ica_local_fixture"
    && metadata.synthetic_local_fixture === true;
}

function queryKey(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .toLocaleLowerCase("sv-SE");
}

function stockholmDate(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

/**
 * Accept an ICA article only when the current camp search actually returned it.
 * This prevents an old fixture or a failed/stale webshop search from silently
 * becoming a new match.
 */
export function isIcaCatalogueProductForCompletedSearch(
  product: SupplierProduct,
  query: string,
  searchDate: string,
  syntheticLocalFixture?: boolean,
): boolean {
  if (!isIcaSicklaCatalogueProduct(product)) return false;
  if (stockholmDate(product.source_updated_at) !== searchDate) return false;
  if (
    syntheticLocalFixture !== undefined
    && isLocalIcaFixtureProduct(product) !== syntheticLocalFixture
  ) {
    return false;
  }

  const metadata = product.source_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  const matches = metadata.ica_search_matches;
  if (!Array.isArray(matches)) return false;
  const expected = queryKey(query);
  return expected.length >= 2 && matches.some((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return typeof value.query === "string" && queryKey(value.query) === expected;
  });
}
