import { describe, expect, it } from "vitest";
import { selectCurrentOffers } from "./supplierApi";
import type { SupplierOffer } from "./supplierModel";

function offer(overrides: Partial<SupplierOffer> = {}): SupplierOffer {
  return {
    id: "offer-1",
    organization_id: "organization-1",
    supplier_product_id: "product-1",
    price: 100,
    currency: "SEK",
    availability_status: "available",
    valid_from: null,
    valid_to: null,
    fetched_at: "2026-07-29T09:00:00Z",
    created_at: "2026-07-29T09:00:00Z",
    updated_at: "2026-07-29T09:00:00Z",
    ...overrides,
  };
}

describe("selectCurrentOffers", () => {
  it("väljer bara en offert som gäller nu och tar den senast hämtade", () => {
    const selected = selectCurrentOffers([
      offer({ id: "expired", valid_to: "2026-07-28", fetched_at: "2026-07-30T09:00:00Z" }),
      offer({ id: "future", valid_from: "2026-07-30", fetched_at: "2026-07-30T09:00:00Z" }),
      offer({ id: "older-current", valid_from: "2026-07-20", valid_to: "2026-08-01" }),
      offer({ id: "newer-current", valid_from: "2026-07-20", valid_to: "2026-08-01", fetched_at: "2026-07-29T10:00:00Z" }),
    ], new Date("2026-07-29T12:00:00Z"));

    expect(selected.map((candidate) => candidate.id)).toEqual(["newer-current"]);
  });

  it("returnerar inget kundpris när ingen offert är giltig", () => {
    expect(selectCurrentOffers([
      offer({ valid_to: "2026-07-28" }),
    ], new Date("2026-07-29T12:00:00Z"))).toEqual([]);
  });

  it("bedömer datumgränsen i svensk tid i stället för UTC", () => {
    const untilJuly29 = offer({ valid_to: "2026-07-29" });

    expect(selectCurrentOffers([untilJuly29], new Date("2026-07-29T21:30:00Z"))).toHaveLength(1);
    expect(selectCurrentOffers([untilJuly29], new Date("2026-07-29T22:30:00Z"))).toHaveLength(0);
  });
});
