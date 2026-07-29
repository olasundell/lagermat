import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Calculator, Check, ListRestart, PackageCheck, Save, ShoppingCart } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "react-aria-components";
import { userFacingError } from "../../lib/userFacingError";
import { useAuth } from "../auth/AuthContext";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { SupplyExportActions } from "../supplies/SupplyExportActions";
import { SupplySyncStatus } from "../supplies/SupplySyncStatus";
import { fetchCurrentCalculation, fetchSupplyLists, generateSupplyLists, saveSupplyItem, type SupplyItemPatch, type SupplyScope } from "../supplies/supplyApi";
import { formatExactAmount, hasUnitMismatch, parseDecimalInput, type SupplyItemRow, type SupplyListRow } from "../supplies/supplyModel";
import { useOfflineSupplyState } from "../supplies/useOfflineSupplyState";
import { SupplierAccountsPanel, SupplierMatchEditor } from "../suppliers/SupplierFoundationPanel";
import { SupplierCataloguePanel } from "../suppliers/SupplierCataloguePanel";
import { SupplierOrderExportActions } from "../suppliers/SupplierOrderExportActions";
import {
  approveSafeSupplierMatchCandidates,
  decideSupplierMatchCandidate,
  importSupplierCatalogueAndMatch,
  searchSupplierCatalogueProducts,
  suggestSupplierCatalogueAlternative,
} from "../suppliers/supplierCatalogueApi";
import {
  fetchSupplierFoundation,
  saveSupplierAccount,
  saveSupplierProductMatch,
} from "../suppliers/supplierApi";
import type { SupplierAccount, SupplierMatchDetail } from "../suppliers/supplierModel";
import "../suppliers/suppliers.css";

type Perspective = "purchase" | "distribution";

function OrderEditor({
  scope,
  listId,
  item,
  supplierAccounts,
  supplierDetails,
  supplierWritable,
  onSaved,
  onSupplierSaved,
}: {
  scope: SupplyScope;
  listId: string;
  item: SupplyItemRow;
  supplierAccounts: SupplierAccount[];
  supplierDetails: SupplierMatchDetail[];
  supplierWritable: boolean;
  onSaved: () => Promise<void>;
  onSupplierSaved: () => Promise<void>;
}) {
  const [orderedAmount, setOrderedAmount] = useState(item.ordered_amount === null ? "" : formatExactAmount(item.ordered_amount));
  const [orderedUnit, setOrderedUnit] = useState(item.ordered_unit ?? item.required_unit);
  const [packageNote, setPackageNote] = useState(item.package_note ?? "");
  const [comment, setComment] = useState(item.comment ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedAmount = parseDecimalInput(orderedAmount);
  const mismatch = parsedAmount !== null && !Number.isNaN(parsedAmount)
    && orderedUnit.trim().toLocaleLowerCase("sv-SE") !== item.required_unit.trim().toLocaleLowerCase("sv-SE");

  async function save() {
    if (Number.isNaN(parsedAmount)) {
      setError("Ange ett positivt decimaltal med punkt eller komma.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const patch: SupplyItemPatch = {
        orderedAmount: parsedAmount,
        orderedUnit,
        packageNote,
        comment,
        completed: item.completed
      };
      await saveSupplyItem(scope, listId, item, patch);
      await onSaved();
    } catch (caught) {
      setError(userFacingError(caught, "Beställningen kunde inte sparas."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`order-editor${item.source_present ? "" : " order-editor--missing"}`}>
      <div className="order-editor__identity">
        <strong>{item.item_name}</strong>
        <span>Beräknat behov {formatExactAmount(item.required_amount)} {item.required_unit}</span>
        {!item.source_present ? <span className="missing-source">Finns inte längre i beräkningen. Dina beställningsuppgifter är sparade.</span> : null}
      </div>
      <label>Beställt antal<input name={`ordered-amount-${item.id}`} aria-label={`Beställt antal för ${item.item_name}`} inputMode="decimal" value={orderedAmount} onChange={(event) => setOrderedAmount(event.target.value)} /></label>
      <label>Beställd enhet<input name={`ordered-unit-${item.id}`} aria-label={`Beställd enhet för ${item.item_name}`} value={orderedUnit} onChange={(event) => setOrderedUnit(event.target.value)} /></label>
      <label>Förpackning<input name={`package-note-${item.id}`} value={packageNote} onChange={(event) => setPackageNote(event.target.value)} placeholder="Till exempel 2 säckar" /></label>
      <label>Kommentar<input name={`comment-${item.id}`} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Valfri kommentar" /></label>
      {mismatch || hasUnitMismatch(item) ? (
        <p className="unit-warning"><AlertTriangle aria-hidden="true" size={17} /> Behovet anges i {item.required_unit} men beställningen i {orderedUnit || "en annan enhet"}. Kontrollera mängden manuellt eller välj samma enhet.</p>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Button className="secondary-button order-editor__save" onPress={save} isDisabled={saving || !item.source_present}>
        <Save aria-hidden="true" size={17} /> {saving ? "Sparar…" : "Spara beställning"}
      </Button>
      <SupplierMatchEditor
        item={item}
        accounts={supplierAccounts}
        details={supplierDetails}
        online={supplierWritable}
        onSave={async (input) => {
          await saveSupplierProductMatch(scope, input);
          await onSupplierSaved();
        }}
        onApplyProposal={async (proposal) => {
          await saveSupplyItem(scope, listId, item, {
            orderedAmount: proposal.orderedAmount,
            orderedUnit: item.required_unit,
            packageNote: proposal.packageNote,
            comment,
            completed: item.completed,
          });
          await onSaved();
        }}
      />
    </div>
  );
}

export function ProcurementPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { activeCamp, activeMembership } = useWorkspace();
  const [perspective, setPerspective] = useState<Perspective>("purchase");
  const [selectedDistributionId, setSelectedDistributionId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const scope = useMemo(() => activeCamp && activeMembership && user
    ? { userId: user.id, organizationId: activeMembership.organizationId, campId: activeCamp.id }
    : null, [activeCamp, activeMembership, user]);
  const offlineState = useOfflineSupplyState(scope);

  const listsQuery = useQuery({
    queryKey: ["supply-lists", scope?.organizationId, scope?.campId],
    enabled: Boolean(scope),
    networkMode: "always",
    queryFn: () => fetchSupplyLists(scope!, ["purchase", "distribution", "delivery"])
  });
  const currentCalculationQuery = useQuery({
    queryKey: ["current-calculation", scope?.organizationId, scope?.campId],
    enabled: Boolean(scope && offlineState.online),
    queryFn: () => fetchCurrentCalculation(scope!)
  });
  const lists = listsQuery.data?.lists ?? [];
  const cached = listsQuery.data?.source === "cache";
  const networkWritable = offlineState.online && !cached && offlineState.pending === 0 && offlineState.conflicts.length === 0;
  const purchaseList = lists.find((list) => list.kind === "purchase") ?? null;
  const purchaseItems = itemsFor(purchaseList);
  const purchaseCanonicalKeys = purchaseItems
    .filter((item) => item.source_present)
    .map((item) => item.canonical_key);
  const supplierQuery = useQuery({
    queryKey: [
      "supplier-foundation",
      scope?.organizationId,
      purchaseList?.id,
      purchaseList?.version,
    ],
    enabled: Boolean(scope && purchaseList && offlineState.online && !cached),
    queryFn: () => fetchSupplierFoundation(scope!, purchaseCanonicalKeys)
  });
  const supplierAccounts = supplierQuery.data?.accounts ?? [];
  const supplierDetails = supplierQuery.data?.details ?? [];
  const supplierCandidates = supplierQuery.data?.candidates ?? [];
  const supplierColumnProfiles = supplierQuery.data?.columnProfiles ?? [];
  const approvedSupplierMatches = supplierQuery.data?.approvedMatches ?? [];
  const distributionLists = lists.filter((list) => list.kind === "distribution");
  const selectedDistribution = distributionLists.find((list) => list.id === selectedDistributionId) ?? distributionLists[0] ?? null;
  const exportList = perspective === "purchase" ? purchaseList : selectedDistribution;
  const calculation = purchaseList?.calculation_revisions ?? selectedDistribution?.calculation_revisions ?? null;
  const hasCurrentCalculation = Boolean(currentCalculationQuery.data) || calculation?.status === "current";
  const checkingCurrentCalculation = offlineState.online && (currentCalculationQuery.isPending || currentCalculationQuery.isFetching);
  const calculationStatusUnavailable = !hasCurrentCalculation && (Boolean(currentCalculationQuery.error) || !offlineState.online);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["supply-lists", scope?.organizationId, scope?.campId] }),
      queryClient.invalidateQueries({ queryKey: ["current-calculation", scope?.organizationId, scope?.campId] })
    ]);
  }

  async function refreshSuppliers() {
    await queryClient.invalidateQueries({ queryKey: ["supplier-foundation", scope?.organizationId] });
  }

  async function generate() {
    if (!scope) return;
    setGenerating(true);
    setMessage(null);
    try {
      await generateSupplyLists(scope);
      await refresh();
      setMessage({ kind: "success", text: "Listorna uppdaterades från matsedeln. Dina beställningar och kommentarer är kvar." });
    } catch (caught) {
      setMessage({ kind: "error", text: userFacingError(caught, "Listorna kunde inte skapas.") });
    } finally {
      setGenerating(false);
    }
  }

  function itemsFor(list: SupplyListRow | null): SupplyItemRow[] {
    return [...(list?.supply_list_items ?? [])].sort((a, b) => a.category.localeCompare(b.category, "sv") || a.item_name.localeCompare(b.item_name, "sv"));
  }

  return (
    <section className="workspace-page procurement-page">
      <div className="page-heading procurement-heading">
        <div>
          <span className="eyebrow"><ShoppingCart aria-hidden="true" size={18} /> Inköpslistor</span>
          <h1>Inköp och utdelning</h1>
          <p>Behovet visar den beräknade mängden. Fyll i det du faktiskt beställer separat.</p>
        </div>
        {checkingCurrentCalculation ? (
          <Button className="primary-button" isDisabled>
            <Calculator aria-hidden="true" size={19} /> Kontrollerar beräkning…
          </Button>
        ) : calculationStatusUnavailable ? (
          <Button className="primary-button" isDisabled>
            <AlertTriangle aria-hidden="true" size={19} /> {offlineState.online ? "Kan inte kontrollera beräkning" : "Offline"}
          </Button>
        ) : hasCurrentCalculation ? (
          <Button className="primary-button" onPress={generate} isDisabled={generating || !scope || !networkWritable}>
            <ListRestart aria-hidden="true" size={19} /> {generating ? "Uppdaterar…" : purchaseList ? "Uppdatera från beräkning" : "Skapa listor"}
          </Button>
        ) : (
          <Link to="/matsedel" className="primary-button">
            <Calculator aria-hidden="true" size={19} /> Räkna ut mängder
          </Link>
        )}
      </div>

      {message ? <p className={`inline-message inline-message--${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p> : null}
      {listsQuery.error ? <p className="inline-message inline-message--error" role="alert">{userFacingError(listsQuery.error, "Inköpslistorna kunde inte läsas.")}</p> : null}
      {currentCalculationQuery.error ? <p className="inline-message inline-message--error" role="alert">{userFacingError(currentCalculationQuery.error, "Det gick inte att kontrollera mängdberäkningen.")}</p> : null}
      {!checkingCurrentCalculation && !hasCurrentCalculation && !currentCalculationQuery.error && offlineState.online ? (
        <div className="calculation-required" role="status">
          <AlertTriangle aria-hidden="true" size={20} />
          <div><strong>Det finns ingen aktuell mängdberäkning.</strong><p>Räkna ut mängderna i Matsedel innan du skapar inköpslistor.</p></div>
        </div>
      ) : null}
      {scope ? <SupplySyncStatus scope={scope} state={offlineState} cached={cached} cachedAt={listsQuery.data?.cachedAt ?? null} onRefresh={refresh} /> : null}
      {calculation ? <p className="revision-pill">{calculation.status === "current" ? <Check aria-hidden="true" size={16} /> : <AlertTriangle aria-hidden="true" size={16} />}{calculation.status === "current" ? "Bygger på den senaste beräkningen" : "Bygger på en äldre beräkning – räkna om mängderna"}</p> : null}

      <div className="perspective-tabs" aria-label="Listperspektiv">
        <Button aria-pressed={perspective === "purchase"} className={perspective === "purchase" ? "is-selected" : ""} onPress={() => setPerspective("purchase")}>Hela lägret</Button>
        <Button aria-pressed={perspective === "distribution"} className={perspective === "distribution" ? "is-selected" : ""} onPress={() => setPerspective("distribution")}>Per måltid och matlag</Button>
      </div>

      {scope && exportList && activeMembership && activeCamp ? (
        <SupplyExportActions
          scope={scope}
          list={exportList}
          organizationName={activeMembership.organizationName}
          campName={activeCamp.name}
          timeZone={activeCamp.timezone}
          disabled={!networkWritable}
        />
      ) : null}

      {!listsQuery.isLoading && !purchaseList ? (
        <div className="empty-state"><PackageCheck aria-hidden="true" size={34} /><h2>{hasCurrentCalculation ? "Skapa listor från matsedeln" : calculationStatusUnavailable ? "Inköpslistor saknas" : "Inköpslistorna skapas efter beräkningen"}</h2><p>{hasCurrentCalculation ? "Mängderna är aktuella och redo att bli inköpslistor." : calculationStatusUnavailable ? "Anslut till databasen för att kontrollera beräkningen." : "När mängderna är uträknade kan du skapa listorna här."}</p></div>
      ) : null}

      {perspective === "purchase" && purchaseList ? (
        <>
          <SupplierAccountsPanel
            key={`supplier-accounts:${scope!.organizationId}`}
            accounts={supplierAccounts}
            online={networkWritable}
            loading={supplierQuery.isPending || supplierQuery.isFetching}
            onSave={async (input) => {
              await saveSupplierAccount(scope!, input);
              await refreshSuppliers();
            }}
          />
          <SupplierCataloguePanel
            accounts={supplierAccounts}
            items={purchaseItems}
            candidates={supplierCandidates}
            approvedMatches={approvedSupplierMatches}
            columnProfiles={supplierColumnProfiles}
            online={networkWritable}
            loading={supplierQuery.isPending || supplierQuery.isFetching}
            onImport={async (supplierAccountId, preview, mapping) => {
              const result = await importSupplierCatalogueAndMatch(
                scope!,
                supplierAccountId,
                preview,
                mapping,
                purchaseItems,
              );
              await refreshSuppliers();
              return result;
            }}
            onApproveSafe={async (candidateIds) => {
              const selectedCandidates = supplierCandidates.filter((candidate) =>
                candidateIds.includes(candidate.id)
              );
              const supplierAccountId = selectedCandidates[0]?.supplierAccountId;
              if (
                !supplierAccountId
                || selectedCandidates.some((candidate) =>
                  candidate.supplierAccountId !== supplierAccountId
                )
              ) {
                throw new Error("De säkra förslagen måste höra till samma leverantör.");
              }
              await approveSafeSupplierMatchCandidates(
                scope!,
                supplierAccountId,
                candidateIds,
              );
              await refreshSuppliers();
            }}
            onApprove={async (candidateId) => {
              await decideSupplierMatchCandidate(scope!, candidateId, "accepted");
              await refreshSuppliers();
            }}
            onReject={async (candidateId) => {
              await decideSupplierMatchCandidate(scope!, candidateId, "rejected");
              await refreshSuppliers();
            }}
            onSuggestAlternative={async (item, product) => {
              const account = supplierAccounts.find((candidate) =>
                candidate.id === product.supplier_account_id
              );
              if (!account) throw new Error("Leverantörskontot kunde inte hittas.");
              await suggestSupplierCatalogueAlternative(
                scope!,
                account,
                item,
                product,
              );
              await refreshSuppliers();
            }}
            onSearchAlternatives={(supplierAccountId, query) =>
              searchSupplierCatalogueProducts(scope!, supplierAccountId, query)}
          />
          {activeMembership && activeCamp ? (
            <SupplierOrderExportActions
              key={`supplier-export:${scope!.organizationId}`}
              scope={scope!}
              list={purchaseList}
              accounts={supplierAccounts}
              details={supplierDetails}
              organizationName={activeMembership.organizationName}
              campName={activeCamp.name}
              disabled={!networkWritable}
            />
          ) : null}
          {supplierQuery.error ? <p className="inline-message inline-message--error" role="alert">{userFacingError(supplierQuery.error, "Leverantörsdata kunde inte läsas.")}</p> : null}
          <div className="order-grid">
            {purchaseItems.map((item) => (
              <OrderEditor
                key={`${item.id}:${item.row_version}`}
                scope={scope!}
                listId={purchaseList.id}
                item={item}
                supplierAccounts={supplierAccounts}
                supplierDetails={supplierDetails.filter((detail) => detail.match.canonical_key === item.canonical_key)}
                supplierWritable={networkWritable}
                onSaved={refresh}
                onSupplierSaved={refreshSuppliers}
              />
            ))}
          </div>
        </>
      ) : null}

      {perspective === "distribution" && distributionLists.length ? (
        <div className="distribution-view">
          <label className="field-label">Måltid och matlag
            <select name="distribution-list" value={selectedDistribution?.id ?? ""} onChange={(event) => setSelectedDistributionId(event.target.value)}>
              {distributionLists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}
            </select>
          </label>
          <div className="distribution-table" role="table" aria-label={selectedDistribution?.title}>
            {itemsFor(selectedDistribution).filter((item) => item.source_present).map((item) => (
              <div className="distribution-row" role="row" key={item.id}>
                <span role="cell">{item.item_name}</span>
                <strong role="cell">{formatExactAmount(item.required_amount)} {item.required_unit}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
