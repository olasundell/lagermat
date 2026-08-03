import { AlertTriangle, Check, PackageSearch, Plus, Save, Store } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "react-aria-components";
import { userFacingError } from "../../lib/userFacingError";
import { formatExactAmount, type SupplyItemRow } from "../supplies/supplyModel";
import type {
  SaveSupplierAccountInput,
  SaveSupplierProductMatchInput,
} from "./supplierApi";
import {
  describeSupplierPurchaseQuantity,
  proposeSupplierOrder,
  type ReadySupplierOrderProposal,
  type SupplierAccount,
  type SupplierMatchDetail,
} from "./supplierModel";
import {
  ICA_KVANTUM_SICKLA,
  isIcaSicklaAccount,
  isLocalIcaFixtureProduct,
  LOCAL_ICA_FIXTURE_WARNING,
} from "./icaStore";

const SUPPLIER_PROVIDERS = [
  { key: "menigo", label: "Menigo" },
  { key: "martin_servera", label: "Martin & Servera" },
  { key: "ica", label: "ICA-butik" },
  { key: "snabbgross", label: "Snabbgross" },
  { key: "svensk_cater", label: "Svensk Cater" },
  { key: "mardskog", label: "Mårdskog & Lindkvist" },
  { key: "other", label: "Annan leverantör" },
] as const;

const AVAILABILITY_LABELS: Record<string, string> = {
  available: "Tillgänglig",
  out_of_stock: "Tillfälligt slut",
  discontinued: "Utgången",
  unknown: "Okänd tillgänglighet",
};

interface SupplierAccountsPanelProps {
  accounts: SupplierAccount[];
  online: boolean;
  loading: boolean;
  onSave: (input: SaveSupplierAccountInput) => Promise<void>;
}

function providerLabel(providerKey: string): string {
  return SUPPLIER_PROVIDERS.find((provider) => provider.key === providerKey)?.label ?? providerKey;
}

function parseLocalizedDecimal(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat("sv-SE", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${formatExactAmount(price)} ${currency}`;
  }
}

function proposalProblem(reason: string, item: SupplyItemRow, detail: SupplierMatchDetail): string {
  if (reason === "unit_mismatch") {
    return `Matchningen är i ${detail.match.required_unit}, men behovet är i ${item.required_unit}. Ange en uttrycklig konvertering.`;
  }
  if (reason === "supplier_product_out_of_stock") {
    return "Artikeln är markerad som tillfälligt slut och kan inte användas som beställningsförslag.";
  }
  if (reason === "supplier_product_discontinued") {
    return "Artikeln är markerad som utgången och kan inte användas som beställningsförslag.";
  }
  if (reason === "inactive_supplier_account" || reason === "inactive_supplier_product") {
    return "Leverantören eller artikeln är inaktiv och kan inte användas.";
  }
  return "Matchningen saknar giltig mängd eller minimiorder och kan inte användas.";
}

export function SupplierAccountsPanel({
  accounts,
  online,
  loading,
  onSave,
}: SupplierAccountsPanelProps) {
  const [providerKey, setProviderKey] = useState("ica");
  const [accountKey, setAccountKey] = useState(() => crypto.randomUUID());
  const [displayName, setDisplayName] = useState<string>(ICA_KVANTUM_SICKLA.name);
  const [providerLocationId, setProviderLocationId] = useState<string | null>(
    ICA_KVANTUM_SICKLA.id,
  );
  const [customerNumber, setCustomerNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  function changeProvider(nextProviderKey: string) {
    setProviderKey(nextProviderKey);
    if (nextProviderKey === "ica") {
      setDisplayName(ICA_KVANTUM_SICKLA.name);
      setProviderLocationId(ICA_KVANTUM_SICKLA.id);
      return;
    }
    setDisplayName(providerLabel(nextProviderKey));
    setProviderLocationId(null);
  }

  async function save() {
    if (!displayName.trim()) {
      setMessage({ kind: "error", text: "Ange ett namn för leverantören." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await onSave({
        accountKey,
        providerKey,
        providerLocationId,
        displayName: displayName.trim(),
        customerNumber: customerNumber.trim() || null,
      });
      setAccountKey(crypto.randomUUID());
      setCustomerNumber("");
      setMessage({ kind: "success", text: "Leverantören sparades för organisationen." });
    } catch (caught) {
      setMessage({ kind: "error", text: userFacingError(caught, "Leverantören kunde inte sparas.") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="supplier-foundation" aria-labelledby="supplier-foundation-heading">
      <div className="supplier-foundation__heading">
        <div>
          <span className="eyebrow"><Store aria-hidden="true" size={17} /> Leverantörsunderlag</span>
          <h2 id="supplier-foundation-heading">Koppla inköpslistan till era artiklar</h2>
          <p>Scoutmat sparar kundnummer, artikelmatchningar och kundpriser per organisation. Ingen order skickas i det här steget.</p>
        </div>
        <span className="supplier-foundation__safety">Inga inloggningsuppgifter lagras</span>
      </div>

      {loading ? <p className="supplier-foundation__status">Läser leverantörer…</p> : null}
      {!online ? (
        <p className="supplier-foundation__notice">
          <AlertTriangle aria-hidden="true" size={17} />
          Leverantörsdata kräver nätanslutning. Den vanliga inköpslistan fungerar fortfarande offline.
        </p>
      ) : null}

      {accounts.length ? (
        <div className="supplier-account-list" aria-label="Sparade leverantörer">
          {accounts.map((account) => (
            <div className="supplier-account-card" key={account.id}>
              <Store aria-hidden="true" size={18} />
              <span>
                <strong>{account.display_name}</strong>
                <small>
                  {providerLabel(account.provider_key)}
                  {account.provider_location_id
                    ? ` · butik ${account.provider_location_id}`
                    : account.customer_number
                      ? ` · kundnummer ${account.customer_number}`
                      : " · inget kundnummer"}
                </small>
              </span>
            </div>
          ))}
        </div>
      ) : !loading ? <p className="supplier-foundation__status">Ingen leverantör är kopplad ännu.</p> : null}

      <details className="supplier-account-form">
        <summary><Plus aria-hidden="true" size={17} /> Lägg till leverantör</summary>
        <div className="supplier-account-form__fields">
          <label>Leverantör
            <select
              id="supplier-provider"
              name="supplier-provider"
              value={providerKey}
              onChange={(event) => changeProvider(event.target.value)}
              disabled={!online || saving}
            >
              {SUPPLIER_PROVIDERS.map((provider) => <option key={provider.key} value={provider.key}>{provider.label}</option>)}
            </select>
          </label>
          <label>Visningsnamn
            <input
              id="supplier-display-name"
              name="supplier-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={!online || saving}
            />
          </label>
          {providerKey === "ica" ? (
            <label>ICA-butik
              <select
                id="supplier-provider-location"
                name="supplier-provider-location"
                value={providerLocationId ?? ""}
                onChange={(event) => setProviderLocationId(event.target.value)}
                disabled={!online || saving}
              >
                <option value={ICA_KVANTUM_SICKLA.id}>
                  {ICA_KVANTUM_SICKLA.name} · {ICA_KVANTUM_SICKLA.address}
                </option>
              </select>
            </label>
          ) : null}
          <label>Kundnummer
            <input
              id="supplier-customer-number"
              name="supplier-customer-number"
              value={customerNumber}
              onChange={(event) => setCustomerNumber(event.target.value)}
              placeholder="Valfritt"
              disabled={!online || saving}
            />
          </label>
          <Button className="secondary-button" onPress={save} isDisabled={!online || saving}>
            <Save aria-hidden="true" size={17} /> {saving ? "Sparar…" : "Spara leverantör"}
          </Button>
        </div>
        {message ? <p className={`inline-message inline-message--${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p> : null}
      </details>
    </section>
  );
}

interface SupplierMatchEditorProps {
  item: SupplyItemRow;
  accounts: SupplierAccount[];
  details: SupplierMatchDetail[];
  online: boolean;
  onSave: (input: SaveSupplierProductMatchInput) => Promise<void>;
  onApplyProposal: (
    detail: SupplierMatchDetail,
    proposal: ReadySupplierOrderProposal,
  ) => Promise<void>;
}

export function SupplierMatchEditor({
  item,
  accounts,
  details,
  online,
  onSave,
  onApplyProposal,
}: SupplierMatchEditorProps) {
  const activeAccounts = useMemo(
    () => accounts.filter((account) =>
      account.active && !isIcaSicklaAccount(account)
    ),
    [accounts],
  );
  const [supplierAccountId, setSupplierAccountId] = useState(activeAccounts[0]?.id ?? "");
  const [supplierArticleNumber, setSupplierArticleNumber] = useState("");
  const [displayName, setDisplayName] = useState(item.item_name);
  const [gtin, setGtin] = useState("");
  const [purchaseUnit, setPurchaseUnit] = useState("kolli");
  const [packageAmount, setPackageAmount] = useState("1");
  const [packageUnit, setPackageUnit] = useState(item.required_unit);
  const [amountPerPurchaseUnit, setAmountPerPurchaseUnit] = useState("1");
  const [minimumOrderUnits, setMinimumOrderUnits] = useState("1");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("SEK");
  const [availabilityStatus, setAvailabilityStatus] = useState("unknown");
  const [priceValidFrom, setPriceValidFrom] = useState("");
  const [priceValidTo, setPriceValidTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [applyingProductId, setApplyingProductId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const selectedSupplierAccountId = activeAccounts.some((account) => account.id === supplierAccountId)
    ? supplierAccountId
    : activeAccounts[0]?.id ?? "";

  async function save() {
    const parsedPackageAmount = parseLocalizedDecimal(packageAmount);
    const parsedAmountPerPurchaseUnit = parseLocalizedDecimal(amountPerPurchaseUnit);
    const parsedMinimumOrderUnits = Number(minimumOrderUnits.trim());
    const parsedPrice = price.trim() ? parseLocalizedDecimal(price) : null;

    if (!selectedSupplierAccountId) {
      setMessage({ kind: "error", text: "Lägg först till och välj en leverantör." });
      return;
    }
    if (!supplierArticleNumber.trim() || !displayName.trim() || !purchaseUnit.trim() || !packageUnit.trim()) {
      setMessage({ kind: "error", text: "Artikelnummer, benämning, beställningsenhet och förpackningsenhet krävs." });
      return;
    }
    if (!Number.isFinite(parsedPackageAmount) || parsedPackageAmount <= 0) {
      setMessage({ kind: "error", text: "Förpackningsinnehållet måste vara större än noll." });
      return;
    }
    if (!Number.isFinite(parsedAmountPerPurchaseUnit) || parsedAmountPerPurchaseUnit <= 0) {
      setMessage({ kind: "error", text: "Mängden per beställningsenhet måste vara större än noll." });
      return;
    }
    if (!Number.isInteger(parsedMinimumOrderUnits) || parsedMinimumOrderUnits <= 0) {
      setMessage({ kind: "error", text: "Minsta order måste vara ett positivt heltal." });
      return;
    }
    if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      setMessage({ kind: "error", text: "Priset måste vara noll eller ett positivt tal." });
      return;
    }
    if (gtin.trim() && !/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin.trim())) {
      setMessage({ kind: "error", text: "GTIN ska innehålla 8, 12, 13 eller 14 siffror." });
      return;
    }
    if (priceValidFrom && priceValidTo && priceValidTo < priceValidFrom) {
      setMessage({ kind: "error", text: "Prisets slutdatum kan inte vara före startdatumet." });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await onSave({
        canonicalKey: item.canonical_key,
        supplierAccountId: selectedSupplierAccountId,
        supplierArticleNumber: supplierArticleNumber.trim(),
        displayName: displayName.trim(),
        purchaseUnit: purchaseUnit.trim(),
        packageAmount: parsedPackageAmount,
        packageUnit: packageUnit.trim(),
        amountPerPurchaseUnit: parsedAmountPerPurchaseUnit,
        requiredUnit: item.required_unit,
        gtin: gtin.trim() || null,
        minimumOrderUnits: parsedMinimumOrderUnits,
        price: parsedPrice,
        currency: currency.trim().toUpperCase(),
        availabilityStatus,
        priceValidFrom: priceValidFrom || null,
        priceValidTo: priceValidTo || null,
      });
      setMessage({ kind: "success", text: "Artikeln matchades. Kontrollera förslaget innan du använder det." });
    } catch (caught) {
      setMessage({ kind: "error", text: userFacingError(caught, "Artikelmatchningen kunde inte sparas.") });
    } finally {
      setSaving(false);
    }
  }

  async function apply(detail: SupplierMatchDetail, proposal: ReadySupplierOrderProposal) {
    setApplyingProductId(detail.product.id);
    setMessage(null);
    try {
      await onApplyProposal(detail, proposal);
      setMessage({ kind: "success", text: "Förslaget kopierades till beställningen. Det beräknade behovet ändrades inte." });
    } catch (caught) {
      setMessage({ kind: "error", text: userFacingError(caught, "Förslaget kunde inte användas.") });
    } finally {
      setApplyingProductId(null);
    }
  }

  return (
    <details className="supplier-match-editor">
      <summary>
        <PackageSearch aria-hidden="true" size={17} />
        {details.length ? `${details.length} leverantörsmatchning${details.length === 1 ? "" : "ar"}` : "Matcha leverantörsartikel"}
      </summary>

      <div className="supplier-match-editor__content">
        {details.map((detail) => {
          const proposal = proposeSupplierOrder(item.required_amount, item.required_unit, detail);
          const localFixture = isLocalIcaFixtureProduct(detail.product);
          return (
            <article className={`supplier-match-card${localFixture ? " supplier-match-card--fixture" : ""}`} key={detail.match.id}>
              <div className="supplier-match-card__heading">
                <div>
                  <strong>{detail.account.display_name} · {detail.product.display_name}</strong>
                  <span>Artikel {detail.product.supplier_article_number}{detail.product.gtin ? ` · GTIN ${detail.product.gtin}` : ""}</span>
                </div>
                {detail.offer?.price !== null && detail.offer ? <b>{formatPrice(detail.offer.price, detail.offer.currency)} / {detail.product.purchase_unit}</b> : null}
              </div>
              {localFixture ? (
                <p className="supplier-match-warning">
                  <AlertTriangle aria-hidden="true" size={17} />
                  {LOCAL_ICA_FIXTURE_WARNING}. Värdena är skapade för lokal provkörning och kommer inte från butiken.
                </p>
              ) : null}
              <p>
                Sparad matchning: 1 {detail.product.purchase_unit} täcker {formatExactAmount(detail.match.amount_per_purchase_unit)} {detail.match.required_unit}.
                Produktdata: {formatExactAmount(detail.product.package_amount)} {detail.product.package_unit}.
                Minsta order: {formatExactAmount(detail.product.minimum_order_units)} {detail.product.purchase_unit}.
              </p>
              {detail.offer ? (
                <small>
                  {AVAILABILITY_LABELS[detail.offer.availability_status] ?? detail.offer.availability_status}
                  {detail.offer.valid_from || detail.offer.valid_to ? ` · prisperiod ${detail.offer.valid_from ?? "–"}–${detail.offer.valid_to ?? "tills vidare"}` : ""}
                </small>
              ) : <small>Inget aktuellt kundpris eller tillgänglighetsbesked.</small>}
              {proposal.status === "ready" ? (
                <div className="supplier-proposal">
                  <Check aria-hidden="true" size={18} />
                  <span>
                    <strong>
                      Köp {describeSupplierPurchaseQuantity(
                        detail.product,
                        proposal.purchaseUnits,
                        detail.match.amount_per_purchase_unit,
                        detail.match.required_unit,
                      )}
                    </strong>
                    {formatExactAmount(proposal.orderedAmount)} {item.required_unit} beställs · {formatExactAmount(proposal.surplusAmount)} {item.required_unit} över behovet
                  </span>
                  <Button className="secondary-button" onPress={() => apply(detail, proposal)} isDisabled={!online || applyingProductId !== null}>
                    {applyingProductId === detail.product.id
                      ? "Använder…"
                      : localFixture ? "Använd testförslaget" : "Använd förslaget"}
                  </Button>
                </div>
              ) : (
                <p className="supplier-match-warning">
                  <AlertTriangle aria-hidden="true" size={17} />
                  {proposalProblem(proposal.reason, item, detail)}
                </p>
              )}
            </article>
          );
        })}

        {activeAccounts.length ? <details className="supplier-advanced-match">
          <summary>Avancerad manuell matchning</summary>
          <div className="supplier-match-form">
            <h3>{details.length ? "Lägg till eller uppdatera matchning" : "Ny artikelmatchning"}</h3>
            {!activeAccounts.length ? <p className="supplier-match-warning"><AlertTriangle aria-hidden="true" size={17} /> Lägg till en leverantör ovan innan artikeln kan matchas.</p> : null}
            <div className="supplier-match-form__grid">
            <label>Leverantör
              <select value={selectedSupplierAccountId} onChange={(event) => setSupplierAccountId(event.target.value)} disabled={!online || saving || !activeAccounts.length}>
                {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.display_name}</option>)}
              </select>
            </label>
            <label>Leverantörens artikelnummer
              <input value={supplierArticleNumber} onChange={(event) => setSupplierArticleNumber(event.target.value)} disabled={!online || saving} />
            </label>
            <label>Artikelbenämning
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={!online || saving} />
            </label>
            <label>GTIN
              <input inputMode="numeric" value={gtin} onChange={(event) => setGtin(event.target.value)} placeholder="Valfritt" disabled={!online || saving} />
            </label>
            <label>Beställningsenhet
              <input value={purchaseUnit} onChange={(event) => setPurchaseUnit(event.target.value)} placeholder="Till exempel kolli" disabled={!online || saving} />
            </label>
            <label>Minsta order
              <input inputMode="numeric" value={minimumOrderUnits} onChange={(event) => setMinimumOrderUnits(event.target.value)} disabled={!online || saving} />
            </label>
            <label>Förpackningsinnehåll
              <input inputMode="decimal" value={packageAmount} onChange={(event) => setPackageAmount(event.target.value)} disabled={!online || saving} />
            </label>
            <label>Förpackningsenhet
              <input value={packageUnit} onChange={(event) => setPackageUnit(event.target.value)} disabled={!online || saving} />
            </label>
            <label className="supplier-match-form__conversion">1 {purchaseUnit || "beställningsenhet"} täcker
              <span>
                <input aria-label={`Mängd per beställningsenhet för ${item.item_name}`} inputMode="decimal" value={amountPerPurchaseUnit} onChange={(event) => setAmountPerPurchaseUnit(event.target.value)} disabled={!online || saving} />
                <b>{item.required_unit}</b>
              </span>
              <small>Detta är den uttryckliga konvertering som används vid avrundning.</small>
            </label>
            <label>Kundpris
              <input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Valfritt" disabled={!online || saving} />
            </label>
            <label>Valuta
              <input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value)} disabled={!online || saving} />
            </label>
            <label>Tillgänglighet
              <select value={availabilityStatus} onChange={(event) => setAvailabilityStatus(event.target.value)} disabled={!online || saving}>
                <option value="unknown">Okänd</option>
                <option value="available">Tillgänglig</option>
                <option value="out_of_stock">Tillfälligt slut</option>
                <option value="discontinued">Utgången</option>
              </select>
            </label>
            <label>Pris gäller från
              <input type="date" value={priceValidFrom} onChange={(event) => setPriceValidFrom(event.target.value)} disabled={!online || saving} />
            </label>
            <label>Pris gäller till
              <input type="date" value={priceValidTo} onChange={(event) => setPriceValidTo(event.target.value)} disabled={!online || saving} />
            </label>
            </div>
            <Button className="secondary-button supplier-match-form__save" onPress={save} isDisabled={!online || saving || !activeAccounts.length}>
              <Save aria-hidden="true" size={17} /> {saving ? "Sparar…" : "Spara artikelmatchning"}
            </Button>
          </div>
        </details> : null}
        {message ? <p className={`inline-message inline-message--${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p> : null}
      </div>
    </details>
  );
}
