import {
  buildSupplierCataloguePreview,
  detectSupplierCatalogueTable,
  suggestedSupplierCatalogueMapping,
} from "./catalogueImportModel";

export const demoSupplierCatalogueSheets = [
  {
    name: "Läs mig",
    rows: [
      ["Demokatalog för leverantörsimport"],
      ["Använd bladet Sortiment för import."],
    ],
  },
  {
    name: "Sortiment",
    rows: [
      ["Demodata – inga order skickas"],
      [
        "Artikelnummer",
        "Artikelbenämning",
        "Beställningsenhet",
        "Total mängd/enhet",
        "GTIN",
        "Kundpris",
        "Minsta beställning",
        "Gäller från",
        "Gäller till",
        "Kategori",
        "Varumärke",
        "Viktvara",
      ],
      [
        "MS-168278",
        "Gräddfil 3 dl",
        "kolli",
        "3,6 l",
        "07310865004703",
        "109,50",
        "1",
        "2026-08-01",
        "2026-12-31",
        "Mejeri",
        "Arla",
        "Nej",
      ],
      [
        "MEN-9001",
        "Havregryn eko 10 kg",
        "säck",
        "10 kg",
        "",
        "119,90",
        "1",
        "2026-08-01",
        "",
        "Skafferi",
        "Demo",
        "Nej",
      ],
      [
        "ICA-42",
        "Havregryn",
        "kartong",
        "sex kg",
        "07350000000003",
        "89,90",
        "1",
        "2026-08-01",
        "2026-12-31",
        "Skafferi",
        "Demo",
        "Nej",
      ],
    ],
  },
] satisfies Array<{ name: string; rows: unknown[][] }>;

export const demoSupplierCatalogueTable = detectSupplierCatalogueTable(
  "demo-leverantorskatalog.xlsx",
  demoSupplierCatalogueSheets,
);

export const demoSupplierCataloguePreview = buildSupplierCataloguePreview(
  demoSupplierCatalogueTable,
  suggestedSupplierCatalogueMapping(demoSupplierCatalogueTable),
);
