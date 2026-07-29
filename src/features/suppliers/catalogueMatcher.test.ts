import { describe, expect, it } from "vitest";
import type {
  IngredientSupplierMatch,
  SupplierAccount,
  SupplierOffer,
  SupplierProduct,
} from "./supplierModel";
import {
  createSupplierProductFingerprint,
  matchSupplierCatalogue,
  normalizeCatalogueText,
  normalizeSupplierProductName,
  normalizeSupplierUnit,
  type CatalogueIngredient,
  type CatalogueMatcherInput,
} from "./catalogueMatcher";

const ingredient: CatalogueIngredient = {
  organization_id: "organization-1",
  canonical_key: "ingredient-ris",
  display_name: "Ris",
  unit: "kg",
};

function account(overrides: Partial<SupplierAccount> = {}): SupplierAccount {
  return {
    id: "account-1",
    account_key: "00000000-0000-4000-8000-000000000001",
    organization_id: "organization-1",
    provider_key: "menigo",
    display_name: "Menigo",
    customer_number: "12345",
    active: true,
    created_by: "user-1",
    created_at: "2026-07-29T09:00:00Z",
    updated_at: "2026-07-29T09:00:00Z",
    ...overrides,
  };
}

function product(overrides: Partial<SupplierProduct> = {}): SupplierProduct {
  return {
    id: "product-1",
    organization_id: "organization-1",
    supplier_account_id: "account-1",
    supplier_article_number: "A-100",
    display_name: "Ris 3 kg",
    gtin: "07300000000000",
    purchase_unit: "kolli",
    package_amount: 3,
    package_unit: "kg",
    minimum_order_units: 1,
    brand: null,
    catch_weight: false,
    category: null,
    latest_import_run_id: null,
    normalized_search_name: "ris",
    packaging_metadata: {},
    product_fingerprint: "fixture",
    source_metadata: {},
    active: true,
    product_data_source: "supplier_import",
    source_updated_at: "2026-07-29T09:00:00Z",
    created_by: "user-1",
    created_at: "2026-07-29T09:00:00Z",
    updated_at: "2026-07-29T09:00:00Z",
    ...overrides,
  };
}

function offer(overrides: Partial<SupplierOffer> = {}): SupplierOffer {
  return {
    id: "offer-1",
    organization_id: "organization-1",
    supplier_product_id: "product-1",
    price: 100,
    currency: "SEK",
    availability_status: "available",
    valid_from: "2026-07-01",
    valid_to: "2026-07-31",
    fetched_at: "2026-07-29T09:00:00Z",
    created_at: "2026-07-29T09:00:00Z",
    updated_at: "2026-07-29T09:00:00Z",
    ...overrides,
  };
}

function approvedMatch(
  overrides: Partial<IngredientSupplierMatch> = {},
): IngredientSupplierMatch {
  return {
    id: "match-1",
    organization_id: "organization-1",
    canonical_key: ingredient.canonical_key,
    supplier_product_id: "product-1",
    supplier_account_id: "account-1",
    approved_product_fingerprint: null,
    required_unit: "kg",
    amount_per_purchase_unit: 3,
    approved_by: "user-1",
    approved_at: "2026-07-29T10:00:00Z",
    created_at: "2026-07-29T10:00:00Z",
    updated_at: "2026-07-29T10:00:00Z",
    ...overrides,
  };
}

function input(overrides: Partial<CatalogueMatcherInput> = {}): CatalogueMatcherInput {
  return {
    ingredient,
    accounts: [account()],
    products: [product()],
    offers: [offer()],
    approved_matches: [],
    rejected_fingerprints: [],
    synonyms: [],
    as_of_date: "2026-07-29",
    ...overrides,
  };
}

describe("catalogue normalisation", () => {
  it("normaliserar Unicode, svenska tecken, blanksteg och säkra enhetsalias", () => {
    expect(normalizeCatalogueText("  GUL\u00a0LÖK & ÄPPLE ")).toBe("gul lök och äpple");
    expect(normalizeSupplierUnit(" Kilogram ")).toBe("kg");
    expect(normalizeSupplierUnit("milliliter")).toBe("ml");
  });

  it("tar bort strukturellt förpackningsbrus utan att ta bort produktnamnet", () => {
    expect(normalizeSupplierProductName("Ris, 6 x 500 g kartong")).toBe("ris");
    expect(normalizeSupplierProductName("Krossade tomater 3 kg")).toBe("krossade tomater");
  });
});

describe("deterministic catalogue matching", () => {
  it("ger en unik exakt namn- och enhetsträff 100 poäng", () => {
    const result = matchSupplierCatalogue(input());

    expect(result.status).toBe("safe");
    expect(result.reason).toBe("unique_safe_candidate");
    expect(result.selected?.score).toEqual({ name: 80, unit: 15, package: 5, total: 100 });
    expect(result.selected?.amount_per_purchase_unit).toBe(3);
  });

  it("gör exakta mass- och volymkonverteringar med Decimal", () => {
    const mass = matchSupplierCatalogue(input({
      products: [product({
        display_name: "Ris 6 x 500 g",
        package_amount: 3000,
        package_unit: "g",
      })],
    }));
    expect(mass.status).toBe("safe");
    expect(mass.selected?.score.total).toBe(97);
    expect(mass.selected?.amount_per_purchase_unit).toBe(3);

    const volume = matchSupplierCatalogue(input({
      ingredient: { ...ingredient, display_name: "Mjölk", unit: "l" },
      products: [product({
        display_name: "Mjölk 500 ml",
        package_amount: 500,
        package_unit: "ml",
      })],
    }));
    expect(volume.status).toBe("safe");
    expect(volume.selected?.amount_per_purchase_unit).toBe(0.5);
  });

  it("kan ge en säker synonymträff men lämnar en konverterad synonym till granskning", () => {
    const synonym = { ingredient_name: "matolja", supplier_name: "rapsolja" };
    const exactUnit = matchSupplierCatalogue(input({
      ingredient: { ...ingredient, display_name: "Matolja", unit: "l" },
      products: [product({
        display_name: "Rapsolja 1 l",
        package_amount: 1,
        package_unit: "l",
      })],
      synonyms: [synonym],
    }));
    expect(exactUnit.status).toBe("safe");
    expect(exactUnit.selected?.score.total).toBe(96);

    const convertedUnit = matchSupplierCatalogue(input({
      ingredient: { ...ingredient, display_name: "Matolja", unit: "l" },
      products: [product({
        display_name: "Rapsolja 500 ml",
        package_amount: 500,
        package_unit: "ml",
      })],
      synonyms: [synonym],
    }));
    expect(convertedUnit.status).toBe("review");
    expect(convertedUnit.candidates[0]?.score.total).toBe(93);
  });

  it("kräver åtta poängs marginal och sorterar lika kandidater stabilt", () => {
    const products = [
      product({ id: "product-b", supplier_article_number: "B-200" }),
      product({ id: "product-a", supplier_article_number: "A-100" }),
    ];
    const result = matchSupplierCatalogue(input({ products }));
    const reversed = matchSupplierCatalogue(input({ products: [...products].reverse() }));

    expect(result.status).toBe("review");
    expect(result.reason).toBe("safe_margin_not_met");
    expect(result.margin_to_next).toBe(0);
    expect(result.candidates.map((candidate) => candidate.product.id)).toEqual([
      "product-a",
      "product-b",
    ]);
    expect(reversed.candidates.map((candidate) => candidate.product.id)).toEqual([
      "product-a",
      "product-b",
    ]);
  });

  it("ger fuzzy tokenlikhet till granskning men avvisar orelaterade namn", () => {
    const review = matchSupplierCatalogue(input({
      ingredient: { ...ingredient, display_name: "Krossade tomater" },
      products: [product({ display_name: "Krossade tomater premium 3 kg" })],
    }));
    expect(review.status).toBe("review");
    expect(review.candidates[0]?.score.total).toBeGreaterThanOrEqual(70);
    expect(review.candidates[0]?.score.total).toBeLessThan(96);

    const noMatch = matchSupplierCatalogue(input({
      products: [product({ display_name: "Diskmedel 3 kg" })],
    }));
    expect(noMatch.status).toBe("no_match");
    expect(noMatch.reason).toBe("confidence_below_review_threshold");
  });

  it("behandlar inte en delsträng som en råvaruträff", () => {
    const result = matchSupplierCatalogue(input({
      products: [product({
        display_name: "Riskaka 3 kg",
        normalized_search_name: "riskaka",
      })],
    }));

    expect(result.status).toBe("no_match");
    expect(result.reason).toBe("confidence_below_review_threshold");
    expect(result.candidates[0]?.score.name).toBe(0);
  });

  it("blockerar inkompatibla dimensioner trots exakt namn", () => {
    const result = matchSupplierCatalogue(input({
      products: [product({ package_amount: 3, package_unit: "l" })],
    }));

    expect(result.status).toBe("no_match");
    expect(result.reason).toBe("no_eligible_candidate");
    expect(result.candidates[0]?.explanations).toContainEqual(expect.objectContaining({
      kind: "blocker",
      code: "incompatible_unit",
    }));
  });

  it("blockerar viktvaror trots känd nominell mängd", () => {
    const result = matchSupplierCatalogue(input({
      products: [product({
        ...({ catch_weight: true } as Partial<SupplierProduct>),
      })],
    }));

    expect(result.status).toBe("no_match");
    expect(result.candidates[0]?.explanations).toContainEqual(
      expect.objectContaining({ kind: "blocker", code: "catch_weight" }),
    );
  });

  it("blockerar saknade krav och motstridiga produktformer", () => {
    const missingDiet = matchSupplierCatalogue(input({
      ingredient: { ...ingredient, display_name: "Glutenfri pasta" },
      products: [product({ display_name: "Pasta 3 kg" })],
    }));
    expect(missingDiet.status).toBe("no_match");
    expect(missingDiet.candidates[0]?.explanations).toContainEqual(expect.objectContaining({
      code: "missing_required_modifier",
    }));

    const missingForm = matchSupplierCatalogue(input({
      ingredient: { ...ingredient, display_name: "Färsk broccoli" },
      products: [product({ display_name: "Broccoli 3 kg" })],
    }));
    expect(missingForm.status).toBe("no_match");
    expect(missingForm.candidates[0]?.explanations).toContainEqual(expect.objectContaining({
      code: "missing_required_modifier",
    }));

    const conflictingForm = matchSupplierCatalogue(input({
      ingredient: { ...ingredient, display_name: "Färsk broccoli" },
      products: [product({ display_name: "Fryst broccoli 3 kg" })],
    }));
    expect(conflictingForm.status).toBe("no_match");
    expect(conflictingForm.candidates[0]?.explanations).toContainEqual(expect.objectContaining({
      code: "conflicting_product_form",
    }));

    const powderInsteadOfFrozen = matchSupplierCatalogue(input({
      ingredient: { ...ingredient, display_name: "Frysta blåbär" },
      products: [product({ display_name: "Blåbärspulver 3 kg" })],
    }));
    expect(powderInsteadOfFrozen.status).toBe("no_match");
    expect(powderInsteadOfFrozen.candidates[0]?.explanations).toContainEqual(
      expect.objectContaining({ kind: "blocker", code: "conflicting_product_form" }),
    );
  });

  it("gör en enda färsk godkänd match exakt även vid manuell konvertering", () => {
    const result = matchSupplierCatalogue(input({
      products: [product({ package_amount: 12, package_unit: "st" })],
      approved_matches: [approvedMatch({ amount_per_purchase_unit: 3 })],
    }));

    expect(result.status).toBe("approved_exact");
    expect(result.reason).toBe("single_current_approved_match");
    expect(result.selected?.score.total).toBe(100);
    expect(result.selected?.amount_per_purchase_unit).toBe(3);
  });

  it("kräver granskning av en gammal eller otillgänglig godkänd match", () => {
    const stale = matchSupplierCatalogue(input({
      products: [product({ updated_at: "2026-07-29T11:00:00Z" })],
      approved_matches: [approvedMatch()],
    }));
    expect(stale.status).toBe("review");
    expect(stale.reason).toBe("approved_match_needs_review");
    expect(stale.candidates[0]?.explanations).toContainEqual(expect.objectContaining({
      code: "stale_approval",
    }));

    const unavailable = matchSupplierCatalogue(input({
      approved_matches: [approvedMatch()],
      offers: [offer({ availability_status: "out_of_stock" })],
    }));
    expect(unavailable.status).toBe("review");
    expect(unavailable.candidates[0]?.explanations).toContainEqual(expect.objectContaining({
      code: "out_of_stock",
    }));
  });

  it("behåller godkännandet efter återimport när produktfingeravtrycket är oförändrat", () => {
    const persistedFingerprint = "a".repeat(64);
    const currentProduct = product({
      updated_at: "2026-07-29T11:00:00Z",
      ...({ product_fingerprint: persistedFingerprint } as Partial<SupplierProduct>),
    });
    const result = matchSupplierCatalogue(input({
      products: [currentProduct],
      approved_matches: [approvedMatch({
        ...({
          approved_product_fingerprint: persistedFingerprint,
        } as Partial<IngredientSupplierMatch>),
      })],
    }));

    expect(result.status).toBe("approved_exact");
    expect(result.candidates[0]?.explanations).not.toContainEqual(
      expect.objectContaining({ code: "stale_approval" }),
    );
  });

  it("ogiltigförklarar godkännandet när produktfingeravtrycket ändras", () => {
    const result = matchSupplierCatalogue(input({
      products: [product({
        ...({ product_fingerprint: "b".repeat(64) } as Partial<SupplierProduct>),
      })],
      approved_matches: [approvedMatch({
        ...({
          approved_product_fingerprint: "a".repeat(64),
        } as Partial<IngredientSupplierMatch>),
      })],
    }));

    expect(result.status).toBe("review");
    expect(result.candidates[0]?.explanations).toContainEqual(
      expect.objectContaining({ code: "stale_approval" }),
    );
  });

  it("väljer inte tyst mellan flera godkända produkter", () => {
    const result = matchSupplierCatalogue(input({
      products: [
        product({ id: "product-1", supplier_article_number: "A-100" }),
        product({ id: "product-2", supplier_article_number: "A-200" }),
      ],
      approved_matches: [
        approvedMatch({ id: "match-1", supplier_product_id: "product-1" }),
        approvedMatch({ id: "match-2", supplier_product_id: "product-2" }),
      ],
    }));

    expect(result.status).toBe("review");
    expect(result.reason).toBe("multiple_approved_matches");
    expect(result.selected).toBeNull();
  });

  it("använder aktuell lagerstatus men låter inte priset ändra semantisk poäng", () => {
    const cheap = matchSupplierCatalogue(input({
      offers: [offer({ price: 10, fetched_at: "2026-07-28T09:00:00Z" })],
    }));
    const expensive = matchSupplierCatalogue(input({
      offers: [offer({ price: 1000, fetched_at: "2026-07-29T09:00:00Z" })],
    }));

    expect(cheap.selected?.score).toEqual(expensive.selected?.score);
  });

  it("använder lager och pris enbart som stabil utslagsgivare", () => {
    const products = [
      product({ id: "expensive", supplier_article_number: "EXP" }),
      product({ id: "cheap", supplier_article_number: "CHEAP" }),
    ];
    const result = matchSupplierCatalogue(input({
      products,
      offers: [
        offer({ id: "offer-expensive", supplier_product_id: "expensive", price: 200 }),
        offer({ id: "offer-cheap", supplier_product_id: "cheap", price: 100 }),
      ],
    }));

    expect(result.status).toBe("review");
    expect(result.candidates.map((candidate) => candidate.product.id)).toEqual([
      "cheap",
      "expensive",
    ]);
    expect(result.candidates[0]?.score).toEqual(result.candidates[1]?.score);
  });

  it("skapar stabila fingerprints och blockerar en uttryckligen avvisad produktversion", () => {
    const original = product();
    const sameData = product();
    const changedPackage = product({ package_amount: 6 });

    expect(createSupplierProductFingerprint(original)).toBe(
      createSupplierProductFingerprint(sameData),
    );
    expect(createSupplierProductFingerprint(original)).not.toBe(
      createSupplierProductFingerprint(changedPackage),
    );

    const result = matchSupplierCatalogue(input({
      products: [original],
      rejected_fingerprints: [createSupplierProductFingerprint(original)],
    }));
    expect(result.status).toBe("no_match");
    expect(result.candidates[0]?.explanations).toContainEqual(expect.objectContaining({
      code: "rejected_product",
    }));
  });

  it("isolerar organisation och leverantörskonto samt kräver explicit as-of-datum", () => {
    const result = matchSupplierCatalogue(input({
      accounts: [
        account(),
        account({ id: "account-2", organization_id: "organization-2" }),
      ],
      products: [
        product(),
        product({
          id: "foreign-product",
          organization_id: "organization-2",
          supplier_account_id: "account-2",
        }),
      ],
      supplier_account_ids: ["account-1"],
    }));
    expect(result.candidates.map((candidate) => candidate.product.id)).toEqual(["product-1"]);

    expect(() => matchSupplierCatalogue(input({ as_of_date: "today" }))).toThrow(
      "as_of_date must be an explicit ISO date",
    );
    expect(() => matchSupplierCatalogue(input({ as_of_date: "2026-02-31" }))).toThrow(
      "as_of_date must be an explicit ISO date",
    );
  });
});
