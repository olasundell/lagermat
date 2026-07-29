import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SupplyItemRow } from "../supplies/supplyModel";
import { SupplierAccountsPanel, SupplierMatchEditor } from "./SupplierFoundationPanel";
import type { SupplierAccount, SupplierMatchDetail } from "./supplierModel";

const account: SupplierAccount = {
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
};

const item: SupplyItemRow = {
  id: "item-1",
  item_key: "purchase:ris",
  canonical_key: "ingredient:ris",
  category: "Torrvaror",
  item_name: "Ris",
  required_amount: 5.5,
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

const detail: SupplierMatchDetail = {
  account,
  product: {
    id: "product-1",
    organization_id: "organization-1",
    supplier_account_id: account.id,
    supplier_article_number: "R-3000",
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
    product_fingerprint: "a".repeat(64),
    source_metadata: {},
    active: true,
    product_data_source: "manual",
    source_updated_at: "2026-07-29T09:00:00Z",
    created_by: "user-1",
    created_at: "2026-07-29T09:00:00Z",
    updated_at: "2026-07-29T09:00:00Z",
  },
  offer: {
    id: "offer-1",
    organization_id: "organization-1",
    supplier_product_id: "product-1",
    price: 199.5,
    currency: "SEK",
    availability_status: "available",
    valid_from: null,
    valid_to: null,
    fetched_at: "2026-07-29T09:00:00Z",
    created_at: "2026-07-29T09:00:00Z",
    updated_at: "2026-07-29T09:00:00Z",
  },
  match: {
    id: "match-1",
    organization_id: "organization-1",
    canonical_key: item.canonical_key,
    supplier_product_id: "product-1",
    supplier_account_id: account.id,
    approved_product_fingerprint: "a".repeat(64),
    required_unit: "kg",
    amount_per_purchase_unit: 3,
    approved_by: "user-1",
    approved_at: "2026-07-29T09:00:00Z",
    created_at: "2026-07-29T09:00:00Z",
    updated_at: "2026-07-29T09:00:00Z",
  },
};

describe("SupplierAccountsPanel", () => {
  it("förklarar säkerhetsgränsen och sparar organisationsspecifikt kundnummer", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SupplierAccountsPanel accounts={[]} online loading={false} onSave={onSave} />);

    expect(screen.getByText("Ingen order skickas i det här steget.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Inga inloggningsuppgifter lagras")).toBeInTheDocument();

    await user.click(screen.getByText("Lägg till leverantör"));
    await user.type(screen.getByLabelText("Kundnummer"), "9876");
    await user.click(screen.getByRole("button", { name: "Spara leverantör" }));

    expect(onSave).toHaveBeenCalledWith({
      accountKey: expect.stringMatching(
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i,
      ),
      providerKey: "menigo",
      displayName: "Menigo",
      customerNumber: "9876",
    });
  });
});

describe("SupplierMatchEditor", () => {
  it("håller detaljformuläret stängt bakom Avancerad manuell matchning", async () => {
    const user = userEvent.setup();
    render(
      <SupplierMatchEditor
        item={item}
        accounts={[account]}
        details={[]}
        online
        onSave={vi.fn()}
        onApplyProposal={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Matcha leverantörsartikel"));
    const advanced = screen.getByText("Avancerad manuell matchning").closest("details");
    expect(advanced).not.toHaveAttribute("open");

    await user.click(screen.getByText("Avancerad manuell matchning"));
    expect(advanced).toHaveAttribute("open");
    expect(screen.getByLabelText("Leverantörens artikelnummer")).toBeInTheDocument();
  });

  it("visar ett transparent kolliförslag men använder det först efter ett aktivt val", async () => {
    const user = userEvent.setup();
    const onApplyProposal = vi.fn().mockResolvedValue(undefined);
    render(
      <SupplierMatchEditor
        item={item}
        accounts={[account]}
        details={[detail]}
        online
        onSave={vi.fn()}
        onApplyProposal={onApplyProposal}
      />,
    );

    expect(onApplyProposal).not.toHaveBeenCalled();
    await user.click(screen.getByText("1 leverantörsmatchning"));

    expect(screen.getByText("Förslag: 2 kolli")).toBeInTheDocument();
    expect(screen.getByText("6 kg beställs · 0,5 kg över behovet")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Använd förslaget" }));

    expect(onApplyProposal).toHaveBeenCalledWith(expect.objectContaining({
      status: "ready",
      purchaseUnits: 2,
      orderedAmount: 6,
      surplusAmount: 0.5,
    }));
  });

  it("blockerar ett förslag när leverantören markerat artikeln som slut", async () => {
    const user = userEvent.setup();
    const unavailableDetail: SupplierMatchDetail = {
      ...detail,
      offer: { ...detail.offer!, availability_status: "out_of_stock" },
    };
    render(
      <SupplierMatchEditor
        item={item}
        accounts={[account]}
        details={[unavailableDetail]}
        online
        onSave={vi.fn()}
        onApplyProposal={vi.fn()}
      />,
    );

    await user.click(screen.getByText("1 leverantörsmatchning"));

    expect(screen.getByText("Artikeln är markerad som tillfälligt slut", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Använd förslaget" })).not.toBeInTheDocument();
  });
});
