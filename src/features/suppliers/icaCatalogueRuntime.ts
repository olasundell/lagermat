export type IcaCatalogueRuntimeSource = "fixture" | "public";

/**
 * The synthetic source is available only through the explicit local launcher.
 * `DEV` makes an accidentally configured hosted VITE variable fail closed.
 */
export const ICA_CATALOGUE_RUNTIME_SOURCE: IcaCatalogueRuntimeSource =
  import.meta.env.DEV
  && import.meta.env.VITE_LOCAL_ICA_CATALOGUE_FIXTURE === "true"
    ? "fixture"
    : "public";
