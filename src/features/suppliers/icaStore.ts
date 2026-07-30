import type { SupplierAccount, SupplierProduct } from "./supplierModel";

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
  return product.product_data_source === "import:api"
    && metadata !== null
    && typeof metadata === "object"
    && !Array.isArray(metadata)
    && metadata.source === "ica_public_webshop"
    && metadata.store_id === ICA_KVANTUM_SICKLA.id;
}
