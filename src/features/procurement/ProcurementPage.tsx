import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Calculator, Check, ListRestart, PackageCheck, Save, Search, ShoppingCart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "react-aria-components";
import { userFacingError } from "../../lib/userFacingError";
import { useAuth } from "../auth/AuthContext";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { SupplyExportActions } from "../supplies/SupplyExportActions";
import { SupplySyncStatus } from "../supplies/SupplySyncStatus";
import { fetchCurrentCalculation, fetchSupplyLists, generateSupplyLists, saveSupplyItem, type SupplyItemPatch, type SupplyScope } from "../supplies/supplyApi";
import {
  formatExactAmount,
  hasUnitMismatch,
  parseDecimalInput,
  practicalSupplyAmount,
  type PracticalSupplyAmount,
  type SupplyItemRow,
  type SupplyListRow,
} from "../supplies/supplyModel";
import { useOfflineSupplyState } from "../supplies/useOfflineSupplyState";
import { useTutorial } from "../tutorial/TutorialProvider";
import { SupplierAccountsPanel, SupplierMatchEditor } from "../suppliers/SupplierFoundationPanel";
import {
  SupplierCataloguePanel,
  type SupplierCatalogueCandidateView,
} from "../suppliers/SupplierCataloguePanel";
import { SupplierOrderExportActions } from "../suppliers/SupplierOrderExportActions";
import {
  approveSafeSupplierMatchCandidates,
  decideSupplierMatchCandidate,
  ensureSupplierCatalogueMatches,
  importSupplierCatalogueAndMatch,
  searchSupplierCatalogueProducts,
  suggestSupplierCatalogueAlternative,
} from "../suppliers/supplierCatalogueApi";
import {
  ensureIcaSicklaSupplierAccount,
  fetchSupplierFoundation,
  saveSupplierAccount,
  saveSupplierProductMatch,
} from "../suppliers/supplierApi";
import {
  describeSupplierPurchaseQuantity,
  proposeSupplierCandidateOrder,
  proposeSupplierOrder,
  type SupplierAccount,
  type SupplierMatchDetail,
} from "../suppliers/supplierModel";
import {
  isIcaSicklaAccount,
  isLocalIcaFixtureProduct,
  LOCAL_ICA_FIXTURE_WARNING,
} from "../suppliers/icaStore";
import { useIcaCatalogueSync } from "../suppliers/useIcaCatalogueSync";
import {
  filterProcurementItems,
  type ProcurementIcaFilter,
  type ProcurementOrderFilter,
} from "./procurementFilterModel";
import { createDistributionListOptions } from "./distributionListModel";
import "../suppliers/suppliers.css";

type Perspective = "purchase" | "distribution";

function OrderEditor({
  scope,
  listId,
  item,
  practicalRequirement,
  supplierAccounts,
  supplierDetails,
  supplierWritable,
  tutorialTarget = false,
  hidden = false,
  onSaved,
  onSupplierSaved,
}: {
  scope: SupplyScope;
  listId: string;
  item: SupplyItemRow;
  practicalRequirement: PracticalSupplyAmount;
  supplierAccounts: SupplierAccount[];
  supplierDetails: SupplierMatchDetail[];
  supplierWritable: boolean;
  tutorialTarget?: boolean;
  hidden?: boolean;
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
  const verifiedSupplierOrder = supplierDetails
    .map((detail) => ({
      detail,
      proposal: proposeSupplierOrder(item.required_amount, item.required_unit, detail),
    }))
    .find(({ detail, proposal }) =>
      proposal.status === "ready"
      && parsedAmount === proposal.purchaseUnits
      && detail.product.purchase_unit.trim().toLocaleLowerCase("sv-SE")
        === orderedUnit.trim().toLocaleLowerCase("sv-SE")
    );
  const verifiedOrderUsesFixture = verifiedSupplierOrder
    ? isLocalIcaFixtureProduct(verifiedSupplierOrder.detail.product)
    : false;

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
    <div
      hidden={hidden}
      className={`order-editor${item.source_present ? "" : " order-editor--missing"}`}
      data-tutorial-id={tutorialTarget ? "procurement-order-details" : undefined}
    >
      <div className="order-editor__identity">
        <strong>{item.item_name}</strong>
        <span className={practicalRequirement.issue ? "operational-amount--warning" : undefined}>
          Beräknat behov {practicalRequirement.display}
        </span>
        {verifiedSupplierOrder?.proposal.status === "ready" ? (
          <div className={`order-editor__supplier-summary${verifiedOrderUsesFixture ? " order-editor__supplier-summary--fixture" : ""}`}>
            {verifiedOrderUsesFixture
              ? <AlertTriangle aria-hidden="true" size={17} />
              : <PackageCheck aria-hidden="true" size={17} />}
            <span>
              <strong>
                Köp {describeSupplierPurchaseQuantity(
                  verifiedSupplierOrder.detail.product,
                  verifiedSupplierOrder.proposal.purchaseUnits,
                  verifiedSupplierOrder.detail.match.amount_per_purchase_unit,
                  verifiedSupplierOrder.detail.match.required_unit,
                )}
              </strong>
              <small>{verifiedOrderUsesFixture
                ? `${LOCAL_ICA_FIXTURE_WARNING}. Endast för lokal provkörning.`
                : `Verifierad förpackningsomräkning via ${verifiedSupplierOrder.detail.account.display_name}`}</small>
            </span>
          </div>
        ) : null}
        {!item.source_present ? <span className="missing-source">Finns inte längre i beräkningen. Dina beställningsuppgifter är sparade.</span> : null}
      </div>
      <label>Beställt antal<input name={`ordered-amount-${item.id}`} aria-label={`Beställt antal för ${item.item_name}`} inputMode="decimal" value={orderedAmount} onChange={(event) => setOrderedAmount(event.target.value)} /></label>
      <label>Beställd enhet<input name={`ordered-unit-${item.id}`} aria-label={`Beställd enhet för ${item.item_name}`} value={orderedUnit} onChange={(event) => setOrderedUnit(event.target.value)} /></label>
      <label>Förpackning<input name={`package-note-${item.id}`} value={packageNote} onChange={(event) => setPackageNote(event.target.value)} placeholder="Till exempel 2 säckar" /></label>
      <label>Kommentar<input name={`comment-${item.id}`} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Valfri kommentar" /></label>
      {(mismatch || hasUnitMismatch(item)) && !verifiedSupplierOrder ? (
        <p className="unit-warning"><AlertTriangle aria-hidden="true" size={17} /> Behovet anges i {item.required_unit} men beställningen i {orderedUnit || "en annan enhet"}. Kontrollera mängden manuellt eller välj samma enhet.</p>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Button className="secondary-button order-editor__save" onPress={save} isDisabled={saving || !item.source_present}>
        <Save aria-hidden="true" size={17} /> {saving ? "Sparar…" : "Spara beställning"}
      </Button>
      {supplierDetails.length || supplierAccounts.some((account) =>
        account.active && !isIcaSicklaAccount(account)
      ) ? <SupplierMatchEditor
        item={item}
        accounts={supplierAccounts}
        details={supplierDetails}
        online={supplierWritable}
        onSave={async (input) => {
          await saveSupplierProductMatch(scope, input);
          await onSupplierSaved();
        }}
        onApplyProposal={async (detail, proposal) => {
          await saveSupplyItem(scope, listId, item, {
            orderedAmount: proposal.purchaseUnits,
            orderedUnit: detail.product.purchase_unit,
            packageNote: isLocalIcaFixtureProduct(detail.product)
              ? `${LOCAL_ICA_FIXTURE_WARNING} · ${proposal.packageNote}`
              : proposal.packageNote,
            comment,
            completed: item.completed,
          });
          await onSaved();
        }}
      /> : null}
    </div>
  );
}

export function ProcurementPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { activeCamp, activeMembership } = useWorkspace();
  const { registerProcurement } = useTutorial();
  const [perspective, setPerspective] = useState<Perspective>("purchase");
  const [selectedDistributionId, setSelectedDistributionId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [purchaseQuery, setPurchaseQuery] = useState("");
  const [purchaseCategory, setPurchaseCategory] = useState("all");
  const [purchaseOrderFilter, setPurchaseOrderFilter] = useState<ProcurementOrderFilter>("all");
  const [purchaseIcaFilter, setPurchaseIcaFilter] = useState<ProcurementIcaFilter>("all");
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
  const icaSyncQuery = useIcaCatalogueSync(scope, purchaseList);
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
    queryFn: async () => {
      await ensureIcaSicklaSupplierAccount(scope!);
      let foundation = await fetchSupplierFoundation(scope!, purchaseCanonicalKeys);
      let generated = false;
      const catalogueWarnings: string[] = [];
      for (const account of foundation.accounts.filter((candidate) =>
        candidate.active && !isIcaSicklaAccount(candidate)
      )) {
        const outcome = await ensureSupplierCatalogueMatches(
          scope!,
          account.id,
          purchaseItems,
        );
        generated ||= outcome.generated;
        if (outcome.warning) catalogueWarnings.push(outcome.warning);
      }
      if (generated) {
        foundation = await fetchSupplierFoundation(scope!, purchaseCanonicalKeys);
      }
      return {
        ...foundation,
        catalogueWarnings: [...new Set(catalogueWarnings)],
      };
    },
  });
  const supplierAccounts = supplierQuery.data?.accounts ?? [];
  const supplierDetails = supplierQuery.data?.details ?? [];
  const supplierCandidates = supplierQuery.data?.candidates ?? [];
  const supplierColumnProfiles = supplierQuery.data?.columnProfiles ?? [];
  const approvedSupplierMatches = supplierQuery.data?.approvedMatches ?? [];
  const supplierCatalogueWarnings = [...new Set([
    ...(supplierQuery.data?.catalogueWarnings ?? []),
    ...(icaSyncQuery.data?.warning ? [icaSyncQuery.data.warning] : []),
  ])];
  const syntheticSupplierCanonicalKeys = new Set(supplierDetails
    .filter((detail) => isLocalIcaFixtureProduct(detail.product))
    .map((detail) => detail.match.canonical_key));
  const purchaseCategories = [...new Set(purchaseItems.map((item) => item.category))]
    .sort((left, right) => left.localeCompare(right, "sv"));
  const visiblePurchaseItemIds = filterProcurementItems({
    items: purchaseItems,
    query: purchaseQuery,
    category: purchaseCategory,
    orderFilter: purchaseOrderFilter,
    icaFilter: purchaseIcaFilter,
    supplierDetails,
    supplierCandidates,
    accounts: supplierAccounts,
  });
  const distributionOptions = createDistributionListOptions(
    lists,
    activeCamp?.timezone ?? "Europe/Stockholm",
  );
  const distributionLists = distributionOptions.map(({ list }) => list);
  const selectedDistributionOption = distributionOptions.find(({ list }) =>
    list.id === selectedDistributionId
  ) ?? distributionOptions[0] ?? null;
  const selectedDistribution = selectedDistributionOption?.list ?? null;
  const practicalPurchaseAmounts = new Map(purchaseItems.map((item) => [
    item.id,
    practicalSupplyAmount(item.required_amount, item.required_unit),
  ]));
  const practicalDistributionAmounts = new Map(
    distributionLists.flatMap((list) =>
      list.supply_list_items
        .filter((item) => item.source_present)
        .map((item) => [
          item.id,
          practicalSupplyAmount(item.required_amount, item.required_unit),
        ] as const)
    ),
  );
  const exportList = perspective === "purchase"
    ? purchaseList
    : selectedDistribution && selectedDistributionOption
      ? { ...selectedDistribution, title: selectedDistributionOption.label }
      : null;
  const calculation = purchaseList?.calculation_revisions ?? selectedDistribution?.calculation_revisions ?? null;
  const listUsesCurrentCalculation = calculation?.status === "current";
  const hasCurrentCalculation = Boolean(currentCalculationQuery.data)
    || listUsesCurrentCalculation;
  const listsNeedSync = Boolean(
    currentCalculationQuery.data
    && calculation
    && !listUsesCurrentCalculation,
  );
  const checkingCurrentCalculation = offlineState.online && (currentCalculationQuery.isPending || currentCalculationQuery.isFetching);
  const calculationStatusUnavailable = !hasCurrentCalculation && (Boolean(currentCalculationQuery.error) || !offlineState.online);
  const icaSupplierAccountIds = new Set(
    supplierAccounts
      .filter(isIcaSicklaAccount)
      .map((account) => account.id)
  );
  const matchedIcaCanonicalKeys = new Set(
    supplierDetails
      .filter((detail) =>
        icaSupplierAccountIds.has(detail.product.supplier_account_id)
      )
      .map((detail) => detail.match.canonical_key)
  );
  const tutorialOrderItemId = purchaseItems.find((item) =>
    item.source_present && matchedIcaCanonicalKeys.has(item.canonical_key)
  )?.id ?? null;
  const procurementTutorialReady = !listsQuery.isLoading
    && !currentCalculationQuery.isPending
    && !supplierQuery.isPending;
  const procurementMatchingAvailable = Boolean(
    purchaseList
    && listUsesCurrentCalculation
    && tutorialOrderItemId
  );

  useEffect(() => {
    registerProcurement({
      ready: procurementTutorialReady,
      matchingAvailable: procurementMatchingAvailable
    });
    return () => registerProcurement(null);
  }, [
    procurementMatchingAvailable,
    procurementTutorialReady,
    registerProcurement
  ]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["supply-lists", scope?.organizationId, scope?.campId] }),
      queryClient.invalidateQueries({ queryKey: ["current-calculation", scope?.organizationId, scope?.campId] }),
      queryClient.invalidateQueries({ queryKey: ["ica-sync-purchase-list", scope?.organizationId, scope?.campId] }),
    ]);
  }

  async function refreshSuppliers() {
    await queryClient.invalidateQueries({ queryKey: ["supplier-foundation", scope?.organizationId] });
  }

  async function applySupplierCandidateOrders(
    selectedCandidates: SupplierCatalogueCandidateView[],
  ) {
    if (!scope || !purchaseList) return;
    await Promise.all(selectedCandidates.map(async (candidate) => {
      const item = purchaseItems.find((purchaseItem) =>
        purchaseItem.canonical_key === candidate.canonicalKey
      );
      if (!item) return;
      const proposal = proposeSupplierCandidateOrder(
        item.required_amount,
        item.required_unit,
        candidate,
      );
      if (proposal.status !== "ready") return;
      await saveSupplyItem(scope, purchaseList.id, item, {
        orderedAmount: proposal.purchaseUnits,
        orderedUnit: candidate.product.purchase_unit,
        packageNote: isLocalIcaFixtureProduct(candidate.product)
          ? `${LOCAL_ICA_FIXTURE_WARNING} · ${proposal.packageNote}`
          : proposal.packageNote,
        comment: item.comment ?? "",
        completed: item.completed,
      });
    }));
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
    <section
      className="workspace-page procurement-page"
      data-tutorial-id="procurement-page"
    >
      <div className="page-heading procurement-heading">
        <div>
          <span className="eyebrow"><ShoppingCart aria-hidden="true" size={18} /> Inköpslistor</span>
          <h1>Inköp och utdelning</h1>
          <p>Behovet visar den beräknade mängden. Fyll i det du faktiskt beställer separat.</p>
        </div>
        {checkingCurrentCalculation ? (
          <Button className="primary-button" data-tutorial-id="procurement-create" isDisabled>
            <Calculator aria-hidden="true" size={19} /> Kontrollerar beräkning…
          </Button>
        ) : calculationStatusUnavailable ? (
          <Button className="primary-button" data-tutorial-id="procurement-create" isDisabled>
            <AlertTriangle aria-hidden="true" size={19} /> {offlineState.online ? "Kan inte kontrollera beräkning" : "Offline"}
          </Button>
        ) : hasCurrentCalculation ? (
          <Button className="primary-button" data-tutorial-id="procurement-create" onPress={generate} isDisabled={generating || !scope || !networkWritable}>
            <ListRestart aria-hidden="true" size={19} /> {generating ? "Uppdaterar…" : purchaseList ? "Uppdatera från beräkning" : "Skapa listor"}
          </Button>
        ) : (
          <Link to="/matsedel" className="primary-button" data-tutorial-id="procurement-create">
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
      {calculation ? (
        <p className="revision-pill">
          {listUsesCurrentCalculation
            ? <Check aria-hidden="true" size={16} />
            : <AlertTriangle aria-hidden="true" size={16} />}
          {listUsesCurrentCalculation
            ? "Bygger på den senaste beräkningen"
            : listsNeedSync
              ? "Listorna bygger på en äldre beräkning – uppdatera listorna"
              : "Beräkningen är inaktuell – räkna om mängderna"}
        </p>
      ) : null}

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
          practicalAmounts={perspective === "distribution"
            ? practicalDistributionAmounts
            : practicalPurchaseAmounts}
          syntheticSupplierCanonicalKeys={perspective === "purchase"
            ? syntheticSupplierCanonicalKeys
            : undefined}
        />
      ) : null}

      {!listsQuery.isLoading && !purchaseList ? (
        <div className="empty-state"><PackageCheck aria-hidden="true" size={34} /><h2 data-tutorial-id="procurement-review">{hasCurrentCalculation ? "Skapa listor från matsedeln" : calculationStatusUnavailable ? "Inköpslistor saknas" : "Inköpslistorna skapas efter beräkningen"}</h2><p>{hasCurrentCalculation ? "Mängderna är aktuella och redo att bli inköpslistor." : calculationStatusUnavailable ? "Anslut till databasen för att kontrollera beräkningen." : "När mängderna är uträknade kan du skapa listorna här."}</p></div>
      ) : null}

      {perspective === "purchase" && purchaseList ? (
        <>
          <SupplierAccountsPanel
            key={`supplier-accounts:${scope!.organizationId}`}
            accounts={supplierAccounts}
            online={networkWritable}
            loading={supplierQuery.isPending}
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
            loading={
              supplierQuery.isPending
              || supplierQuery.isFetching
              || icaSyncQuery.isPending
              || icaSyncQuery.isFetching
            }
            syncWarning={supplierCatalogueWarnings.join(" ") || null}
            syncProgress={icaSyncQuery.data?.icaSyncProgress ?? null}
            onRetrySync={icaSyncQuery.retryNow}
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
              await applySupplierCandidateOrders(selectedCandidates);
              await Promise.all([refreshSuppliers(), refresh()]);
            }}
            onApprove={async (candidateId) => {
              const selectedCandidate = supplierCandidates.find((candidate) =>
                candidate.id === candidateId
              );
              await decideSupplierMatchCandidate(scope!, candidateId, "accepted");
              if (selectedCandidate) {
                await applySupplierCandidateOrders([selectedCandidate]);
              }
              await Promise.all([refreshSuppliers(), refresh()]);
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
          <p className="operational-rounding-note">
            Behoven visas i praktiska inköpsmängder. Den exakta beräkningen
            ligger kvar oförändrad och används när en faktisk artikel räknas
            om till hela förpackningar.
          </p>
          <div
            className="procurement-filters"
            aria-label="Filtrera inköpslistan"
          >
            <label className="procurement-search" data-tutorial-id="procurement-review">
              <span className="sr-only">Sök råvara, kommentar eller ICA-artikel</span>
              <Search aria-hidden="true" size={20} />
              <input
                name="purchase-search"
                type="search"
                value={purchaseQuery}
                onChange={(event) => setPurchaseQuery(event.target.value)}
                placeholder="Sök råvara, kommentar eller ICA-artikel"
              />
            </label>
            <label className="field-label">Kategori
              <select name="purchase-category" value={purchaseCategory} onChange={(event) => setPurchaseCategory(event.target.value)}>
                <option value="all">Alla kategorier</option>
                {purchaseCategories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label className="field-label">Beställning
              <select name="purchase-order-status" value={purchaseOrderFilter} onChange={(event) => setPurchaseOrderFilter(event.target.value as ProcurementOrderFilter)}>
                <option value="all">Alla</option>
                <option value="not_ordered">Ej beställt</option>
                <option value="ordered">Beställt</option>
              </select>
            </label>
            <label className="field-label">ICA-status
              <select name="purchase-ica-status" value={purchaseIcaFilter} onChange={(event) => setPurchaseIcaFilter(event.target.value as ProcurementIcaFilter)}>
                <option value="all">Alla</option>
                <option value="ready">ICA-artikel klar</option>
                <option value="review">ICA behöver granskas</option>
                <option value="missing">ICA saknas</option>
              </select>
            </label>
          </div>
          {visiblePurchaseItemIds.size === 0 ? <p className="procurement-filter-empty">Inga varor matchar filtret.</p> : null}
          <div className="order-grid">
            {purchaseItems.map((item) => (
              <OrderEditor
                key={`${item.id}:${item.row_version}`}
                scope={scope!}
                listId={purchaseList.id}
                item={item}
                practicalRequirement={practicalPurchaseAmounts.get(item.id)
                  ?? practicalSupplyAmount(item.required_amount, item.required_unit)}
                supplierAccounts={supplierAccounts}
                supplierDetails={supplierDetails.filter((detail) => detail.match.canonical_key === item.canonical_key)}
                supplierWritable={networkWritable}
                tutorialTarget={item.id === tutorialOrderItemId}
                hidden={!visiblePurchaseItemIds.has(item.id)}
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
              {distributionOptions.map(({ list, label }) => (
                <option key={list.id} value={list.id}>{label}</option>
              ))}
            </select>
          </label>
          <p className="distribution-rounding-note">
            Varje matlag får en praktiskt avrundad mängd som går att använda.
            Förpackningar räknas globalt först när en ICA-artikel väljs och
            räknas om om varan byts.
          </p>
          <div className="distribution-table" role="table" aria-label={selectedDistributionOption?.label}>
            {itemsFor(selectedDistribution).filter((item) => item.source_present).map((item) => {
              const practical = practicalDistributionAmounts.get(item.id)
                ?? practicalSupplyAmount(item.required_amount, item.required_unit);
              return (
                <div className="distribution-row" role="row" key={item.id}>
                  <span role="cell">{item.item_name}</span>
                  <strong
                    className={practical.issue ? "distribution-amount--warning" : undefined}
                    role="cell"
                  >
                    {practical.display}
                  </strong>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
