import { describe, expect, it } from "vitest";
import type { SupplyItemRow } from "../supplies/supplyModel";
import {
  buildIcaCatalogueQueries,
  selectNextIcaCatalogueQueryBatch,
} from "./supplierCatalogueApi";

function item(
  name: string,
  unit: string,
  overrides: Partial<SupplyItemRow> = {},
): SupplyItemRow {
  return {
    id: `item:${name}:${unit}`,
    item_key: `purchase:${name}:${unit}`,
    canonical_key: `ingredient:${name}:${unit}`,
    category: "Test",
    item_name: name,
    required_amount: 1,
    required_unit: unit,
    ordered_amount: null,
    ordered_unit: null,
    package_note: null,
    comment: null,
    completed: false,
    row_version: 1,
    source_present: true,
    manually_moved: false,
    ...overrides,
  };
}

describe("ICA catalogue query planning", () => {
  it("preserves the visible supply order and removes only exact duplicate searches", () => {
    expect(buildIcaCatalogueQueries([
      item("Gurka", "kg"),
      item("isbergssallad", "kg"),
      item("Krossade tomater", "kg"),
      item("krossade TOMATER", "kg"),
      item("Mjölkfritt matfett", "paket"),
      item("Morot", "kg"),
    ])).toEqual([
      "Gurka",
      "isbergssallad",
      "Krossade tomater",
      "Morot",
    ]);
  });

  it("resumes at the first query that has not already completed", () => {
    expect(selectNextIcaCatalogueQueryBatch(
      ["Gul lök", "Gurka", "Morot", "Mjölk"],
      ["gul LÖK", "Morot"],
      2,
    )).toEqual(["Gurka", "Mjölk"]);
  });

  it("moves a temporarily limited query behind the rest of the queue", () => {
    expect(selectNextIcaCatalogueQueryBatch(
      ["Gul lök", "Gurka", "Morot", "Mjölk"],
      ["Gul lök"],
      2,
      ["Gurka"],
    )).toEqual(["Morot", "Mjölk"]);
  });
});
