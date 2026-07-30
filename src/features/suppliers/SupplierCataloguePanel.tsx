import Decimal from "decimal.js";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  FileSpreadsheet,
  FlaskConical,
  PackageSearch,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useState, type ChangeEvent } from "react";
import { Button } from "react-aria-components";
import { userFacingError } from "../../lib/userFacingError";
import { formatExactAmount, type SupplyItemRow } from "../supplies/supplyModel";
import {
  buildSupplierCataloguePreview,
  readSupplierCatalogueFile,
  suggestedSupplierCatalogueMapping,
  supplierCatalogueFieldLabels,
  type SupplierCatalogueColumnMapping,
  type SupplierCatalogueImportTable,
  type SupplierCataloguePreview,
} from "./catalogueImportModel";
import { demoSupplierCatalogueTable } from "./demoSupplierCatalogue";
import { ICA_KVANTUM_SICKLA, isIcaSicklaAccount } from "./icaStore";
import {
  describeSupplierPurchaseQuantity,
  type SupplierAccount,
  type SupplierProduct,
} from "./supplierModel";

export interface SupplierCatalogueCandidateView {
  id: string;
  supplierAccountId: string;
  canonicalKey: string;
  supplierProductId: string;
  status: "pending" | "accepted" | "rejected";
  classification: "safe" | "review";
  score: number;
  matcherVersion: string;
  amountPerPurchaseUnit: number;
  requiredUnit: string;
  reasons: string[];
  product: SupplierProduct;
}

export interface SupplierCatalogueImportResult {
  imported: number;
  matched: number;
  dabasConfigured: boolean;
  enrichmentSource?: "dabas" | "fixture" | "none";
}

export interface SupplierCatalogueColumnProfileView {
  supplierAccountId: string;
  sourceKind: SupplierCatalogueImportTable["sourceKind"];
  headerSignature: string;
  mapping: SupplierCatalogueColumnMapping[];
}

export interface SupplierCatalogueApprovedMatchView {
  supplierAccountId: string;
  canonicalKey: string;
}

interface SupplierCataloguePanelProps {
  accounts: SupplierAccount[];
  items: SupplyItemRow[];
  candidates: SupplierCatalogueCandidateView[];
  approvedMatches: SupplierCatalogueApprovedMatchView[];
  columnProfiles: SupplierCatalogueColumnProfileView[];
  online: boolean;
  loading: boolean;
  syncWarning?: string | null;
  syncPending?: boolean;
  onImport: (
    supplierAccountId: string,
    preview: SupplierCataloguePreview,
    mapping: SupplierCatalogueColumnMapping[],
  ) => Promise<SupplierCatalogueImportResult>;
  onApproveSafe: (candidateIds: string[]) => Promise<void>;
  onApprove: (candidateId: string) => Promise<void>;
  onReject: (candidateId: string) => Promise<void>;
  onSuggestAlternative: (item: SupplyItemRow, product: SupplierProduct) => Promise<void>;
  onSearchAlternatives: (
    supplierAccountId: string,
    query: string,
  ) => Promise<SupplierProduct[]>;
}

function candidateOrderSummary(
  item: SupplyItemRow | undefined,
  candidate: SupplierCatalogueCandidateView,
): string {
  if (!item || candidate.amountPerPurchaseUnit <= 0) return "Beställningsmängden kan inte räknas ut.";
  const needed = new Decimal(item.required_amount);
  const perUnit = new Decimal(candidate.amountPerPurchaseUnit);
  const minimum = Math.max(1, candidate.product.minimum_order_units);
  const units = needed.isZero()
    ? new Decimal(0)
    : Decimal.max(needed.div(perUnit).ceil(), minimum);
  return `${describeSupplierPurchaseQuantity(
    candidate.product,
    units.toString(),
    perUnit.toString(),
    candidate.requiredUnit,
  )} täcker ${
    formatExactAmount(units.times(perUnit).toNumber())
  } ${candidate.requiredUnit}`;
}

function mappingHasErrors(preview: SupplierCataloguePreview | null): boolean {
  return Boolean(preview?.mappingIssues.some((issue) => issue.severity === "error"));
}

function CandidateCard({
  candidate,
  item,
  busy,
  onApprove,
  onReject,
}: {
  candidate: SupplierCatalogueCandidateView;
  item: SupplyItemRow | undefined;
  busy: boolean;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
}) {
  return (
    <article className="supplier-review-card">
      <div className="supplier-review-card__heading">
        <div>
          <strong>{item?.item_name ?? "Okänd råvara"} → {candidate.product.display_name}</strong>
          <span>Artikel {candidate.product.supplier_article_number} · {candidate.score} poäng</span>
        </div>
        <span className={`supplier-confidence supplier-confidence--${candidate.classification}`}>
          {candidate.classification === "safe" ? "Säker" : "Granska"}
        </span>
      </div>
      <p>
        {formatExactAmount(candidate.product.package_amount)} {candidate.product.package_unit} per{" "}
        {candidate.product.purchase_unit}. {candidateOrderSummary(item, candidate)}.
      </p>
      <ul className="supplier-review-reasons">
        {candidate.reasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
      <div className="supplier-review-card__actions">
        <Button className="secondary-button" onPress={onApprove} isDisabled={busy}>
          <Check aria-hidden="true" size={17} /> Godkänn
        </Button>
        <Button className="text-button" onPress={onReject} isDisabled={busy}>
          <X aria-hidden="true" size={17} /> Inte rätt artikel
        </Button>
      </div>
    </article>
  );
}

export function SupplierCataloguePanel({
  accounts,
  items,
  candidates,
  approvedMatches,
  columnProfiles,
  online,
  loading,
  syncWarning = null,
  syncPending = false,
  onImport,
  onApproveSafe,
  onApprove,
  onReject,
  onSuggestAlternative,
  onSearchAlternatives,
}: SupplierCataloguePanelProps) {
  const activeAccounts = useMemo(() => accounts.filter((account) => account.active), [accounts]);
  const [supplierAccountId, setSupplierAccountId] = useState(activeAccounts[0]?.id ?? "");
  const selectedAccountId = activeAccounts.some((account) => account.id === supplierAccountId)
    ? supplierAccountId
    : activeAccounts[0]?.id ?? "";
  const selectedAccount = activeAccounts.find((account) => account.id === selectedAccountId);
  const icaSicklaSelected = isIcaSicklaAccount(selectedAccount);
  const icaSyncPending = icaSicklaSelected && syncPending;
  const [table, setTable] = useState<SupplierCatalogueImportTable | null>(null);
  const [mapping, setMapping] = useState<SupplierCatalogueColumnMapping[]>([]);
  const [preview, setPreview] = useState<SupplierCataloguePreview | null>(null);
  const [showMapping, setShowMapping] = useState(false);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
  const [alternativeSearch, setAlternativeSearch] = useState<Record<string, string>>({});
  const [alternativeResults, setAlternativeResults] = useState<
    Record<string, SupplierProduct[]>
  >({});
  const [searchingCanonicalKey, setSearchingCanonicalKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const activeItems = useMemo(
    () => items.filter((item) => item.source_present),
    [items],
  );
  const itemsByCanonicalKey = useMemo(
    () => new Map(activeItems.map((item) => [item.canonical_key, item])),
    [activeItems],
  );
  const accountCandidates = useMemo(
    () => candidates.filter((candidate) =>
      candidate.supplierAccountId === selectedAccountId && candidate.status === "pending"
    ),
    [candidates, selectedAccountId],
  );
  const safeCandidates = accountCandidates.filter((candidate) => candidate.classification === "safe");
  const reviewCandidates = accountCandidates.filter((candidate) => candidate.classification === "review");
  const accountedCanonicalKeys = new Set([
    ...approvedMatches
      .filter((match) => match.supplierAccountId === selectedAccountId)
      .map((match) => match.canonicalKey),
    ...accountCandidates.map((candidate) => candidate.canonicalKey),
  ]);
  const noMatchItems = activeItems.filter((item) => !accountedCanonicalKeys.has(item.canonical_key));

  function installTable(nextTable: SupplierCatalogueImportTable) {
    const savedProfile = columnProfiles.find((profile) =>
      profile.supplierAccountId === selectedAccountId
      && profile.sourceKind === nextTable.sourceKind
      && profile.headerSignature === nextTable.headerSignature
    );
    const nextMapping = savedProfile?.mapping.length === nextTable.headers.length
      ? savedProfile.mapping.map((column, index) => ({
          index,
          source: nextTable.headers[index] ?? column.source,
          target: column.target,
        }))
      : suggestedSupplierCatalogueMapping(nextTable);
    const nextPreview = buildSupplierCataloguePreview(nextTable, nextMapping);
    setTable(nextTable);
    setMapping(nextMapping);
    setPreview(nextPreview);
    setShowMapping(mappingHasErrors(nextPreview));
    setMessage(null);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReading(true);
    setMessage(null);
    try {
      installTable(await readSupplierCatalogueFile(file));
    } catch (caught) {
      setMessage({ kind: "error", text: userFacingError(caught, "Katalogen kunde inte läsas.") });
    } finally {
      setReading(false);
    }
  }

  function updateMapping(index: number, target: SupplierCatalogueColumnMapping["target"]) {
    if (!table) return;
    const nextMapping = mapping.map((column) => (
      column.index === index ? { ...column, target } : column
    ));
    setMapping(nextMapping);
    setPreview(buildSupplierCataloguePreview(table, nextMapping));
  }

  async function importCatalogue() {
    if (!selectedAccountId || !preview || mappingHasErrors(preview)) return;
    const importable = preview.rows.filter((row) => row.status !== "blocked");
    if (!importable.length) {
      setMessage({ kind: "error", text: "Katalogen innehåller inga giltiga artiklar att importera." });
      return;
    }
    setImporting(true);
    setMessage(null);
    try {
      const result = await onImport(selectedAccountId, preview, mapping);
      setTable(null);
      setMapping([]);
      setPreview(null);
      setShowMapping(false);
      setMessage({
        kind: "success",
        text: `${result.imported} artiklar importerades och ${result.matched} matchningsförslag skapades.`,
      });
    } catch (caught) {
      setMessage({ kind: "error", text: userFacingError(caught, "Katalogen kunde inte importeras.") });
    } finally {
      setImporting(false);
    }
  }

  async function decide(candidateId: string, decision: "approve" | "reject") {
    setBusyCandidateId(candidateId);
    setMessage(null);
    try {
      if (decision === "approve") {
        await onApprove(candidateId);
      } else {
        await onReject(candidateId);
      }
    } catch (caught) {
      setMessage({
        kind: "error",
        text: userFacingError(caught, decision === "approve"
          ? "Förslaget kunde inte godkännas."
          : "Förslaget kunde inte avvisas."),
      });
    } finally {
      setBusyCandidateId(null);
    }
  }

  async function approveSafe() {
    if (!safeCandidates.length) return;
    setBusyCandidateId("batch");
    setMessage(null);
    try {
      await onApproveSafe(safeCandidates.map((candidate) => candidate.id));
      setMessage({ kind: "success", text: `${safeCandidates.length} säkra förslag godkändes.` });
    } catch (caught) {
      setMessage({ kind: "error", text: userFacingError(caught, "De säkra förslagen kunde inte godkännas.") });
    } finally {
      setBusyCandidateId(null);
    }
  }

  async function suggestAlternative(item: SupplyItemRow, product: SupplierProduct) {
    setBusyCandidateId(`alternative:${item.canonical_key}:${product.id}`);
    setMessage(null);
    try {
      await onSuggestAlternative(item, product);
      setAlternativeSearch((current) => ({ ...current, [item.canonical_key]: "" }));
      setAlternativeResults((current) => ({ ...current, [item.canonical_key]: [] }));
    } catch (caught) {
      setMessage({ kind: "error", text: userFacingError(caught, "Artikeln kan inte föreslås för råvaran.") });
    } finally {
      setBusyCandidateId(null);
    }
  }

  async function searchAlternatives(item: SupplyItemRow) {
    const query = alternativeSearch[item.canonical_key]?.trim() ?? "";
    if (query.length < 2 || !selectedAccountId) return;

    setSearchingCanonicalKey(item.canonical_key);
    setMessage(null);
    try {
      const products = await onSearchAlternatives(selectedAccountId, query);
      setAlternativeResults((current) => ({
        ...current,
        [item.canonical_key]: products,
      }));
    } catch (caught) {
      setMessage({
        kind: "error",
        text: userFacingError(caught, "Katalogen kunde inte sökas."),
      });
    } finally {
      setSearchingCanonicalKey(null);
    }
  }

  return (
    <section className="supplier-catalogue" aria-labelledby="supplier-catalogue-heading">
      <div className="supplier-catalogue__heading">
        <div>
          <span className="eyebrow"><Sparkles aria-hidden="true" size={17} /> Automatisk artikelmatchning</span>
          <h2 id="supplier-catalogue-heading">
            {icaSicklaSelected
              ? "ICA-sortimentet matchas automatiskt"
              : "Importera katalogen – granska bara undantagen"}
          </h2>
          <p>
            {icaSicklaSelected
              ? "Scoutmat hämtar butikens verkliga artiklar och räknar om behovet till hela köpbara förpackningar."
              : "Scoutmat läser grossistens fil, räknar ut kollistorlekar och minns varje godkänd matchning."}
          </p>
        </div>
        <span className="supplier-foundation__safety">Ingen order skickas</span>
      </div>

      {!online ? (
        <p className="supplier-foundation__notice">
          <AlertTriangle aria-hidden="true" size={17} /> Katalogimport kräver nätanslutning.
        </p>
      ) : null}
      {icaSicklaSelected ? (
        <p className="supplier-foundation__notice">
          <Check aria-hidden="true" size={17} />
          <span>
            Sortiment, ordinarie priser och förpackningsstorlekar kommer från{" "}
            <a href={ICA_KVANTUM_SICKLA.storeUrl} target="_blank" rel="noreferrer">
              {ICA_KVANTUM_SICKLA.name}
            </a>
            . Ingen Dabas-nyckel eller ICA-inloggning behövs.
          </span>
        </p>
      ) : null}
      {syncWarning ? (
        <p className="inline-message inline-message--error" role="status">
          <AlertTriangle aria-hidden="true" size={17} /> {syncWarning}
        </p>
      ) : null}

      <div className="supplier-catalogue__toolbar">
        <label>Leverantör
          <select
            id="supplier-catalogue-account"
            name="supplier-catalogue-account"
            value={selectedAccountId}
            onChange={(event) => {
              setSupplierAccountId(event.target.value);
              setTable(null);
              setMapping([]);
              setPreview(null);
              setMessage(null);
            }}
            disabled={!online || loading || importing || !activeAccounts.length}
          >
            {activeAccounts.map((account) => (
              <option key={account.id} value={account.id}>{account.display_name}</option>
            ))}
          </select>
        </label>
        {icaSicklaSelected ? (
          <span className="supplier-foundation__safety">
            {loading ? "Hämtar från ICA…" : "Automatiskt från ICA"}
          </span>
        ) : (
          <label className="supplier-file-button">
            <Upload aria-hidden="true" size={18} />
            {reading ? "Läser fil…" : "Välj CSV eller Excel"}
            <input
              type="file"
              accept=".csv,.xls,.xlsx"
              onChange={handleFile}
              disabled={!online || reading || importing || !selectedAccountId}
            />
          </label>
        )}
        {selectedAccount?.provider_key === "demo" ? (
          <Button
            className="secondary-button"
            onPress={() => installTable(demoSupplierCatalogueTable)}
            isDisabled={!online || importing || !selectedAccountId}
          >
            <FlaskConical aria-hidden="true" size={17} /> Prova med exempeldata
          </Button>
        ) : null}
      </div>
      {!activeAccounts.length ? (
        <p className="supplier-catalogue__empty">Lägg först till en leverantör ovan.</p>
      ) : null}

      {preview && !icaSicklaSelected ? (
        <div className="supplier-import-preview">
          <div className="supplier-import-preview__heading">
            <div>
              <FileSpreadsheet aria-hidden="true" size={22} />
              <span>
                <strong>{preview.filename}</strong>
                <small>Blad {preview.sheetName} · {preview.rows.length} rader</small>
              </span>
            </div>
            <Button className="text-button" onPress={() => {
              setTable(null);
              setMapping([]);
              setPreview(null);
            }}>
              <X aria-hidden="true" size={17} /> Avbryt
            </Button>
          </div>

          <div className="supplier-import-counts" aria-label="Importresultat">
            <span><Check aria-hidden="true" size={16} /> {preview.safeCount} kompletta</span>
            <span><AlertTriangle aria-hidden="true" size={16} /> {preview.ambiguousCount} behöver granskas</span>
            <span><X aria-hidden="true" size={16} /> {preview.blockedCount} blockeras</span>
          </div>

          <details open={showMapping || mappingHasErrors(preview)} onToggle={(event) => setShowMapping(event.currentTarget.open)}>
            <summary>Justera kolumner</summary>
            <div className="supplier-column-mapping">
              {mapping.map((column) => (
                <label key={column.index}>{column.source}
                  <select
                    aria-label={`Användning för ${column.source}`}
                    value={column.target}
                    onChange={(event) => updateMapping(
                      column.index,
                      event.target.value as SupplierCatalogueColumnMapping["target"],
                    )}
                  >
                    {Object.entries(supplierCatalogueFieldLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {preview.mappingIssues.map((issue) => (
              <p key={`${issue.code}:${issue.field ?? issue.message}`} className="form-error">{issue.message}</p>
            ))}
          </details>

          <div className="supplier-import-table-wrap">
            <table className="supplier-import-table">
              <thead><tr><th>Status</th><th>Artikel</th><th>Förpackning</th><th>Pris</th><th>Anmärkning</th></tr></thead>
              <tbody>
                {preview.rows.slice(0, 12).map((row) => (
                  <tr key={row.id}>
                    <td><span className={`supplier-row-status supplier-row-status--${row.status}`}>{row.status === "safe" ? "Klar" : row.status === "ambiguous" ? "Granska" : "Blockerad"}</span></td>
                    <td><strong>{row.displayName || "Namnlös artikel"}</strong><small>{row.supplierArticleNumber || `Rad ${row.sourceRow}`}</small></td>
                    <td>{row.totalAmount === null ? "–" : `${formatExactAmount(row.totalAmount)} ${row.totalUnit}`} / {row.purchaseUnit || "–"}</td>
                    <td>{row.price === null ? "–" : `${formatExactAmount(row.price)} kr`}</td>
                    <td>{row.issues[0]?.message ?? "Alla obligatoriska värden hittades."}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 12 ? <p className="supplier-import-preview__more">Visar 12 av {preview.rows.length} rader.</p> : null}
          <Button
            className="primary-button supplier-import-preview__submit"
            onPress={importCatalogue}
            isDisabled={!online || importing || mappingHasErrors(preview) || preview.rows.every((row) => row.status === "blocked")}
          >
            <Upload aria-hidden="true" size={18} /> {importing ? "Importerar och matchar…" : `Importera ${preview.rows.filter((row) => row.status !== "blocked").length} artiklar`}
          </Button>
        </div>
      ) : null}

      {message ? <p className={`inline-message inline-message--${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p> : null}

      {selectedAccountId ? (
        <div className="supplier-review-board">
          <section aria-labelledby="safe-suggestions-heading">
            <div className="supplier-review-section__heading">
              <div><Check aria-hidden="true" size={20} /><span><h3 id="safe-suggestions-heading">Säkra förslag</h3><small>{safeCandidates.length} unika träffar utan varningar</small></span></div>
              <Button className="secondary-button" onPress={approveSafe} isDisabled={!safeCandidates.length || busyCandidateId !== null}>
                <Sparkles aria-hidden="true" size={17} /> Godkänn alla säkra
              </Button>
            </div>
            {safeCandidates.length ? safeCandidates.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                item={itemsByCanonicalKey.get(candidate.canonicalKey)}
                busy={busyCandidateId !== null}
                onApprove={() => decide(candidate.id, "approve")}
                onReject={() => decide(candidate.id, "reject")}
              />
            )) : <p className="supplier-review-empty">Inga nya säkra förslag.</p>}
          </section>

          <section aria-labelledby="review-suggestions-heading">
            <div className="supplier-review-section__heading">
              <div><AlertTriangle aria-hidden="true" size={20} /><span><h3 id="review-suggestions-heading">Behöver granskas</h3><small>{reviewCandidates.length} möjliga träffar</small></span></div>
            </div>
            {reviewCandidates.length ? reviewCandidates.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                item={itemsByCanonicalKey.get(candidate.canonicalKey)}
                busy={busyCandidateId !== null}
                onApprove={() => decide(candidate.id, "approve")}
                onReject={() => decide(candidate.id, "reject")}
              />
            )) : <p className="supplier-review-empty">Inga osäkra förslag väntar.</p>}
          </section>

          <section aria-labelledby="no-suggestions-heading">
            <div className="supplier-review-section__heading">
              <div>
                <PackageSearch aria-hidden="true" size={20} />
                <span>
                  <h3 id="no-suggestions-heading">
                    {icaSyncPending ? "Hämtas från ICA" : "Ingen träff"}
                  </h3>
                  <small>
                    {icaSyncPending
                      ? "Scoutmat arbetar vidare automatiskt"
                      : icaSicklaSelected
                      ? "Sök bland hämtade artiklar från ICA Sickla"
                      : "Sök i den importerade katalogen"}
                  </small>
                </span>
              </div>
            </div>
            {icaSyncPending ? (
              <p className="supplier-review-empty">
                {noMatchItems.length} råvaror väntar fortfarande på ICA-katalogen.
                Du behöver inte söka eller matcha dem för hand.
              </p>
            ) : noMatchItems.length ? noMatchItems.map((item) => {
              const query = alternativeSearch[item.canonical_key] ?? "";
              const alternatives = alternativeResults[item.canonical_key] ?? [];
              return (
                <div className="supplier-alternative-search" key={item.canonical_key}>
                  <label>
                    <strong>{item.item_name}</strong>
                    <span>
                      <Search aria-hidden="true" size={16} />
                      <input
                        aria-label={`Sök alternativ för ${item.item_name}`}
                        value={query}
                        onChange={(event) => {
                          setAlternativeSearch((current) => ({
                            ...current,
                            [item.canonical_key]: event.target.value,
                          }));
                          setAlternativeResults((current) => ({
                            ...current,
                            [item.canonical_key]: [],
                          }));
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void searchAlternatives(item);
                        }}
                        placeholder="Sök namn eller artikelnummer"
                      />
                      <Button
                        className="text-button"
                        onPress={() => searchAlternatives(item)}
                        isDisabled={query.trim().length < 2 || searchingCanonicalKey !== null}
                      >
                        {searchingCanonicalKey === item.canonical_key ? "Söker…" : "Sök"}
                      </Button>
                    </span>
                  </label>
                  {query.trim().length >= 2
                    && searchingCanonicalKey !== item.canonical_key
                    && !alternatives.length
                    ? <small>Inga sökresultat ännu.</small>
                    : null}
                  {alternatives.map((product) => (
                    <Button
                      key={product.id}
                      className="supplier-alternative"
                      onPress={() => suggestAlternative(item, product)}
                      isDisabled={busyCandidateId !== null}
                    >
                      <span><strong>{product.display_name}</strong><small>Artikel {product.supplier_article_number} · {formatExactAmount(product.package_amount)} {product.package_unit}</small></span>
                      <ChevronRight aria-hidden="true" size={17} />
                    </Button>
                  ))}
                </div>
              );
            }) : <p className="supplier-review-empty">Alla råvaror har minst ett förslag.</p>}
          </section>
        </div>
      ) : null}
    </section>
  );
}
