import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SupplyItemRow } from "../supplies/supplyModel";
import { SupplierCataloguePanel, type SupplierCatalogueCandidateView } from "./SupplierCataloguePanel";
import type { SupplierAccount, SupplierProduct } from "./supplierModel";

const account: SupplierAccount = {
  id: "account-1",
  account_key: "00000000-0000-4000-8000-000000000001",
  organization_id: "organization-1",
  provider_key: "demo",
  provider_location_id: null,
  display_name: "Demo-grossist",
  customer_number: null,
  active: true,
  created_by: "user-1",
  created_at: "2026-07-29T09:00:00Z",
  updated_at: "2026-07-29T09:00:00Z",
};

const product: SupplierProduct = {
  id: "product-1",
  organization_id: "organization-1",
  supplier_account_id: account.id,
  supplier_article_number: "RIS-10",
  display_name: "Ris 10 kg",
  gtin: "07310865004703",
  purchase_unit: "säck",
  package_amount: 10,
  package_unit: "kg",
  minimum_order_units: 1,
  brand: "Demo",
  catch_weight: false,
  category: "Skafferi",
  latest_import_run_id: null,
  normalized_search_name: "ris",
  packaging_metadata: {},
  product_fingerprint: "b".repeat(64),
  source_metadata: {},
  active: true,
  product_data_source: "catalogue_file",
  source_updated_at: "2026-07-29T09:00:00Z",
  created_by: "user-1",
  created_at: "2026-07-29T09:00:00Z",
  updated_at: "2026-07-29T09:00:00Z",
};

const item: SupplyItemRow = {
  id: "item-1",
  item_key: "purchase:ris",
  canonical_key: "ingredient:ris",
  category: "Torrvaror",
  item_name: "Ris",
  required_amount: 15,
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

const candidate: SupplierCatalogueCandidateView = {
  id: "candidate-1",
  supplierAccountId: account.id,
  canonicalKey: item.canonical_key,
  supplierProductId: product.id,
  status: "pending",
  classification: "safe",
  score: 100,
  matcherVersion: "deterministic-v2",
  amountPerPurchaseUnit: 10,
  requiredUnit: "kg",
  reasons: ["Exakt namn", "Samma mängdenhet", "Verifierad förpackning"],
  product,
};

function renderPanel(overrides: Partial<Parameters<typeof SupplierCataloguePanel>[0]> = {}) {
  return render(
    <SupplierCataloguePanel
      accounts={[account]}
      items={[item]}
      candidates={[]}
      approvedMatches={[]}
      columnProfiles={[]}
      online
      loading={false}
      onImport={vi.fn().mockResolvedValue({ imported: 2, matched: 1, dabasConfigured: false })}
      onApproveSafe={vi.fn().mockResolvedValue(undefined)}
      onApprove={vi.fn().mockResolvedValue(undefined)}
      onReject={vi.fn().mockResolvedValue(undefined)}
      onSuggestAlternative={vi.fn().mockResolvedValue(undefined)}
      onSearchAlternatives={vi.fn().mockResolvedValue([product])}
      {...overrides}
    />,
  );
}

describe("SupplierCataloguePanel", () => {
  it("låter användaren prova en tydligt märkt demokatalog och importerar bara giltiga rader", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn().mockResolvedValue({ imported: 2, matched: 1, dabasConfigured: false });
    renderPanel({ onImport });

    await user.click(screen.getByRole("button", { name: "Prova med exempeldata" }));

    expect(screen.getByText("demo-leverantorskatalog.xlsx")).toBeInTheDocument();
    expect(screen.getByText("2 kompletta")).toBeInTheDocument();
    expect(screen.getByText("1 behöver granskas")).toBeInTheDocument();
    expect(screen.getByText("1 blockeras")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Importera 3 artiklar" }));

    expect(onImport).toHaveBeenCalledWith(
      account.id,
      expect.objectContaining({ filename: "demo-leverantorskatalog.xlsx" }),
      expect.any(Array),
    );
    expect(await screen.findByText(
      "2 artiklar importerades och 1 matchningsförslag skapades.",
    )).toBeInTheDocument();
  });

  it("visar aldrig exempeldata för ett ICA-konto", () => {
    renderPanel({
      accounts: [{
        ...account,
        provider_key: "ica",
        provider_location_id: "1004021",
        display_name: "ICA Kvantum Sickla",
      }],
      syncProgress: {
        phase: "syncing",
        completedQueries: [],
        totalQueries: 1,
        retryAfterMs: 15_000,
        retryAt: Date.now() + 15_000,
        lastAttemptedAt: Date.now(),
      },
    });

    expect(screen.queryByRole("button", { name: "Prova med exempeldata" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText("Välj CSV eller Excel"))
      .not.toBeInTheDocument();
    expect(screen.getByText("Ingen Dabas-nyckel eller ICA-inloggning behövs.", {
      exact: false,
    }))
      .toBeInTheDocument();
    expect(screen.getByText("Automatiskt från ICA")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hämtas från ICA" }))
      .toBeInTheDocument();
    expect(screen.getByText(
      "du behöver inte matcha dem för hand.",
      { exact: false },
    )).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sök" }))
      .not.toBeInTheDocument();
  });

  it("skiljer på pågående ICA-sökning, granskning och färdig sökning utan träff", () => {
    const havregryn = {
      ...item,
      id: "item-havregryn",
      item_key: "purchase:havregryn",
      canonical_key: "ingredient:havregryn",
      item_name: "Havregryn",
    };
    const tacosalsa = {
      ...item,
      id: "item-tacosalsa",
      item_key: "purchase:tacosalsa",
      canonical_key: "ingredient:tacosalsa",
      item_name: "Tacosalsa",
    };
    renderPanel({
      accounts: [{
        ...account,
        provider_key: "ica",
        provider_location_id: "1004021",
        display_name: "ICA Kvantum Sickla",
      }],
      items: [item, havregryn, tacosalsa],
      candidates: [{
        ...candidate,
        classification: "review",
        score: 82,
      }],
      syncProgress: {
        phase: "syncing",
        completedQueries: ["Ris", "Havregryn"],
        totalQueries: 3,
        retryAfterMs: 15_000,
        retryAt: Date.now() + 15_000,
        lastAttemptedAt: Date.now(),
      },
    });

    const status = screen.getByLabelText("ICA-matchningsstatus");
    expect(status).toHaveTextContent("2 av 3 sökningar klara");
    expect(status).toHaveTextContent("1 hämtas");
    expect(status).toHaveTextContent("1 behöver granskas");
    expect(status).toHaveTextContent("1 utan träff");
    expect(screen.getByRole("heading", { name: "Hämtas från ICA" }))
      .toBeInTheDocument();
    expect(screen.getByText("Tacosalsa")).toBeInTheDocument();
    expect(screen.getByLabelText("Sök alternativ för Havregryn"))
      .toBeInTheDocument();
    expect(screen.queryByLabelText("Sök alternativ för Tacosalsa"))
      .not.toBeInTheDocument();
  });

  it("batchgodkänner bara väntande säkra förslag", async () => {
    const user = userEvent.setup();
    const onApproveSafe = vi.fn().mockResolvedValue(undefined);
    renderPanel({ candidates: [candidate], onApproveSafe });

    expect(screen.getByText("2 säckar täcker 20 kg.", { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Godkänn alla säkra" }));

    expect(onApproveSafe).toHaveBeenCalledWith(["candidate-1"]);
  });

  it("visar konsumentenheter i stället för ett decimalbehov när kollit är känt", () => {
    const tomatoItem: SupplyItemRow = {
      ...item,
      id: "tomato-item",
      canonical_key: "ingredient:krossade-tomater",
      item_name: "Krossade tomater",
      required_amount: 1.7373,
    };
    const tomatoProduct: SupplierProduct = {
      ...product,
      id: "tomato-product",
      supplier_article_number: "DEMO-TOMAT-6",
      display_name: "Krossade tomater",
      purchase_unit: "kolli",
      package_amount: 2.4,
      packaging_metadata: {
        inner_unit_count: 6,
        inner_unit_label: "burkar",
      },
    };
    const tomatoCandidate: SupplierCatalogueCandidateView = {
      ...candidate,
      id: "tomato-candidate",
      canonicalKey: tomatoItem.canonical_key,
      supplierProductId: tomatoProduct.id,
      amountPerPurchaseUnit: 2.4,
      product: tomatoProduct,
    };

    renderPanel({ items: [tomatoItem], candidates: [tomatoCandidate] });

    expect(screen.getByText("6 burkar (1 kolli à 6 × 400 g) täcker 2,4 kg.", {
      exact: false,
    })).toBeInTheDocument();
  });

  it("låter granskaren godkänna eller avvisa ett enskilt förslag", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const onReject = vi.fn().mockResolvedValue(undefined);
    renderPanel({
      candidates: [{ ...candidate, classification: "review", score: 82 }],
      onApprove,
      onReject,
    });

    await user.click(screen.getByRole("button", { name: "Godkänn" }));
    expect(onApprove).toHaveBeenCalledWith("candidate-1");

    await user.click(screen.getByRole("button", { name: "Inte rätt artikel" }));
    expect(onReject).toHaveBeenCalledWith("candidate-1");
  });

  it("märker ett modellomrankat förslag som AI-assisterat och fortfarande granskningspliktigt", () => {
    renderPanel({
      candidates: [{
        ...candidate,
        classification: "review",
        semanticAssisted: true,
        reasons: ["Hamburgerdressing passar receptet Hamburgare."],
      }],
    });

    expect(screen.getByText("AI-assisterad · Granska")).toBeInTheDocument();
    expect(screen.getByText(
      "Hamburgerdressing passar receptet Hamburgare.",
    )).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Godkänn alla säkra" }))
      .toBeDisabled();
  });

  it("söker bland importerade artiklar när ingen kandidat finns", async () => {
    const user = userEvent.setup();
    const onSuggestAlternative = vi.fn().mockResolvedValue(undefined);
    const onSearchAlternatives = vi.fn().mockResolvedValue([product]);
    renderPanel({ onSuggestAlternative, onSearchAlternatives });

    await user.type(screen.getByLabelText("Sök alternativ för Ris"), "RIS-10");
    await user.click(screen.getByRole("button", { name: "Sök" }));
    await user.click(screen.getByRole("button", { name: /Ris 10 kg/ }));

    expect(onSearchAlternatives).toHaveBeenCalledWith(account.id, "RIS-10");
    expect(onSuggestAlternative).toHaveBeenCalledWith(item, product);
  });

  it("skiljer ett oskickat sökord från en genomförd sökning utan träff", async () => {
    const user = userEvent.setup();
    const onSearchAlternatives = vi.fn().mockResolvedValue([]);
    renderPanel({
      accounts: [{
        ...account,
        provider_key: "ica",
        provider_location_id: "1004021",
        display_name: "ICA Kvantum Sickla",
      }],
      syncProgress: {
        phase: "complete",
        completedQueries: ["Ris"],
        totalQueries: 1,
        retryAfterMs: null,
        retryAt: null,
        lastAttemptedAt: Date.now(),
      },
      onSearchAlternatives,
    });

    const input = screen.getByLabelText("Sök alternativ för Ris");
    await user.type(input, "jasminris");
    expect(screen.queryByText(/Inga ICA-artiklar hittades/))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sök" }));

    expect(await screen.findByText(
      "Inga ICA-artiklar hittades för “jasminris”.",
      { exact: false },
    )).toBeInTheDocument();
  });

  it("visar nästa automatiska försök och kan starta om ICA-synken direkt", async () => {
    const user = userEvent.setup();
    const onRetrySync = vi.fn().mockResolvedValue(undefined);
    renderPanel({
      accounts: [{
        ...account,
        provider_key: "ica",
        provider_location_id: "1004021",
        display_name: "ICA Kvantum Sickla",
      }],
      syncWarning: "ICA begränsade kataloghämtningen tillfälligt.",
      syncProgress: {
        phase: "rate_limited",
        completedQueries: [],
        totalQueries: 1,
        retryAfterMs: 30_000,
        retryAt: Date.now() + 30_000,
        lastAttemptedAt: Date.now(),
      },
      onRetrySync,
    });

    expect(screen.getByText(/Nästa försök om \d+ sekunder/))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Försök igen nu" }));
    expect(onRetrySync).toHaveBeenCalledOnce();
  });

  it("calls a failed ICA fetch failed rather than matched or still fetching", () => {
    renderPanel({
      accounts: [{
        ...account,
        provider_key: "ica",
        provider_location_id: "1004021",
        display_name: "ICA Kvantum Sickla",
      }],
      syncWarning: "ICA:s sortiment kunde inte hämtas just nu.",
      syncProgress: {
        phase: "error",
        completedQueries: [],
        totalQueries: 1,
        retryAfterMs: 60_000,
        retryAt: Date.now() + 60_000,
        lastAttemptedAt: Date.now(),
      },
    });

    expect(screen.getByLabelText("ICA-matchningsstatus"))
      .toHaveTextContent("1 misslyckades");
    expect(screen.getByRole("heading", { name: "ICA-sökning misslyckades" }))
      .toBeInTheDocument();
    expect(screen.getByText(/Ofärdiga råvarusökningar markeras som misslyckade/i))
      .toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Hämtas från ICA" }))
      .not.toBeInTheDocument();
  });

  it("counts failed ICA searches by distinct query rather than duplicated supply rows", () => {
    renderPanel({
      accounts: [{
        ...account,
        provider_key: "ica",
        provider_location_id: "1004021",
        display_name: "ICA Kvantum Sickla",
      }],
      items: [item, {
        ...item,
        id: "item-2",
        item_key: "purchase:ris-2",
        canonical_key: "ingredient:ris-2",
        item_name: " RIS ",
      }],
      syncProgress: {
        phase: "error",
        completedQueries: [],
        totalQueries: 1,
        retryAfterMs: 60_000,
        retryAt: Date.now() + 60_000,
        lastAttemptedAt: Date.now(),
      },
    });

    expect(screen.getByLabelText("ICA-matchningsstatus"))
      .toHaveTextContent("1 misslyckades");
    expect(screen.getByText("1 råvarusökning väntar på ett nytt försök"))
      .toBeInTheDocument();
  });

  it("labels a successful local fixture truthfully without also styling it as an error", () => {
    renderPanel({
      accounts: [{
        ...account,
        provider_key: "ica",
        provider_location_id: "1004021",
        display_name: "ICA Kvantum Sickla",
      }],
      syncWarning: "Lokalt syntetiskt ICA-sortiment används för denna utvecklingsmiljö.",
      syncProgress: {
        phase: "complete",
        completedQueries: ["Ris"],
        totalQueries: 1,
        retryAfterMs: null,
        retryAt: null,
        lastAttemptedAt: Date.now(),
        syntheticLocalFixture: true,
      },
    });

    expect(screen.getByText("Lokala syntetiska testartiklar används", {
      exact: false,
    })).toBeInTheDocument();
    expect(screen.getByText(/De är inte butikens artiklar, priser eller lagersaldo/i))
      .toBeInTheDocument();
    expect(screen.getByText("Lokalt testläge")).toBeInTheDocument();
    expect(screen.queryByText(/Sortiment, ordinarie priser och förpackningsstorlekar kommer från/i))
      .not.toBeInTheDocument();
    expect(screen.queryByText("Lokalt syntetiskt ICA-sortiment används för denna utvecklingsmiljö."))
      .not.toBeInTheDocument();
  });

  it("marks a synthetic fixture on the candidate itself even if the page mode is stale", () => {
    const fixtureProduct: SupplierProduct = {
      ...product,
      product_data_source: "import:api",
      packaging_metadata: {
        normalization_version: "ica-public-catalogue-v2",
      },
      source_metadata: {
        source: "ica_local_fixture",
        store_id: "1004021",
        synthetic_local_fixture: true,
      },
    };

    renderPanel({
      accounts: [{
        ...account,
        provider_key: "ica",
        provider_location_id: "1004021",
        display_name: "ICA Kvantum Sickla",
      }],
      candidates: [{ ...candidate, product: fixtureProduct }],
      syncProgress: {
        phase: "complete",
        completedQueries: ["Ris"],
        totalQueries: 1,
        retryAfterMs: null,
        retryAt: null,
        lastAttemptedAt: Date.now(),
        syntheticLocalFixture: false,
      },
    });

    expect(screen.getByText(
      "LOKAL SYNTETISK TESTARTIKEL – INTE BUTIKSDATA",
    )).toBeInTheDocument();
  });

  it("återanvänder ett inläst godkännande efter omladdning", () => {
    renderPanel({
      approvedMatches: [{
        supplierAccountId: account.id,
        canonicalKey: item.canonical_key,
      }],
    });

    expect(screen.queryByLabelText("Sök alternativ för Ris")).not.toBeInTheDocument();
    expect(screen.getByText("Alla råvaror har minst ett förslag.")).toBeInTheDocument();
  });
});
