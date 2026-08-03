import { describe, expect, it } from "vitest";
import type { SupplyItemRow } from "../supplies/supplyModel";
import {
  countDistinctIcaCatalogueQueries,
  splitIcaUnmatchedItems,
  type IcaCatalogueSyncProgress,
} from "./icaCatalogueSyncModel";

function item(name: string): SupplyItemRow {
  return {
    id: `item:${name}`,
    item_key: `purchase:${name}`,
    canonical_key: `ingredient:${name}`,
    category: "Test",
    item_name: name,
    required_amount: 1,
    required_unit: "kg",
    ordered_amount: null,
    ordered_unit: null,
    package_note: null,
    comment: null,
    completed: false,
    row_version: 1,
    source_present: true,
    manually_moved: false,
  };
}

function progress(
  overrides: Partial<IcaCatalogueSyncProgress> = {},
): IcaCatalogueSyncProgress {
  return {
    phase: "syncing",
    completedQueries: [],
    totalQueries: 3,
    retryAfterMs: 15_000,
    retryAt: Date.now() + 15_000,
    lastAttemptedAt: Date.now(),
    ...overrides,
  };
}

describe("ICA catalogue sync status", () => {
  it("counts queries with the same sanitising rules as the catalogue request", () => {
    expect(countDistinctIcaCatalogueQueries([
      item("  Krossade\u0000   tomater  "),
      item("krossade tomater"),
      item("x"),
    ])).toBe(1);
  });

  it("separates completed searches without a match from searches still running", () => {
    const result = splitIcaUnmatchedItems([
      item("Havregryn"),
      item("Äppelmos"),
      item("Tacosalsa"),
    ], progress({
      completedQueries: ["äppelMOS"],
    }), false);

    expect(result.noMatch.map((candidate) => candidate.item_name))
      .toEqual(["Äppelmos"]);
    expect(result.pending.map((candidate) => candidate.item_name))
      .toEqual(["Havregryn", "Tacosalsa"]);
  });

  it("classifies every remaining ingredient as no match only when sync is complete", () => {
    const result = splitIcaUnmatchedItems([
      item("Havregryn"),
      item("Äppelmos"),
    ], progress({
      phase: "complete",
      completedQueries: ["Havregryn", "Äppelmos"],
      retryAfterMs: null,
    }), false);

    expect(result.pending).toEqual([]);
    expect(result.noMatch).toHaveLength(2);
  });

  it("does not flash false no-match rows while initial ICA status is loading", () => {
    const result = splitIcaUnmatchedItems([
      item("Havregryn"),
    ], null, true);

    expect(result.pending).toHaveLength(1);
    expect(result.noMatch).toEqual([]);
  });

  it("keeps a failed ICA fetch distinct from a search that is still progressing", () => {
    const result = splitIcaUnmatchedItems([
      item("Mjölk"),
    ], progress({
      phase: "error",
      retryAfterMs: 60_000,
    }), false);

    expect(result.pending).toEqual([]);
    expect(result.noMatch).toEqual([]);
    expect(result.failed.map((candidate) => candidate.item_name)).toEqual(["Mjölk"]);
  });

  it("keeps searches completed before a later failure as no-match", () => {
    const result = splitIcaUnmatchedItems([
      item("Mjölk"),
      item("Havregryn"),
    ], progress({
      phase: "error",
      completedQueries: ["Mjölk"],
      retryAfterMs: 60_000,
    }), false);

    expect(result.pending).toEqual([]);
    expect(result.noMatch.map((candidate) => candidate.item_name)).toEqual(["Mjölk"]);
    expect(result.failed.map((candidate) => candidate.item_name)).toEqual(["Havregryn"]);
  });
});
