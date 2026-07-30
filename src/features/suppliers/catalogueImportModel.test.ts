import { describe, expect, it } from "vitest";
import {
  buildSupplierCataloguePreview,
  detectSupplierCatalogueTable,
  suggestedSupplierCatalogueMapping,
  validateSupplierCatalogueMapping,
} from "./catalogueImportModel";
import { demoSupplierCataloguePreview } from "./demoSupplierCatalogue";

const headers = [
  "Art.nr",
  "Produktnamn",
  "Beställningsenhet",
  "Total mängd/enhet",
  "EAN",
  "Kundpris",
  "Minsta antal",
  "Giltig från",
  "Giltig till",
  "Varugrupp",
  "Varumärke",
  "Viktvara",
];

function tableWithRows(rows: unknown[][]) {
  return detectSupplierCatalogueTable("sortiment.csv", [{
    name: "Prislista",
    rows: [headers, ...rows],
  }]);
}

describe("leverantörsneutral katalogimport", () => {
  it("hittar rätt blad och rubrikrad samt skapar en stabil rubriksignatur", () => {
    const sheets = [
      {
        name: "Information",
        rows: [["Prislista 2026"], ["Kontakta grossisten vid frågor"]],
      },
      {
        name: "Produktsortiment",
        rows: [
          ["Kundnummer", "12345"],
          ["Gäller från", "2026-08-01"],
          headers,
          ["A-1", "Ris", "kolli", "3 kg", "07310865004703"],
        ],
      },
    ];

    const first = detectSupplierCatalogueTable("grossist.xlsx", sheets);
    const second = detectSupplierCatalogueTable("grossist.xlsx", sheets);
    const mapping = suggestedSupplierCatalogueMapping(first);

    expect(first).toMatchObject({
      sheetName: "Produktsortiment",
      headerRowIndex: 2,
      rowNumbers: [4],
    });
    expect(first.headerSignature).toBe(second.headerSignature);
    expect(first.headerSignature).toMatch(/^supplier-catalogue-header-v1-[0-9a-f]{16}$/);
    expect(mapping.find((column) => column.source === "Art.nr")?.target)
      .toBe("supplier_article_number");
    expect(mapping.find((column) => column.source === "Total mängd/enhet")?.target)
      .toBe("total_quantity");
    expect(mapping.find((column) => column.source === "EAN")?.target).toBe("gtin");
  });

  it("förklarar vilka obligatoriska kolumnkopplingar som saknas", () => {
    const table = tableWithRows([
      ["A-1", "Ris", "kolli", "3 kg", "07310865004703"],
    ]);
    const mapping = suggestedSupplierCatalogueMapping(table).map((column) =>
      column.target === "purchase_unit" || column.target === "total_quantity"
        ? { ...column, target: "ignore" as const }
        : column
    );

    expect(validateSupplierCatalogueMapping(mapping)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_mapping",
          message: "Koppla en kolumn till Beställningsenhet.",
        }),
        expect.objectContaining({
          code: "missing_mapping",
          message: "Koppla antingen Total mängd/enhet eller både Total mängd och Mängdenhet.",
        }),
      ]),
    );
  });

  it("läser svenska decimaler, multiplikation, datum och valfria handelsfält", () => {
    const preview = buildSupplierCataloguePreview(tableWithRows([
      [
        "A-1",
        "Krossade tomater",
        "kolli",
        "3 x 2,5 kg",
        "07310865004703",
        "1.234,50 kr",
        "2",
        "01/08/2026",
        "31/12/2026",
        "Konserver",
        "Demo",
        "Nej",
      ],
    ]));

    expect(preview.mappingIssues).toEqual([]);
    expect(preview.rows[0]).toMatchObject({
      status: "safe",
      supplierArticleNumber: "A-1",
      totalAmount: 7.5,
      totalUnit: "kg",
      gtin: "07310865004703",
      price: 1234.5,
      minimumOrderUnits: 2,
      validFrom: "2026-08-01",
      validTo: "2026-12-31",
      category: "Konserver",
      brand: "Demo",
      catchWeight: false,
      issues: [],
    });
  });

  it("klassar demoartiklar som säkra, tvetydiga respektive blockerade", () => {
    expect(demoSupplierCataloguePreview.mappingIssues).toEqual([]);
    expect(demoSupplierCataloguePreview.rows.map((row) => row.status))
      .toEqual(["safe", "ambiguous", "blocked", "safe"]);
    expect(demoSupplierCataloguePreview).toMatchObject({
      safeCount: 2,
      ambiguousCount: 1,
      blockedCount: 1,
    });
    expect(demoSupplierCataloguePreview.rows[1]?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_gtin", severity: "warning" }),
      ]),
    );
    expect(demoSupplierCataloguePreview.rows[2]?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_total_quantity",
          severity: "error",
        }),
      ]),
    );
    expect(demoSupplierCataloguePreview.rows[3]).toMatchObject({
      displayName: "Krossade tomater",
      totalAmount: 2.4,
      totalUnit: "kg",
      innerUnitCount: 6,
      innerUnitLabel: "burkar",
    });
  });

  it("ger semantiskt likvärdiga rader samma fingerprint", () => {
    const first = buildSupplierCataloguePreview(tableWithRows([
      [
        " A-1 ",
        "Ris",
        "KOLLI",
        "3,0 kg",
        "07 310865 004703",
        "99,00",
        "1",
        "",
        "",
        "Skafferi",
        "Demo",
        "Nej",
      ],
    ]));
    const second = buildSupplierCataloguePreview(tableWithRows([
      [
        "a-1",
        " ris ",
        "kolli",
        "3 kg",
        "07310865004703",
        "99",
        "1,0",
        "",
        "",
        "skafferi",
        "demo",
        "nej",
      ],
    ]));

    expect(first.rows[0]?.rowFingerprint).toBe(second.rows[0]?.rowFingerprint);
    expect(first.rows[0]?.rowFingerprint)
      .toMatch(/^supplier-catalogue-row-v1-[0-9a-f]{16}$/);
  });

  it("blockerar motstridiga dubbletter och varnar för delat GTIN", () => {
    const preview = buildSupplierCataloguePreview(tableWithRows([
      ["A-1", "Ris 3 kg", "kolli", "3 kg", "07310865004703"],
      ["A-1", "Ris 5 kg", "kolli", "5 kg", "07310865004703"],
      ["B-2", "Annat ris", "kolli", "3 kg", "07310865004703"],
    ]));

    expect(preview.rows.slice(0, 2).every((row) => row.status === "blocked")).toBe(true);
    expect(preview.rows[0]?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate_article_number", severity: "error" }),
      expect.objectContaining({ code: "duplicate_gtin", severity: "warning" }),
    ]));
    expect(preview.rows[2]).toMatchObject({ status: "ambiguous" });
    expect(preview.rows[2]?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate_gtin", severity: "warning" }),
    ]));
  });

  it("behåller radidentiteter unika men känner igen exakta dubbletter", () => {
    const duplicate = [
      "A-1",
      "Ris 3 kg",
      "kolli",
      "3 kg",
      "07310865004703",
      "99,00",
      "1",
      "",
      "",
      "Skafferi",
      "Demo",
      "Nej",
    ];
    const preview = buildSupplierCataloguePreview(tableWithRows([
      duplicate,
      [...duplicate],
    ]));

    expect(new Set(preview.rows.map((row) => row.id)).size).toBe(2);
    expect(new Set(preview.rows.map((row) => row.rowFingerprint)).size).toBe(1);
    expect(preview.rows.every((row) => row.status === "ambiguous")).toBe(true);
    expect(preview.rows.every((row) =>
      row.issues.filter((candidate) => candidate.code === "duplicate_row").length === 1
    )).toBe(true);
  });

  it.each([
    {
      label: "ogiltig GTIN-kontrollsiffra",
      row: ["A-1", "Ris", "kolli", "3 kg", "07310865004704"],
      code: "invalid_gtin",
    },
    {
      label: "negativt pris",
      row: ["A-1", "Ris", "kolli", "3 kg", "07310865004703", "-1,50"],
      code: "invalid_price",
    },
    {
      label: "decimal minimiorder",
      row: ["A-1", "Ris", "kolli", "3 kg", "07310865004703", "10", "1,5"],
      code: "invalid_minimum_order",
    },
    {
      label: "omvänd giltighetsperiod",
      row: [
        "A-1",
        "Ris",
        "kolli",
        "3 kg",
        "07310865004703",
        "10",
        "1",
        "2026-12-31",
        "2026-08-01",
      ],
      code: "invalid_validity_period",
    },
  ])("visar ett begripligt blockerande fel för $label", ({ row, code }) => {
    const preview = buildSupplierCataloguePreview(tableWithRows([row]));

    expect(preview.rows[0]).toMatchObject({ status: "blocked" });
    expect(preview.rows[0]?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code, severity: "error" }),
    ]));
  });
});
