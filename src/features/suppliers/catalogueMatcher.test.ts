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
    provider_location_id: null,
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
    expect(
      normalizeSupplierProductName(
        "Krossade tomater 3-p 1170g ICA",
        "ICA",
      ),
    ).toBe("krossade tomater");
    expect(
      normalizeSupplierProductName(
        "ICA Basic Tomater krossade 500g",
        "ICA Basic",
      ),
    ).toBe("tomater krossade");
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

  it("räknar bort ett verifierat varumärke vid kanten av ICA-artikelns namn", () => {
    const result = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        canonical_key: "ingredient-krossade-tomater",
        display_name: "Krossade tomater",
        category: "Grönt",
      },
      products: [product({
        display_name: "Krossade tomater 3-p 1170g ICA",
        brand: "ICA",
        package_amount: 1.17,
        package_unit: "kg",
      })],
    }));

    expect(result.status).toBe("safe");
    expect(result.selected?.score.total).toBe(100);
  });

  it("klassar den exakta ICA-artikeln som säker framför en finkrossad variant", () => {
    const result = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        canonical_key: "ingredient-krossade-tomater",
        display_name: "Krossade tomater",
        category: "Grönt",
      },
      products: [
        product({
          id: "exact",
          supplier_article_number: "2141387",
          display_name: "Krossade tomater 3-p 1170g ICA",
          brand: "ICA",
          package_amount: 1.17,
          package_unit: "kg",
          category: "Tomatkonserver",
        }),
        product({
          id: "finely-crushed",
          supplier_article_number: "2154590",
          display_name: "Finkrossade tomater 390g Cirio",
          brand: "Cirio",
          package_amount: 0.39,
          package_unit: "kg",
          category: "Tomatkonserver",
        }),
      ],
    }));

    expect(result.status).toBe("safe");
    expect(result.reason).toBe("unique_safe_candidate");
    expect(result.selected?.product.id).toBe("exact");
    expect(result.margin_to_next).toBeGreaterThanOrEqual(8);
    expect(result.candidates[1]?.explanations).toContainEqual(
      expect.objectContaining({
        code: "extra_product_modifier",
        kind: "warning",
      }),
    );
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

  it("använder uttryckligt innerantal för styckvaror men infererar aldrig styck från enbart vikt", () => {
    const counted = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        display_name: "Hamburgare (90g)",
        unit: "st",
      },
      products: [product({
        display_name: "Hamburgare 90g 6-p Scan",
        brand: "Scan",
        package_amount: 0.54,
        package_unit: "kg",
        packaging_metadata: {
          inner_unit_count: 6,
          inner_unit_label: "stycken",
        },
      })],
    }));
    expect(counted.status).toBe("safe");
    expect(counted.selected?.amount_per_purchase_unit).toBe(6);
    expect(counted.selected?.explanations).toContainEqual(
      expect.objectContaining({ code: "verified_inner_count" }),
    );

    const uncounted = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        display_name: "Hamburgare (90g)",
        unit: "st",
      },
      products: [product({
        display_name: "Hamburgare 540g Scan",
        brand: "Scan",
        package_amount: 0.54,
        package_unit: "kg",
      })],
    }));
    expect(uncounted.status).toBe("no_match");
    expect(uncounted.candidates[0]?.explanations).toContainEqual(
      expect.objectContaining({ code: "incompatible_unit" }),
    );

    const unlabelled = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        display_name: "Hamburgare (90g)",
        unit: "st",
      },
      products: [product({
        display_name: "Hamburgare 90g 6-p Scan",
        brand: "Scan",
        package_amount: 0.54,
        package_unit: "kg",
        packaging_metadata: {
          inner_unit_count: 6,
        },
      })],
    }));
    expect(unlabelled.status).toBe("no_match");
    expect(unlabelled.candidates[0]?.explanations).toContainEqual(
      expect.objectContaining({ code: "incompatible_unit" }),
    );
  });

  it("konverterar matskedar och teskedar som exakta volymenheter", () => {
    const tablespoons = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        display_name: "Sötsur sås",
        unit: "msk",
      },
      products: [product({
        display_name: "Sötsur sås 300ml ICA",
        brand: "ICA",
        package_amount: 0.3,
        package_unit: "l",
      })],
    }));
    expect(tablespoons.status).toBe("safe");
    expect(tablespoons.selected?.amount_per_purchase_unit).toBe(20);
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

  it("kräver åtta poängs marginal mellan verkligt olika produktmatchningar", () => {
    const products = [
      product({
        id: "product-b",
        supplier_article_number: "B-200",
        display_name: "Solrosolja 1 l",
        package_amount: 1,
        package_unit: "l",
      }),
      product({
        id: "product-a",
        supplier_article_number: "A-100",
        display_name: "Rapsolja 1 l",
        package_amount: 1,
        package_unit: "l",
      }),
    ];
    const matcherInput = {
      ingredient: {
        ...ingredient,
        canonical_key: "ingredient-matolja",
        display_name: "Matolja",
        unit: "l",
      },
      products,
      synonyms: [
        { ingredient_name: "matolja", supplier_name: "rapsolja" },
        { ingredient_name: "matolja", supplier_name: "solrosolja" },
      ],
    };
    const result = matchSupplierCatalogue(input(matcherInput));
    const reversed = matchSupplierCatalogue(input({
      ...matcherInput,
      products: [...products].reverse(),
    }));

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

  it.each([
    ["Havregryn", "ingredient-havregryn"],
    ["Tacosalsa (medium)", "ingredient-tacosalsa-medium"],
    ["Jasminris", "ingredient-jasminris"],
    ["Äppelmos", "ingredient-appelmos"],
  ])(
    "auto-matchar likvärdiga ICA-varianter av %s och väljer bästa verifierade erbjudandet",
    (ingredientName, canonicalKey) => {
      const smallId = `${canonicalKey}-small`;
      const largeId = `${canonicalKey}-large`;
      const result = matchSupplierCatalogue(input({
        ingredient: {
          ...ingredient,
          canonical_key: canonicalKey,
          display_name: ingredientName,
        },
        accounts: [account({
          provider_key: "ica",
          provider_location_id: "1004021",
          display_name: "ICA Kvantum Sickla",
        })],
        products: [
          product({
            id: smallId,
            supplier_article_number: `${canonicalKey}-500`,
            display_name: `ICA Basic ${ingredientName} 500 g`,
            brand: "ICA Basic",
            package_amount: 0.5,
          }),
          product({
            id: largeId,
            supplier_article_number: `${canonicalKey}-1000`,
            display_name: `${ingredientName} 1 kg ICA`,
            brand: "ICA",
            package_amount: 1,
          }),
        ],
        offers: [
          offer({
            id: `${smallId}-offer`,
            supplier_product_id: smallId,
            price: 15,
          }),
          offer({
            id: `${largeId}-offer`,
            supplier_product_id: largeId,
            price: 25,
          }),
        ],
      }));

      expect(result.status).toBe("safe");
      expect(result.reason).toBe("unique_safe_candidate");
      expect(result.margin_to_next).toBeNull();
      expect(result.selected?.product.id).toBe(largeId);
      expect(result.selected?.score.total).toBe(100);
    },
  );

  it("behåller en exakt Tacosalsa-träff säker när receptkontexten inte tillför någon poäng", () => {
    const result = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        canonical_key: "ingredient-tacosalsa-medium",
        display_name: "Tacosalsa (medium)",
        recipe_names: ["Tacos"],
      },
      accounts: [account({
        provider_key: "ica",
        provider_location_id: "1004021",
        display_name: "ICA Kvantum Sickla",
      })],
      products: [product({
        display_name: "Tacosalsa Medium 230g ICA",
        brand: "ICA",
        package_amount: 0.23,
      })],
    }));

    expect(result.status).toBe("safe");
    expect(result.selected?.score.total).toBe(100);
    expect(result.candidates[0]?.explanations).not.toContainEqual(
      expect.objectContaining({ code: "context_assumption" }),
    );
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

  it("använder ett verifierat ICA-sökresultat för högre recall men aldrig som en säker träff", () => {
    const result = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        display_name: "Köttfärs",
      },
      products: [product({
        display_name: "Nötfärs Färsk 12% 1kg ICA",
        brand: "ICA",
        source_metadata: {
          source: "ica_public_webshop",
          store_id: "1004021",
          ica_search_matches: [{ query: "Köttfärs", rank: 0 }],
        },
      })],
    }));

    expect(result.status).toBe("review");
    expect(result.candidates[0]?.score.total).toBeGreaterThanOrEqual(70);
    expect(result.candidates[0]?.score.total).toBeLessThan(96);
    expect(result.candidates[0]?.explanations).toContainEqual(
      expect.objectContaining({ code: "ica_search_result" }),
    );

    const unverified = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        display_name: "Köttfärs",
      },
      products: [product({
        display_name: "Nötfärs Färsk 12% 1kg ICA",
        brand: "ICA",
        source_metadata: {
          source: "ica_public_webshop",
          store_id: "1009999",
          ica_search_matches: [{ query: "Köttfärs", rank: 0 }],
        },
      })],
    }));
    expect(unverified.status).toBe("no_match");

    const unrelatedRunnerUp = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        display_name: "Gurka",
        category: "Grönt",
      },
      products: [product({
        display_name: "Morötter 2kg Klass 1 ICA",
        package_amount: 2,
        brand: "ICA",
        category: "Frukt & Grönt > Rotfrukter > Morötter",
        source_metadata: {
          source: "ica_public_webshop",
          store_id: "1004021",
          ica_search_matches: [{ query: "Gurka", rank: 1 }],
        },
      })],
    }));
    expect(unrelatedRunnerUp.status).toBe("no_match");
    expect(unrelatedRunnerUp.candidates[0]?.score.total).toBeLessThan(70);
  });

  it("avvisar majs i majskakor som en annan produkttyp", () => {
    const result = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        canonical_key: "ingredient-majs",
        display_name: "Majs",
        recipe_names: ["Tacos"],
      },
      products: [product({
        display_name: "Majskakor Paprika 125g Friggs",
        package_amount: 0.125,
        category: "Bröd & Kakor > Knäckebröd & Skorpor > Riskakor",
      })],
    }));

    expect(result.status).toBe("no_match");
    expect(result.reason).toBe("no_eligible_candidate");
    expect(result.candidates[0]?.explanations).toContainEqual(
      expect.objectContaining({
        kind: "blocker",
        code: "conflicting_product_kind",
      }),
    );
  });

  it("förstår svenska sammansättningar och använder receptet för rätt sorts dressing", () => {
    const result = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        canonical_key: "ingredient-dressing",
        display_name: "Dressing",
        recipe_names: ["Hamburgare"],
      },
      products: [
        product({
          id: "hot-dog-dressing",
          supplier_article_number: "ICA-HOT-DOG",
          display_name: "Hot dog Dressing 230g Kavli",
          brand: "Kavli",
          package_amount: 0.23,
          package_unit: "kg",
          category: "Skafferi > Såser > Dressing",
        }),
        product({
          id: "hamburger-dressing",
          supplier_article_number: "ICA-HAMBURGER",
          display_name: "Hamburgerdressing 230g ICA",
          brand: "ICA",
          package_amount: 0.23,
          package_unit: "kg",
          category: "Skafferi > Såser > Hamburgerdressing",
        }),
      ],
    }));

    expect(result.status).toBe("review");
    expect(result.candidates[0]?.product.id).toBe("hamburger-dressing");
    expect(result.candidates[0]?.explanations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "compound_name" }),
      expect.objectContaining({ code: "recipe_context_match" }),
    ]));
  });

  it("föredrar konserverad majs framför fryst majs för tacos och sallad utan att auto-godkänna antagandet", () => {
    const result = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        canonical_key: "ingredient-majs",
        display_name: "Majs",
        recipe_names: ["Pastasallad med pesto"],
      },
      products: [
        product({
          id: "frozen-corn",
          supplier_article_number: "ICA-FROZEN-CORN",
          display_name: "Majs 500g Apetit",
          brand: "Apetit",
          package_amount: 0.5,
          package_unit: "kg",
          category: "Fryst > Frysta grönsaker > Frysta grönsaker",
        }),
        product({
          id: "canned-corn",
          supplier_article_number: "ICA-CANNED-CORN",
          display_name: "Majs 3p 450g ICA",
          brand: "ICA",
          package_amount: 0.45,
          package_unit: "kg",
          category: "Skafferi > Grönsakskonserver > Majs",
        }),
      ],
    }));

    expect(result.status).toBe("review");
    expect(result.candidates[0]?.product.id).toBe("canned-corn");
    expect(result.candidates[0]?.explanations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "context_assumption", kind: "warning" }),
    ]));
    expect(result.candidates[1]?.explanations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "category_context_conflict" }),
    ]));
  });

  it("blockerar sammansättningar som egentligen är andra rätter eller produkttyper", () => {
    const cases = [
      ["Köttfärs", "Köttfärspaj 240g Dafgårds"],
      ["Peppar", "Örtte Pepparmynta 25-p Friggs"],
      ["Tomat", "Tomatpuré 360g ICA"],
      ["Hamburgare", "Hamburgerficka Barbeque 24-p ICA"],
      ["Hamburgare (90g)", "Hamburgerficka Barbeque 24-p ICA"],
      ["Morot", "Kål- och Morotsmix 250g ICA"],
      ["Tacokrydda", "Taco Tubs 145g Santa Maria"],
      ["isbergssallad", "Salladsost Tärnad i olja 300g ICA Basic"],
    ] as const;

    for (const [ingredientName, productName] of cases) {
      const result = matchSupplierCatalogue(input({
        ingredient: {
          ...ingredient,
          display_name: ingredientName,
          category: ingredientName === "Tomat" ? "Frukt & Grönt" : null,
        },
        products: [product({
          display_name: productName,
          package_amount: 1,
          package_unit: "kg",
        })],
      }));

      expect(result.status, `${ingredientName} → ${productName}`).toBe("no_match");
    }
  });

  it("kräver receptstöd när en generell råvara bara är suffix i produktnamnet", () => {
    const salad = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        display_name: "Sallad",
        recipe_names: ["Tacos"],
      },
      products: [product({ display_name: "Gurksallad 200g ICA" })],
    }));
    expect(salad.status).toBe("no_match");
    expect(salad.candidates[0]?.explanations).toContainEqual(
      expect.objectContaining({ code: "conflicting_product_kind" }),
    );

    const saladCheese = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        display_name: "Sallad",
        recipe_names: ["Tacos"],
      },
      products: [product({ display_name: "Salladsost 200g ICA Basic" })],
    }));
    expect(saladCheese.status).toBe("no_match");

    const dressing = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        display_name: "Dressing",
        recipe_names: ["Hamburgare"],
      },
      products: [product({ display_name: "Hamburgerdressing 230g ICA" })],
    }));
    expect(dressing.status).toBe("review");
    expect(dressing.candidates[0]?.explanations).not.toContainEqual(
      expect.objectContaining({ code: "conflicting_product_kind" }),
    );
  });

  it("använder inköpskategorin för att föredra färska tomater framför tomatkonserv", () => {
    const result = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        canonical_key: "ingredient-tomater",
        display_name: "Tomater",
        category: "Frukt & Grönt",
        recipe_names: ["Tacos"],
      },
      products: [
        product({
          id: "canned-tomatoes",
          supplier_article_number: "ICA-CANNED-TOMATOES",
          display_name: "Tomater hela 390g ICA",
          brand: "ICA",
          package_amount: 0.39,
          package_unit: "kg",
          category: "Skafferi > Grönsakskonserver > Tomatkonserver",
        }),
        product({
          id: "fresh-tomatoes",
          supplier_article_number: "ICA-FRESH-TOMATOES",
          display_name: "Tomater 500g ICA",
          brand: "ICA",
          package_amount: 0.5,
          package_unit: "kg",
          category: "Frukt & Grönt > Grönsaker > Tomat",
        }),
      ],
    }));

    expect(result.status).toBe("review");
    expect(result.candidates[0]?.product.id).toBe("fresh-tomatoes");
    expect(result.candidates[1]?.explanations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "category_context_conflict" }),
    ]));
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

  it("använder lager och pris enbart som stabil utslagsgivare mellan likvärdiga artiklar", () => {
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

    expect(result.status).toBe("safe");
    expect(result.selected?.product.id).toBe("cheap");
    expect(result.margin_to_next).toBeNull();
    expect(result.candidates.map((candidate) => candidate.product.id)).toEqual([
      "cheap",
      "expensive",
    ]);
    expect(result.candidates[0]?.score).toEqual(result.candidates[1]?.score);
  });

  it("jämför likvärdiga artiklar på pris per verifierad behovsenhet", () => {
    const products = [
      product({
        id: "single",
        supplier_article_number: "2119127",
        display_name: "Krossade tomater 390 g ICA",
        brand: "ICA",
        package_amount: 0.39,
      }),
      product({
        id: "three-pack",
        supplier_article_number: "2141387",
        display_name: "Krossade tomater 3-p 1170g ICA",
        brand: "ICA",
        package_amount: 1.17,
        packaging_metadata: {
          inner_unit_count: 3,
          inner_unit_label: "stycken",
        },
      }),
    ];
    const result = matchSupplierCatalogue(input({
      ingredient: {
        ...ingredient,
        canonical_key: "ingredient-krossade-tomater",
        display_name: "Krossade tomater",
      },
      products,
      offers: [
        offer({
          id: "offer-single",
          supplier_product_id: "single",
          price: 10.35,
        }),
        offer({
          id: "offer-three-pack",
          supplier_product_id: "three-pack",
          price: 28.55,
        }),
      ],
    }));

    expect(result.status).toBe("safe");
    expect(result.margin_to_next).toBeNull();
    expect(result.candidates[0]?.product.id).toBe("three-pack");
    expect(result.candidates[0]?.score).toEqual(result.candidates[1]?.score);
  });

  it("skapar stabila fingerprints och blockerar en uttryckligen avvisad produktversion", () => {
    const original = product();
    const sameData = product();
    const changedPackage = product({ package_amount: 6 });
    const changedInnerPackage = product({
      packaging_metadata: {
        inner_unit_count: 6,
        inner_unit_label: "stycken",
      },
    });

    expect(createSupplierProductFingerprint(original)).toBe(
      createSupplierProductFingerprint(sameData),
    );
    expect(createSupplierProductFingerprint(original)).not.toBe(
      createSupplierProductFingerprint(changedPackage),
    );
    expect(createSupplierProductFingerprint(original)).not.toBe(
      createSupplierProductFingerprint(changedInnerPackage),
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
