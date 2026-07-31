import { describe, expect, it } from "vitest";
import type { SupplyListRow } from "./supplyModel";
import { createPrintableSupplyHtml, createSupplyCsv, createSupplyExportDocument } from "./exportModel";

const list: SupplyListRow = {
  id: "list-1",
  list_key: "purchase",
  kind: "purchase",
  status: "active",
  title: "Hela lägret",
  range_start: null,
  range_end: null,
  version: 1,
  source_present: true,
  calculation_revisions: { revision_number: 7, status: "current" },
  supply_list_items: [{
    id: "item-1",
    item_key: "aubergine",
    canonical_key: "ingredient:aubergine",
    category: "Grönt",
    item_name: "Aubergine",
    required_amount: 5.7,
    required_unit: "st",
    ordered_amount: 6,
    ordered_unit: "kg",
    package_note: "2 lådor",
    comment: "Kontrollväg",
    completed: false,
    row_version: 1,
    source_present: true,
    manually_moved: false
  }]
};

describe("supply export", () => {
  const document = createSupplyExportDocument({
    list,
    organizationName: "Björkstad scoutkår",
    campName: "Sommarläger 2026",
    timeZone: "Europe/Stockholm",
    readiness: { canFinalize: false, problems: ["1 specialkostuppgift återstår"] },
    generatedAt: new Date("2026-07-19T12:34:00Z")
  });

  it("skriver praktisk mängd och separat exakt decimal med tydlig varningsstatus", () => {
    const csv = createSupplyCsv(document);
    expect(csv).toContain('"Praktiskt behov"');
    expect(csv).toContain('"Exakt beräkning"');
    expect(csv).toContain('"Aubergine";"6";"st";"5.7";"st"');
    expect(csv).toContain('"5.7"');
    expect(csv).toContain('"UNDERLAG MED VARNINGAR"');
    expect(csv).toContain('"1 specialkostuppgift återstår"');
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("bygger ett A4-underlag med repeterad tabellrubrik och säkerhetsproblem", () => {
    const html = createPrintableSupplyHtml(document);
    expect(html).toContain("@page { size: A4 portrait");
    expect(html).toContain("thead { display: table-header-group; }");
    expect(html).toContain("UNDERLAG MED VARNINGAR – kontrollera före användning");
    expect(html).toContain("Aubergine");
    expect(html).toContain(">6 st<");
    expect(html).not.toContain(">5,7 st<");
  });

  it("skiljer leveransdatum från tiden då underlaget skapades", () => {
    const deliveryDocument = createSupplyExportDocument({
      list: { ...list, kind: "delivery", title: "Första leveransen", range_start: null },
      organizationName: "Björkstad scoutkår",
      campName: "Sommarläger 2026",
      timeZone: "Europe/Stockholm",
      readiness: { canFinalize: true, problems: [] },
      generatedAt: new Date("2026-07-19T12:34:00Z")
    });

    const html = createPrintableSupplyHtml(deliveryDocument);
    expect(html).toContain("Leveransdatum saknas");
    expect(html).toContain("Skapad: 19 juli 2026 14:34");
  });

  it("uses the same practical amounts in distribution CSV and print", () => {
    const distributionDocument = createSupplyExportDocument({
      list: {
        ...list,
        kind: "distribution",
        title: "Frukost · Matlag Elden",
        supply_list_items: [
          {
            ...list.supply_list_items[0]!,
            id: "milk",
            item_name: "Mjölk",
            required_amount: 1.925,
            required_unit: "l",
          },
          {
            ...list.supply_list_items[0]!,
            id: "cheese",
            item_name: "Ost",
            required_amount: 7.7,
            required_unit: "skivor",
          },
          {
            ...list.supply_list_items[0]!,
            id: "fat",
            item_name: "Mjölkfritt matfett",
            required_amount: 0.00225,
            required_unit: "kg",
          },
        ],
      },
      organizationName: "Björkstad scoutkår",
      campName: "Sommarläger 2026",
      timeZone: "Europe/Stockholm",
      readiness: { canFinalize: true, problems: [] },
      generatedAt: new Date("2026-07-19T12:34:00Z"),
    });

    const csv = createSupplyCsv(distributionDocument);
    const html = createPrintableSupplyHtml(distributionDocument);

    expect(csv).toContain('"Mjölk";"2";"l"');
    expect(csv).toContain('"Ost";"8";"skivor"');
    expect(csv).toContain('"Mjölkfritt matfett";"10";"g";"0.00225";"kg"');
    expect(csv).toContain('"Mjölk";"2";"l";"1.925";"l"');
    expect(html).toContain("Varje matlag får en praktiskt avrundad mängd");
    expect(html).toContain(">2 l<");
    expect(html).toContain(">8 skivor<");
    expect(html).toContain(">10 g<");
    expect(html).not.toContain(">1,925 l<");
  });
});
