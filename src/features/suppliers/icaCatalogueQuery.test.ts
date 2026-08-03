import { describe, expect, it } from "vitest";
import type { SupplyItemRow } from "../supplies/supplyModel";
import {
  automaticIcaSyncSignature,
  buildIcaCatalogueQueries,
  completedIcaCatalogueQueriesFromState,
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
  it("preserves the visible supply order, removes exact duplicates and searches every physical need unit", () => {
    expect(buildIcaCatalogueQueries([
      item("Gurka", "kg"),
      item("isbergssallad", "kg"),
      item("Krossade tomater", "kg"),
      item("krossade TOMATER", "kg"),
      item("Mjölkfritt matfett", "kg"),
      item("Morot", "kg"),
    ])).toEqual([
      "Gurka",
      "isbergssallad",
      "Krossade tomater",
      "Mjölkfritt matfett",
      "Morot",
    ]);
  });

  it("keeps every distinct ingredient when a camp needs more than 80 searches", () => {
    const items = Array.from({ length: 101 }, (_, index) =>
      item(`Råvara ${index + 1}`, "kg")
    );

    expect(buildIcaCatalogueQueries(items)).toHaveLength(101);
  });

  it("resumes at the first query that has not already completed", () => {
    expect(selectNextIcaCatalogueQueryBatch(
      ["Gul lök", "Gurka", "Morot", "Mjölk"],
      ["gul LÖK", "Morot"],
      2,
    )).toEqual(["Gurka", "Mjölk"]);
  });

  it("reuses today's completed local fixture searches after a browser reload", () => {
    expect(completedIcaCatalogueQueriesFromState({
      entries: [
        { canonicalKey: "ingredient:milk", query: "Mjölk" },
        { canonicalKey: "ingredient:bread", query: "Mjukt bröd" },
      ],
      persistedStates: [
        {
          canonical_key: "ingredient:milk",
          search_query: "mjölk",
          search_date: "2026-07-31",
          status: "complete",
        },
        {
          canonical_key: "ingredient:bread",
          search_query: "Mjukt bröd",
          search_date: "2026-07-31",
          status: "complete",
        },
      ],
      searchDate: "2026-07-31",
      cachedSource: "fixture",
      runtimeSource: "fixture",
    })).toEqual(["Mjölk", "Mjukt bröd"]);
  });

  it("refreshes cached fixture provenance when the local fixture runtime is disabled", () => {
    expect(completedIcaCatalogueQueriesFromState({
      entries: [{ canonicalKey: "ingredient:milk", query: "Mjölk" }],
      persistedStates: [{
        canonical_key: "ingredient:milk",
        search_query: "Mjölk",
        search_date: "2026-07-31",
        status: "complete",
      }],
      searchDate: "2026-07-31",
      cachedSource: "fixture",
      runtimeSource: "public",
    })).toEqual([]);
  });

  it("refreshes cached public provenance when the local fixture runtime is enabled", () => {
    expect(completedIcaCatalogueQueriesFromState({
      entries: [{ canonicalKey: "ingredient:milk", query: "Mjölk" }],
      persistedStates: [{
        canonical_key: "ingredient:milk",
        search_query: "Mjölk",
        search_date: "2026-07-31",
        status: "complete",
      }],
      searchDate: "2026-07-31",
      cachedSource: "public",
      runtimeSource: "fixture",
    })).toEqual([]);
  });

  it("reuses today's completed public searches in the public runtime", () => {
    expect(completedIcaCatalogueQueriesFromState({
      entries: [{ canonicalKey: "ingredient:milk", query: "Mjölk" }],
      persistedStates: [{
        canonical_key: "ingredient:milk",
        search_query: "mjölk",
        search_date: "2026-07-31",
        status: "complete",
      }],
      searchDate: "2026-07-31",
      cachedSource: "public",
      runtimeSource: "public",
    })).toEqual(["Mjölk"]);
  });

  it("reuses a completed public no-match search even when no product was cached", () => {
    expect(completedIcaCatalogueQueriesFromState({
      entries: [{ canonicalKey: "ingredient:unknown", query: "Okänd råvara" }],
      persistedStates: [{
        canonical_key: "ingredient:unknown",
        search_query: "Okänd råvara",
        search_date: "2026-07-31",
        status: "complete",
      }],
      searchDate: "2026-07-31",
      cachedSource: null,
      runtimeSource: "public",
    })).toEqual(["Okänd råvara"]);
  });

  it("accepts only today's complete state for the same ingredient and normalised query", () => {
    const entries = [{ canonicalKey: "ingredient:milk", query: "Mjölk" }];
    const base = {
      canonical_key: "ingredient:milk",
      search_query: "mjölk",
      search_date: "2026-07-31",
    } as const;

    for (const persistedState of [
      { ...base, status: "pending" as const },
      { ...base, status: "syncing" as const },
      { ...base, status: "retrying" as const },
      { ...base, status: "error" as const },
      { ...base, status: "complete" as const, search_date: "2026-07-30" },
      { ...base, status: "complete" as const, canonical_key: "ingredient:cream" },
      { ...base, status: "complete" as const, search_query: "Havredryck" },
    ]) {
      expect(completedIcaCatalogueQueriesFromState({
        entries,
        persistedStates: [persistedState],
        searchDate: "2026-07-31",
        cachedSource: "public",
        runtimeSource: "public",
      })).toEqual([]);
    }
  });

  it("keeps automatic ICA sync state separate for each camp", () => {
    const common = {
      userId: "user-1",
      organizationId: "organization-1",
    };

    expect(automaticIcaSyncSignature(
      { ...common, campId: "camp-1" },
      "supplier-account-1",
      "2026-07-31",
      ["Mjölk"],
    )).not.toBe(automaticIcaSyncSignature(
      { ...common, campId: "camp-2" },
      "supplier-account-1",
      "2026-07-31",
      ["Mjölk"],
    ));
  });

  it("moves a temporarily limited query behind the rest of the queue", () => {
    expect(selectNextIcaCatalogueQueryBatch(
      ["Gul lök", "Gurka", "Morot", "Mjölk"],
      ["Gul lök"],
      2,
      ["Gurka"],
    )).toEqual(["Morot", "Mjölk"]);
  });

  it("keeps a batch within the server's combined 600-code-point limit", () => {
    const longQueries = Array.from({ length: 10 }, (_, index) =>
      `${index}`.repeat(80)
    );

    const first = selectNextIcaCatalogueQueryBatch(longQueries, []);
    expect(first).toHaveLength(7);
    expect(first.reduce((sum, query) => sum + Array.from(query).length, 0))
      .toBe(560);
    expect(selectNextIcaCatalogueQueryBatch(longQueries, first))
      .toEqual(longQueries.slice(7));
  });
});
