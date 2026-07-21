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
  fetchSupplyLists,
  generateSupplyLists,
  moveDeliveryItem,
  saveSupplyItem,
  type SupplyItemPatch,
  type SupplyScope
} from "../supplies/supplyApi";
import {
  filterSupplyItems,
  formatExactAmount,
  groupSupplyItems,
  hasUnitMismatch,
  parseDecimalInput,
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
      await saveSupplyItem(scope, activeDeliveryId, item, patch);
      await onRefresh();
    } catch (caught) {
      setError(userFacingError(caught, "Beställningen kunde inte sparas."));
    } finally {
      setSaving(false);
    }
  }

  async function move(targetListId: string) {
    if (!targetListId || targetListId === activeDeliveryId) return;
    setSaving(true);
    setError(null);
    try {
      await moveDeliveryItem(item, targetListId);
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
      <label>Beställd enhet<input name={`delivery-ordered-unit-${item.id}`} aria-label={`Beställd enhet för ${item.item_name}`} value={orderedUnit} onChange={(event) => setOrderedUnit(event.target.value)} /></label>
      <label>Förpackning<input name={`delivery-package-note-${item.id}`} value={packageNote} onChange={(event) => setPackageNote(event.target.value)} placeholder="Till exempel 1 säck" /></label>
      <label>Kommentar<input name={`delivery-comment-${item.id}`} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Lägg till kommentar" /></label>
      {deliveries.length > 1 ? (
        <label>Flytta till leverans
          <select name={`move-delivery-${item.id}`} value={activeDeliveryId} onChange={(event) => move(event.target.value)} disabled={saving || !canMove}>
            {deliveries.map((delivery) => <option key={delivery.id} value={delivery.id}>{delivery.title}</option>)}
          </select>
        </label>
      ) : null}
      {deliveries.length > 1 && !canMove ? <p className="offline-operation-note">Spara väntande ändringar och anslut till databasen innan du flyttar varan.</p> : null}
      {mismatch || hasUnitMismatch(item) ? <p className="unit-warning"><AlertTriangle aria-hidden="true" size={17} /> Behovet anges i {item.required_unit} men beställningen i {orderedUnit || "en annan enhet"}. Kontrollera mängden manuellt eller välj samma enhet.</p> : null}
      {item.manually_moved ? <p><MapPin aria-hidden="true" size={16} /> Flyttad manuellt. Den beräknade mängden ändras inte.</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Button className="secondary-button" onPress={save} isDisabled={saving}>
        {saving ? <LoaderCircle className="spin" aria-hidden="true" size={17} /> : <Check aria-hidden="true" size={17} />} {saving ? "Sparar…" : "Spara beställning"}
      </Button>
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
  const deliveries = (listsQuery.data?.lists ?? []).filter((list) => list.kind === "delivery");
  const cached = listsQuery.data?.source === "cache";
  const networkWritable = offlineState.online && !cached && offlineState.pending === 0 && offlineState.conflicts.length === 0;
  const selectedDelivery = deliveries.find((list) => list.id === selectedDeliveryId) ?? deliveries[0] ?? null;
  const hasCurrentCalculation = Boolean(currentCalculationQuery.data)
    || selectedDelivery?.calculation_revisions?.status === "current";
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

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["supply-lists", scope?.organizationId, scope?.campId] }),
      queryClient.invalidateQueries({ queryKey: ["current-calculation", scope?.organizationId, scope?.campId] })
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
    if (!selectedDelivery) return;
    setMessage(null);
    try {
      await changeSupplyListStatus(selectedDelivery, "complete");
      await refresh();
      setMessage({ kind: "success", text: "Leveransen är markerad som klar." });
    } catch (caught) {
      setMessage({ kind: "error", text: userFacingError(caught, "Leveransen kunde inte markeras som klar.") });
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
          <div><h1>{selectedDelivery.title}</h1><p>{dateLabel(selectedDelivery.range_start, activeCamp?.timezone ?? "Europe/Stockholm")} · {currentItems.length} {currentItems.length === 1 ? "vara" : "varor"} · {selectedDelivery.calculation_revisions?.status === "current" ? "senaste mängderna" : "mängderna behöver räknas om"}</p></div>
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
        {scope && activeMembership && activeCamp ? (
          <SupplyExportActions
            scope={scope}
            list={selectedDelivery}
            organizationName={activeMembership.organizationName}
            campName={activeCamp.name}
            timeZone={activeCamp.timezone}
            disabled={!networkWritable || !hasCurrentCalculation}
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

        <div className="delivery-groups">
          {[...grouped.entries()].map(([category, categoryItems]) => (
            <section key={category} className="delivery-group" aria-labelledby={`category-${category}`}>
              <h2 id={`category-${category}`}>{category}</h2>
              {categoryItems.map((item) => {
                const expanded = expandedId === item.id;
                return (
                  <div key={item.id} className={`delivery-item${expanded ? " delivery-item--expanded" : ""}`}>
                    <div className="delivery-item__row">
                      <label className="delivery-check">
                        <input name={`delivery-completed-${item.id}`} type="checkbox" checked={item.completed} disabled={savingId === item.id} onChange={() => toggleItem(item)} />
                        <span aria-hidden="true">{item.completed ? <Check size={22} strokeWidth={3} /> : null}</span>
                        <span className="sr-only">{item.completed ? "Markera som kvar" : "Markera som klar"}: {item.item_name}</span>
                      </label>
                      <div className="delivery-item__name"><strong>{item.item_name}</strong><span>Behov {formatExactAmount(item.required_amount)} {item.required_unit}</span></div>
                      <div className="delivery-item__ordered" aria-label={`Beställt för ${item.item_name}`}>{item.ordered_amount === null ? "Ej angivet" : `${formatExactAmount(item.ordered_amount)} ${item.ordered_unit ?? ""}`}</div>
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
        <strong>{done} av {currentItems.length} klara</strong>
        <Button className="delivery-footer__button" onPress={completeDelivery} isDisabled={remaining > 0 || selectedDelivery.status === "complete" || !networkWritable}>
          {selectedDelivery.status === "complete" ? "Leverans klar" : "Markera leverans klar"}
          <span>{remaining > 0
            ? `${remaining} ${remaining === 1 ? "vara" : "varor"} återstår`
            : offlineState.conflicts.length > 0
              ? "Lös konflikter först"
              : offlineState.pending > 0
                ? "Spara väntande ändringar först"
                : cached || !offlineState.online
                  ? "Databasen är inte tillgänglig"
                  : "Sparas lokalt"}</span>
        </Button>
      </footer>
    </section>
  );
}
