import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Calculator,
  Check,
  ChevronDown,
  ChevronUp,
  ListRestart,
  LoaderCircle,
  MapPin,
  Search,
  Truck
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "react-aria-components";
import { userFacingError } from "../../lib/userFacingError";
import { useAuth } from "../auth/AuthContext";
import { SupplyExportActions } from "../supplies/SupplyExportActions";
import { SupplySyncStatus } from "../supplies/SupplySyncStatus";
import {
  changeSupplyListStatus,
  fetchCurrentCalculation,
  fetchSupplyExportReadiness,
  fetchSupplyLists,
  generateSupplyLists,
  moveDeliveryItem,
  saveSupplyItem,
  type SupplyItemPatch,
  type SupplyScope
} from "../supplies/supplyApi";
import {
  deliveryItemOrigin,
  deliveryItemSource,
  filterSupplyItems,
  formatCountedAmount,
  formatExactAmount,
  groupSupplyItems,
  hasUnitMismatch,
  manualPurchaseAllocationExplanation,
  parseDecimalInput,
  practicalSupplyAmount,
  type SupplyFilter,
  type SupplyItemRow,
  type SupplyListRow
} from "../supplies/supplyModel";
import { useOfflineSupplyState } from "../supplies/useOfflineSupplyState";
import { useWorkspace } from "../workspace/WorkspaceContext";

function dateLabel(value: string | null, timeZone: string): string {
  if (!value) return "Datum saknas";
  return new Intl.DateTimeFormat("sv-SE", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(new Date(value));
}

function DeliveryDetails({
  item,
  deliveries,
  activeDeliveryId,
  scope,
  canMove,
  onRefresh
}: {
  item: SupplyItemRow;
  deliveries: SupplyListRow[];
  activeDeliveryId: string;
  scope: SupplyScope;
  canMove: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [orderedAmount, setOrderedAmount] = useState(item.ordered_amount === null ? "" : formatExactAmount(item.ordered_amount));
  const [orderedUnit, setOrderedUnit] = useState(item.ordered_unit ?? item.required_unit);
  const [orderedUnitTouched, setOrderedUnitTouched] = useState(false);
  const [packageNote, setPackageNote] = useState(item.package_note ?? "");
  const [comment, setComment] = useState(item.comment ?? "");
  const [targetDeliveryId, setTargetDeliveryId] = useState(activeDeliveryId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedAmount = parseDecimalInput(orderedAmount);
  const origin = deliveryItemOrigin(item, deliveries);
  const mismatch = parsedAmount !== null && !Number.isNaN(parsedAmount)
    && orderedUnit.trim().toLocaleLowerCase("sv-SE") !== item.required_unit.trim().toLocaleLowerCase("sv-SE");

  function formPatch(): SupplyItemPatch | null {
    if (Number.isNaN(parsedAmount)) {
      setError("Ange ett positivt decimaltal med punkt eller komma.");
      return null;
    }
    return {
      orderedAmount: parsedAmount,
      orderedUnit: item.ordered_unit === null
        && parsedAmount === null
        && !orderedUnitTouched
        ? ""
        : orderedUnit,
      packageNote,
      comment,
      completed: item.completed
    };
  }

  async function save() {
    const patch = formPatch();
    if (!patch) return;
    setSaving(true);
    setError(null);
    try {
      await saveSupplyItem(scope, activeDeliveryId, item, patch);
      await onRefresh();
    } catch (caught) {
      setError(userFacingError(caught, "Beställningen kunde inte sparas."));
    } finally {
      setSaving(false);
    }
  }

  async function move() {
    if (!targetDeliveryId || targetDeliveryId === activeDeliveryId) return;
    const patch = formPatch();
    if (!patch) return;
    setSaving(true);
    setError(null);
    try {
      await moveDeliveryItem(item, targetDeliveryId, patch);
      await onRefresh();
    } catch (caught) {
      setError(userFacingError(caught, "Varan kunde inte flyttas."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="delivery-item__details">
      <label>Beställt antal<input name={`delivery-ordered-amount-${item.id}`} inputMode="decimal" aria-label={`Beställt antal för ${item.item_name}`} value={orderedAmount} onChange={(event) => setOrderedAmount(event.target.value)} /></label>
      <label>Beställd enhet<input name={`delivery-ordered-unit-${item.id}`} aria-label={`Beställd enhet för ${item.item_name}`} value={orderedUnit} onChange={(event) => { setOrderedUnit(event.target.value); setOrderedUnitTouched(true); }} /></label>
      <label>Förpackning<input name={`delivery-package-note-${item.id}`} value={packageNote} onChange={(event) => setPackageNote(event.target.value)} placeholder="Till exempel 1 säck" /></label>
      <label>Kommentar<input name={`delivery-comment-${item.id}`} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Lägg till kommentar" /></label>
      {deliveries.length > 1 ? (
        <label>Flytta till leverans
          <select name={`move-delivery-${item.id}`} value={targetDeliveryId} onChange={(event) => setTargetDeliveryId(event.target.value)} disabled={saving || !canMove}>
            {deliveries.map((delivery) => <option key={delivery.id} value={delivery.id} disabled={delivery.id !== activeDeliveryId && delivery.status === "complete"}>{delivery.title}{delivery.status === "complete" ? " (klar)" : ""}</option>)}
          </select>
        </label>
      ) : null}
      {deliveries.length > 1 && !canMove ? <p className="offline-operation-note">Spara väntande ändringar och anslut till databasen innan du flyttar varan.</p> : null}
      {mismatch || hasUnitMismatch(item) ? <p className="unit-warning"><AlertTriangle aria-hidden="true" size={17} /> Behovet anges i {item.required_unit} men beställningen i {orderedUnit || "en annan enhet"}. Kontrollera mängden manuellt eller välj samma enhet.</p> : null}
      {item.manually_moved ? (
        <p className="delivery-move-origin"><MapPin aria-hidden="true" size={16} /> {origin
          ? <>Flyttad från <strong>{origin.title}</strong>. Ursprungsbehovet behåller sin identitet.</>
          : <>Flyttad manuellt. Ursprungsbehovet behåller sin identitet.</>}</p>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="delivery-item__detail-actions">
        <Button className="secondary-button" onPress={save} isDisabled={saving}>
          {saving ? <LoaderCircle className="spin" aria-hidden="true" size={17} /> : <Check aria-hidden="true" size={17} />} {saving ? "Sparar…" : "Spara beställning"}
        </Button>
        {targetDeliveryId !== activeDeliveryId ? (
          <Button className="primary-button" onPress={move} isDisabled={saving || !canMove}>
            <MapPin aria-hidden="true" size={17} /> Spara och flytta
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function DeliveriesPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { activeCamp, activeMembership } = useWorkspace();
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [filter, setFilter] = useState<SupplyFilter>("all");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
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
  const deliveries = lists.filter((list) => list.kind === "delivery");
  const purchaseItems = lists
    .filter((list) => list.kind === "purchase" && list.source_present)
    .flatMap((list) => list.supply_list_items);
  const practicalDeliveryAmounts = new Map(
    deliveries.flatMap((list) =>
      list.supply_list_items
        .filter((item) => item.source_present)
        .map((item) => [
          item.id,
          practicalSupplyAmount(item.required_amount, item.required_unit),
        ] as const)
    ),
  );
  const cached = listsQuery.data?.source === "cache";
  const networkWritable = offlineState.online && !cached && offlineState.pending === 0 && offlineState.conflicts.length === 0;
  const selectedDelivery = deliveries.find((list) => list.id === selectedDeliveryId)
    ?? deliveries.find((list) => list.status !== "complete")
    ?? deliveries[0]
    ?? null;
  const readinessQuery = useQuery({
    queryKey: ["supply-export-readiness", scope?.organizationId, scope?.campId],
    enabled: Boolean(scope && selectedDelivery?.status !== "complete" && networkWritable),
    queryFn: () => fetchSupplyExportReadiness(scope!)
  });
  const deliveryUsesCurrentCalculation =
    selectedDelivery?.calculation_revisions?.status === "current";
  const hasCurrentCalculation = Boolean(currentCalculationQuery.data)
    || deliveryUsesCurrentCalculation;
  const deliveryNeedsSync = Boolean(
    currentCalculationQuery.data
    && selectedDelivery
    && !deliveryUsesCurrentCalculation,
  );
  const checkingCurrentCalculation = offlineState.online
    && (currentCalculationQuery.isPending || currentCalculationQuery.isFetching);
  const calculationStatusUnavailable = !hasCurrentCalculation
    && (Boolean(currentCalculationQuery.error) || !offlineState.online);
  const currentItems = [...(selectedDelivery?.supply_list_items ?? [])]
    .filter((item) => item.source_present)
    .sort((a, b) => a.category.localeCompare(b.category, "sv") || a.item_name.localeCompare(b.item_name, "sv"));
  const visibleItems = filterSupplyItems(currentItems, filter, query);
  const grouped = groupSupplyItems(visibleItems);
  const done = currentItems.filter((item) => item.completed).length;
  const remaining = currentItems.length - done;
  const duplicateCanonicalKeys = new Set(
    [...currentItems.reduce((counts, item) => {
      counts.set(item.canonical_key, (counts.get(item.canonical_key) ?? 0) + 1);
      return counts;
    }, new Map<string, number>())]
      .filter(([, count]) => count > 1)
      .map(([canonicalKey]) => canonicalKey),
  );
  const allCurrentDeliveryItems = deliveries.flatMap((delivery) =>
    delivery.supply_list_items.filter((item) => item.source_present),
  );
  const unallocatedGlobalOrders = purchaseItems.flatMap((purchaseItem) => {
    if (purchaseItem.order_source_kind !== "manual"
      || purchaseItem.ordered_amount === null
      || !purchaseItem.ordered_unit) return [];
    const relevantDeliveryItems = allCurrentDeliveryItems.filter(
      (deliveryItem) => deliveryItem.canonical_key === purchaseItem.canonical_key,
    );
    return relevantDeliveryItems.some((deliveryItem) => deliveryItem.ordered_amount === null) ? [{
      id: purchaseItem.id,
      itemName: purchaseItem.item_name,
      orderedAmount: purchaseItem.ordered_amount,
      orderedUnit: purchaseItem.ordered_unit,
    }] : [];
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["supply-lists", scope?.organizationId, scope?.campId] }),
      queryClient.invalidateQueries({ queryKey: ["current-calculation", scope?.organizationId, scope?.campId] }),
      queryClient.invalidateQueries({ queryKey: ["supply-export-readiness", scope?.organizationId, scope?.campId] })
    ]);
  }

  async function generate() {
    if (!scope || !hasCurrentCalculation) return;
    setGenerating(true);
    setMessage(null);
    try {
      await generateSupplyLists(scope);
      await refresh();
      setMessage({ kind: "success", text: "Leveranserna är uppdaterade utifrån matsedeln." });
    } catch (caught) {
      setMessage({ kind: "error", text: userFacingError(caught, "Leveranserna kunde inte skapas.") });
    } finally {
      setGenerating(false);
    }
  }

  async function toggleItem(item: SupplyItemRow) {
    if (!scope || !selectedDelivery) return;
    setSavingId(item.id);
    setMessage(null);
    try {
      await saveSupplyItem(scope, selectedDelivery.id, item, {
        orderedAmount: item.ordered_amount,
        orderedUnit: item.ordered_unit ?? "",
        packageNote: item.package_note ?? "",
        comment: item.comment ?? "",
        completed: !item.completed
      });
      await refresh();
    } catch (caught) {
      setMessage({ kind: "error", text: userFacingError(caught, "Checklistan kunde inte sparas.") });
    } finally {
      setSavingId(null);
    }
  }

  async function completeDelivery() {
    if (!scope || !selectedDelivery || !networkWritable) return;
    setCompleting(true);
    setMessage(null);
    try {
      const readinessResult = await readinessQuery.refetch();
      if (readinessResult.error) {
        setMessage({
          kind: "error",
          text: userFacingError(readinessResult.error, "Det gick inte att kontrollera om lägret är redo.")
        });
        return;
      }
      if (!readinessResult.data?.canFinalize) return;
      await changeSupplyListStatus(selectedDelivery, "complete");
      await refresh();
      setMessage({ kind: "success", text: "Leveransen är markerad som klar." });
    } catch (caught) {
      setMessage({ kind: "error", text: userFacingError(caught, "Leveransen kunde inte markeras som klar.") });
    } finally {
      setCompleting(false);
    }
  }

  if (!selectedDelivery) {
    return (
      <section className="workspace-page delivery-empty-page">
        {scope ? <SupplySyncStatus scope={scope} state={offlineState} cached={cached} cachedAt={listsQuery.data?.cachedAt ?? null} onRefresh={refresh} /> : null}
        <div className="empty-state">
          <Truck aria-hidden="true" size={38} />
          <h1>Inga leveranser ännu</h1>
          <p>Appen föreslår leveransdagar utifrån matsedeln.</p>
          {checkingCurrentCalculation ? (
            <Button className="primary-button" isDisabled><Calculator aria-hidden="true" size={17} /> Kontrollerar beräkning…</Button>
          ) : calculationStatusUnavailable ? (
            <Button className="primary-button" isDisabled><AlertTriangle aria-hidden="true" size={17} /> {offlineState.online ? "Kan inte kontrollera beräkning" : "Offline"}</Button>
          ) : hasCurrentCalculation ? (
            <Button className="primary-button" onPress={generate} isDisabled={generating || !scope || !networkWritable}>{generating ? "Skapar…" : "Skapa leveranser"}</Button>
          ) : (
            <Link to="/matsedel" className="primary-button"><Calculator aria-hidden="true" size={17} /> Räkna ut mängder</Link>
          )}
          {message ? <p className={`inline-message inline-message--${message.kind}`}>{message.text}</p> : null}
        </div>
        {currentCalculationQuery.error ? <p className="inline-message inline-message--error" role="alert">{userFacingError(currentCalculationQuery.error, "Det gick inte att kontrollera mängdberäkningen.")}</p> : null}
        {!checkingCurrentCalculation && !hasCurrentCalculation && !currentCalculationQuery.error && offlineState.online ? (
          <div className="calculation-required" role="status">
            <AlertTriangle aria-hidden="true" size={20} />
            <div><strong>Det finns ingen aktuell mängdberäkning.</strong><p>Räkna ut mängderna i Matsedel innan du skapar leveranser.</p></div>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="delivery-page">
      <div className="delivery-content">
        <div className="delivery-breadcrumb">{activeMembership?.organizationName} <span>·</span> {activeCamp?.name}</div>
        <div className="page-heading delivery-heading">
          <div>
            <h1>{selectedDelivery.title}</h1>
            <p>
              {dateLabel(selectedDelivery.range_start, activeCamp?.timezone ?? "Europe/Stockholm")}
              {" · "}
              {currentItems.length} {currentItems.length === 1 ? "vara" : "varor"}
              {" · "}
              {deliveryUsesCurrentCalculation
                ? "senaste mängderna"
                : deliveryNeedsSync
                  ? "listan behöver uppdateras"
                  : "mängderna behöver räknas om"}
            </p>
          </div>
          {checkingCurrentCalculation ? (
            <Button className="secondary-button" isDisabled><Calculator aria-hidden="true" size={17} /> Kontrollerar beräkning…</Button>
          ) : calculationStatusUnavailable ? (
            <Button className="secondary-button" isDisabled><AlertTriangle aria-hidden="true" size={17} /> {offlineState.online ? "Kan inte kontrollera beräkning" : "Offline"}</Button>
          ) : hasCurrentCalculation ? (
            <Button className="secondary-button" onPress={generate} isDisabled={generating || !networkWritable}><ListRestart aria-hidden="true" size={17} /> {generating ? "Uppdaterar…" : "Uppdatera"}</Button>
          ) : (
            <Link to="/matsedel" className="secondary-button"><Calculator aria-hidden="true" size={17} /> Räkna ut mängder</Link>
          )}
        </div>

        {message ? <p className={`inline-message inline-message--${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p> : null}
        {currentCalculationQuery.error ? <p className="inline-message inline-message--error" role="alert">{userFacingError(currentCalculationQuery.error, "Det gick inte att kontrollera mängdberäkningen.")}</p> : null}
        {!checkingCurrentCalculation && !hasCurrentCalculation && !currentCalculationQuery.error && offlineState.online ? (
          <div className="calculation-required" role="status">
            <AlertTriangle aria-hidden="true" size={20} />
            <div><strong>Det finns ingen aktuell mängdberäkning.</strong><p>Räkna ut mängderna i Matsedel innan du uppdaterar leveranserna.</p></div>
          </div>
        ) : null}
        {scope ? <SupplySyncStatus scope={scope} state={offlineState} cached={cached} cachedAt={listsQuery.data?.cachedAt ?? null} onRefresh={refresh} /> : null}
        {unallocatedGlobalOrders.length > 0 ? (
          <div className="manual-allocation-warning" role="status">
            <AlertTriangle aria-hidden="true" size={20} />
            <div>
              <strong>En global beställning behöver fördelas manuellt.</strong>
              <p>{unallocatedGlobalOrders.map((order) =>
                `${formatCountedAmount(order.orderedAmount, order.orderedUnit)} ${order.itemName}`,
              ).join(", ")}. Kontrollera enheterna eller fördela mängden mellan leveranserna.</p>
            </div>
          </div>
        ) : null}
        {scope && activeMembership && activeCamp ? (
          <SupplyExportActions
            scope={scope}
            list={selectedDelivery}
            organizationName={activeMembership.organizationName}
            campName={activeCamp.name}
            timeZone={activeCamp.timezone}
            disabled={!networkWritable || !hasCurrentCalculation}
            practicalAmounts={practicalDeliveryAmounts}
          />
        ) : null}

        {deliveries.length > 1 ? (
          <label className="field-label delivery-selector">Leverans
            <select name="active-delivery" value={selectedDelivery.id} onChange={(event) => { setSelectedDeliveryId(event.target.value); setExpandedId(null); }}>
            {deliveries.map((delivery) => <option key={delivery.id} value={delivery.id}>{delivery.title}</option>)}
            </select>
          </label>
        ) : null}

        <div className="delivery-filters" aria-label="Filtrera leveranslistan">
          <Button aria-pressed={filter === "all"} className={filter === "all" ? "is-selected" : ""} onPress={() => setFilter("all")}>Alla {currentItems.length}</Button>
          <Button aria-pressed={filter === "remaining"} className={filter === "remaining" ? "is-selected" : ""} onPress={() => setFilter("remaining")}>Kvar {remaining}</Button>
          <Button aria-pressed={filter === "done"} className={filter === "done" ? "is-selected" : ""} onPress={() => setFilter("done")}>Klara {done}</Button>
        </div>

        <label className="delivery-search">
          <span className="sr-only">Sök vara</span><Search aria-hidden="true" size={24} />
          <input name="delivery-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sök vara" type="search" />
        </label>

        <p className="operational-rounding-note">
          Behoven visas i praktiska mängder för varje leverans. Faktiska
          ICA-förpackningar fördelas globalt utan dubbel avrundning.
        </p>

        <div className="delivery-groups">
          {[...grouped.entries()].map(([category, categoryItems]) => (
            <section key={category} className="delivery-group" aria-labelledby={`category-${category}`}>
              <h2 id={`category-${category}`}>{category}</h2>
              {categoryItems.map((item) => {
                const expanded = expandedId === item.id;
                const manualAllocationExplanation = manualPurchaseAllocationExplanation(item, purchaseItems);
                const duplicateSource = duplicateCanonicalKeys.has(item.canonical_key)
                  ? deliveryItemSource(item, deliveries)
                  : null;
                const practical = practicalDeliveryAmounts.get(item.id)
                  ?? practicalSupplyAmount(item.required_amount, item.required_unit);
                return (
                  <div key={item.id} className={`delivery-item${expanded ? " delivery-item--expanded" : ""}`}>
                    <div className="delivery-item__row">
                      <label className="delivery-check">
                        <input name={`delivery-completed-${item.id}`} type="checkbox" checked={item.completed} disabled={savingId === item.id} onChange={() => toggleItem(item)} />
                        <span aria-hidden="true">{item.completed ? <Check size={22} strokeWidth={3} /> : null}</span>
                        <span className="sr-only">{item.completed ? "Markera som kvar" : "Markera som klar"}: {item.item_name}</span>
                      </label>
                      <div className="delivery-item__name">
                        <strong>{item.item_name}</strong>
                        <span className={practical.issue ? "operational-amount--warning" : undefined}>
                          Behov {practical.display}
                        </span>
                        {duplicateSource ? (
                          <small className="delivery-item__source-badge">Ursprung: {duplicateSource.title}</small>
                        ) : null}
                      </div>
                      <div className="delivery-item__ordered" aria-label={`Beställt för ${item.item_name}`}>
                        <span>{item.ordered_amount === null
                          ? "Ej angivet"
                          : formatCountedAmount(item.ordered_amount, item.ordered_unit ?? "")}</span>
                        {manualAllocationExplanation ? (
                          <small className="delivery-item__allocation-warning">{manualAllocationExplanation}</small>
                        ) : null}
                        {item.order_source_kind === "supplier_purchase" && item.package_note ? (
                          <small>{item.package_note}</small>
                        ) : null}
                      </div>
                      <Button className="icon-button delivery-item__expand" aria-label={expanded ? `Fäll ihop ${item.item_name}` : `Visa detaljer för ${item.item_name}`} onPress={() => setExpandedId(expanded ? null : item.id)}>
                        {expanded ? <ChevronUp aria-hidden="true" size={22} /> : <ChevronDown aria-hidden="true" size={22} />}
                      </Button>
                    </div>
                    {expanded ? <DeliveryDetails key={item.row_version} item={item} deliveries={deliveries} activeDeliveryId={selectedDelivery.id} scope={scope!} canMove={networkWritable} onRefresh={refresh} /> : null}
                  </div>
                );
              })}
            </section>
          ))}
          {visibleItems.length === 0 ? <p className="delivery-empty">Inga varor matchar filtret.</p> : null}
        </div>
      </div>

      <footer className="delivery-footer">
        <div className="delivery-footer__summary">
          <strong>{done} av {currentItems.length} klara</strong>
          {readinessQuery.data?.problems.length ? (
            <ul className="delivery-footer__problems" aria-label="Detta återstår innan leveransen kan markeras klar">
              {readinessQuery.data.problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          ) : null}
          {readinessQuery.error ? (
            <p className="delivery-footer__error" role="alert">{userFacingError(readinessQuery.error, "Det gick inte att kontrollera om lägret är redo.")}</p>
          ) : null}
          {readinessQuery.data?.canFinalize === false && readinessQuery.data.problems.length === 0 ? (
            <p className="delivery-footer__error">Lägret är inte redo att slutmarkeras ännu.</p>
          ) : null}
        </div>
        <Button className="delivery-footer__button" onPress={completeDelivery} isDisabled={
          remaining > 0
          || selectedDelivery.status === "complete"
          || !networkWritable
          || completing
          || readinessQuery.isPending
          || readinessQuery.isFetching
          || Boolean(readinessQuery.error)
          || readinessQuery.data?.canFinalize !== true
        }>
          {selectedDelivery.status === "complete" ? "Leverans klar" : "Markera leverans klar"}
          <span>{selectedDelivery.status === "complete"
            ? "Sparad i databasen"
            : remaining > 0
            ? `${remaining} ${remaining === 1 ? "vara" : "varor"} återstår`
            : offlineState.conflicts.length > 0
              ? "Lös konflikter först"
              : offlineState.pending > 0
                ? "Spara väntande ändringar först"
                : cached || !offlineState.online
                  ? "Anslut till databasen för att slutmarkera leveransen."
                  : readinessQuery.isPending || readinessQuery.isFetching || completing
                    ? "Kontrollerar mot databasen…"
                    : readinessQuery.error
                      ? "Kontrollen mot databasen misslyckades"
                      : readinessQuery.data?.problems.length
                        ? "Lös problemen bredvid först"
                        : readinessQuery.data?.canFinalize === false
                          ? "Lägret är inte redo ännu"
                        : "Sparas i databasen"}</span>
        </Button>
      </footer>
    </section>
  );
}
