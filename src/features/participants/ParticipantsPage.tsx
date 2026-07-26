import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, FileSpreadsheet, Import, LoaderCircle, Pencil, Search, ShieldCheck, Trash2, UsersRound, X } from "lucide-react";
import { useMemo, useState, type ChangeEvent } from "react";
import { Button } from "react-aria-components";
import { supabase } from "../../lib/supabase";
import { collectPages } from "../../lib/pagination";
import { userFacingError } from "../../lib/userFacingError";
import type { Json } from "../../types/database";
import { useWorkspace } from "../workspace/WorkspaceContext";
import {
  buildPreviewRows,
  discardedColumns,
  importFieldLabels,
  isImportField,
  readImportFile,
  revalidatePreviewRow,
  sanitizedRows,
  suggestedMapping,
  type ColumnMapping,
  type ImportTable,
  type PreviewRow
} from "./importModel";
import { CreateParticipantDialog } from "./CreateParticipantDialog";
import { ParticipantPrivacyDialog } from "./ParticipantPrivacyDialog";

interface ParticipantListRow {
  id: string;
  display_name: string;
  division_id: string | null;
  patrol_id: string | null;
  meal_group_id: string | null;
  food_factor: number;
}

interface GroupRow {
  id: string;
  name: string;
}

interface AttendanceRow {
  participant_id: string;
  starts_at: string;
  ends_at: string;
}

interface ParticipantEditDraft {
  displayName: string;
  division: string;
  patrol: string;
  mealGroup: string;
  foodFactor: string;
  attendanceStart: string;
  attendanceEnd: string;
}

const selectableFields = Object.entries(importFieldLabels);
const apiPageSize = 500;

async function fetchAllParticipants(organizationId: string, campId: string): Promise<ParticipantListRow[]> {
  const client = supabase;
  if (!client) return [];
  return collectPages(async (offset, pageSize) => {
    const { data, error } = await client
      .from("participants")
      .select("id, display_name, division_id, patrol_id, meal_group_id, food_factor")
      .eq("organization_id", organizationId)
      .eq("camp_id", campId)
      .order("display_name")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    return (data ?? []) as ParticipantListRow[];
  }, apiPageSize);
}

async function fetchAllAttendances(organizationId: string, campId: string): Promise<AttendanceRow[]> {
  const client = supabase;
  if (!client) return [];
  return collectPages(async (offset, pageSize) => {
    const { data, error } = await client
      .from("participant_attendance")
      .select("participant_id, starts_at, ends_at")
      .eq("organization_id", organizationId)
      .eq("camp_id", campId)
      .order("starts_at")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    return (data ?? []) as AttendanceRow[];
  }, apiPageSize);
}

function dateTimeInputValue(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function dateTimeFromInput(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function readableDateTime(value: string): string {
  return new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function participantCount(count: number): string {
  return `${count} ${count === 1 ? "person" : "personer"}`;
}

function portionSizeLabel(value: number): string {
  if (value === 1) return "Normal portion";
  return `Portionsstorlek ${new Intl.NumberFormat("sv-SE", { style: "percent", maximumFractionDigits: 0 }).format(value)}`;
}

export function ParticipantsPage() {
  const queryClient = useQueryClient();
  const { activeCamp, activeMembership } = useWorkspace();
  const [table, setTable] = useState<ImportTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ParticipantEditDraft | null>(null);
  const [participantSearch, setParticipantSearch] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const scope = activeMembership && activeCamp
    ? { organizationId: activeMembership.organizationId, campId: activeCamp.id }
    : null;

  const participantQuery = useQuery({
    queryKey: ["participants-page", scope?.organizationId, scope?.campId],
    enabled: Boolean(scope && supabase),
    queryFn: async () => {
      if (!scope || !supabase) return { participants: [], groups: [], attendances: [], batches: [] };
      const [participants, groupResult, attendances, batchResult] = await Promise.all([
        fetchAllParticipants(scope.organizationId, scope.campId),
        supabase
          .from("camp_groups")
          .select("id, name")
          .eq("organization_id", scope.organizationId)
          .eq("camp_id", scope.campId),
        fetchAllAttendances(scope.organizationId, scope.campId),
        supabase
          .from("import_batches")
          .select("id, source_filename, status, validation_summary, completed_at")
          .eq("organization_id", scope.organizationId)
          .eq("camp_id", scope.campId)
          .order("created_at", { ascending: false })
          .limit(5)
      ]);
      const error = groupResult.error ?? batchResult.error;
      if (error) throw error;
      return {
        participants,
        groups: (groupResult.data ?? []) as GroupRow[],
        attendances,
        batches: batchResult.data ?? []
      };
    }
  });

  const groupNames = useMemo(
    () => new Map((participantQuery.data?.groups ?? []).map((group) => [group.id, group.name])),
    [participantQuery.data?.groups]
  );
  const participants = useMemo(
    () => participantQuery.data?.participants ?? [],
    [participantQuery.data?.participants]
  );
  const divisionOptions = useMemo(() => {
    const divisions = new Map<string, string>();
    for (const participant of participants) {
      if (!participant.division_id) continue;
      const name = groupNames.get(participant.division_id);
      if (name) divisions.set(participant.division_id, name);
    }
    return [...divisions].sort((left, right) => left[1].localeCompare(right[1], "sv"));
  }, [groupNames, participants]);
  const visibleParticipants = useMemo(() => {
    const query = participantSearch.trim().toLocaleLowerCase("sv-SE");
    return participants.filter((participant) => {
      if (divisionFilter && participant.division_id !== divisionFilter) return false;
      if (!query) return true;
      return [
        participant.display_name,
        participant.division_id ? groupNames.get(participant.division_id) : null,
        participant.patrol_id ? groupNames.get(participant.patrol_id) : null,
        participant.meal_group_id ? groupNames.get(participant.meal_group_id) : null
      ].some((value) => value?.toLocaleLowerCase("sv-SE").includes(query));
    });
  }, [divisionFilter, groupNames, participantSearch, participants]);
  const participantFilterActive = Boolean(participantSearch.trim() || divisionFilter);
  const includedRows = previewRows.filter((row) => row.included);
  const blockingErrors = includedRows.flatMap((row) => row.issues.filter((issue) => issue.severity === "error"));
  const sanitized = sanitizedRows(previewRows);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeCamp) return;
    setLoadingFile(true);
    setMessage(null);
    try {
      const nextTable = await readImportFile(file);
      const nextMapping = suggestedMapping(nextTable);
      setTable(nextTable);
      setMapping(nextMapping);
      setPreviewRows(buildPreviewRows(nextTable, nextMapping, activeCamp));
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Filen kunde inte läsas." });
    } finally {
      setLoadingFile(false);
    }
  }

  function updateMapping(index: number, value: string) {
    if (!table || !activeCamp || !isImportField(value)) return;
    const nextMapping = mapping.map((column) => column.index === index ? { ...column, target: value } : column);
    setMapping(nextMapping);
    setPreviewRows(buildPreviewRows(table, nextMapping, activeCamp));
    setMessage(null);
  }

  function updateRow(id: string, patch: Partial<PreviewRow>) {
    setPreviewRows((rows) => rows.map((row) => row.id === id ? revalidatePreviewRow({ ...row, ...patch }) : row));
    setMessage(null);
  }

  function startEditing(participant: ParticipantListRow) {
    const attendance = participantQuery.data?.attendances.find((row) => row.participant_id === participant.id);
    setEditingId(participant.id);
    setEditDraft({
      displayName: participant.display_name,
      division: participant.division_id ? groupNames.get(participant.division_id) ?? "" : "",
      patrol: participant.patrol_id ? groupNames.get(participant.patrol_id) ?? "" : "",
      mealGroup: participant.meal_group_id ? groupNames.get(participant.meal_group_id) ?? "" : "",
      foodFactor: String(participant.food_factor),
      attendanceStart: attendance?.starts_at ?? `${activeCamp?.startsOn ?? ""}T00:00:00.000Z`,
      attendanceEnd: attendance?.ends_at ?? `${activeCamp?.endsOn ?? ""}T23:59:59.000Z`
    });
    setMessage(null);
  }

  async function saveParticipant() {
    if (!supabase || !editingId || !editDraft) return;
    setSaving(true);
    setMessage(null);
    const { error } = await supabase.rpc("update_participant_details", {
      p_participant_id: editingId,
      p_display_name: editDraft.displayName,
      p_division: editDraft.division,
      p_patrol: editDraft.patrol,
      p_meal_group: editDraft.mealGroup,
      p_food_factor: Number(editDraft.foodFactor.replace(",", ".")),
      p_attendance_start: editDraft.attendanceStart,
      p_attendance_end: editDraft.attendanceEnd
    });
    if (error) {
      setMessage({ kind: "error", text: userFacingError(error, "Deltagaren kunde inte sparas.") });
      setSaving(false);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["participants-page"] }),
      queryClient.invalidateQueries({ queryKey: ["camp-overview"] })
    ]);
    setEditingId(null);
    setEditDraft(null);
    setMessage({ kind: "success", text: "Deltagaren och närvaroperioden uppdaterades." });
    setSaving(false);
  }

  async function persistImport() {
    if (!supabase || !scope || !table || sanitized.length === 0 || blockingErrors.length > 0) return;
    setSaving(true);
    setMessage(null);
    const excludedCount = previewRows.filter((row) => !row.included).length;
    const errorCount = previewRows.reduce((total, row) => total + row.issues.filter((issue) => issue.severity === "error").length, 0);
    const { error } = await supabase.rpc("import_participant_batch", {
      p_organization_id: scope.organizationId,
      p_camp_id: scope.campId,
      p_source_filename: table.filename,
      p_source_kind: table.sourceKind,
      p_sheet_name: table.sheetName,
      p_column_mapping: mapping as unknown as Json,
      p_discarded_columns: discardedColumns(mapping),
      p_excluded_count: excludedCount,
      p_error_count: errorCount,
      p_rows: sanitized as unknown as Json
    });
    if (error) {
      setMessage({ kind: "error", text: userFacingError(error, "Deltagarna kunde inte importeras.") });
      setSaving(false);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["participants-page"] }),
      queryClient.invalidateQueries({ queryKey: ["camp-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["special-diets"] })
    ]);
    setMessage({ kind: "success", text: `${sanitized.length} deltagare importerades. Källfilens övriga värden sparades inte.` });
    setTable(null);
    setMapping([]);
    setPreviewRows([]);
    setSaving(false);
  }

  if (!activeCamp || !activeMembership) {
    return <section className="page page--narrow"><p className="form-error">Välj en organisation och ett läger först.</p></section>;
  }

  return (
    <section className="page participants-page">
      <header className="page-heading page-heading--split">
        <div>
          <p className="page-heading__eyebrow">Lägerdeltagare</p>
          <h1>Deltagare</h1>
          <p>{activeCamp.name} · importera bara det köket behöver.</p>
        </div>
        <div className="page-actions">
          <CreateParticipantDialog
            key={activeCamp.id}
            onCreated={(displayName) => {
              setParticipantSearch("");
              setDivisionFilter("");
              setMessage({ kind: "success", text: `${displayName} lades till i lägret.` });
            }}
          />
          <label className="secondary-button file-button">
            {loadingFile ? <LoaderCircle className="spin" aria-hidden="true" size={19} /> : <Import aria-hidden="true" size={19} />}
            {loadingFile ? "Läser fil…" : "Välj XLSX eller CSV"}
            <input name="participant-import-file" type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} disabled={loadingFile || saving} />
          </label>
        </div>
      </header>

      <section className="privacy-banner" aria-label="Dataminimering">
        <ShieldCheck aria-hidden="true" size={26} />
        <div>
          <strong>Källfilen lämnar inte datorn</strong>
          <p>Filen läses endast i webbläsarens minne. Personnummer, kontaktuppgifter och generell hälsodeklaration skickas aldrig till databasen.</p>
        </div>
      </section>

      {message ? <p className={message.kind === "success" ? "form-success" : "form-error"} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p> : null}

      {table ? (
        <div className="import-workflow">
          <section className="import-card" aria-labelledby="mapping-heading">
            <div className="import-card__heading">
              <span className="import-step">1</span>
              <div>
                <h2 id="mapping-heading">Kontrollera hur kolumnerna ska användas</h2>
                <p><strong>{table.filename}</strong> · bladet {table.sheetName} · {table.rows.length} rader hittades</p>
              </div>
            </div>
            <div className="mapping-grid">
              {mapping.map((column) => (
                <label key={column.index} className={column.target === "ignore" ? "mapping-field mapping-field--ignored" : "mapping-field"}>
                  <span title={column.source}>{column.source}</span>
                  <select name={`import-column-${column.index}`} aria-label={`Användning för ${column.source}`} value={column.target} onChange={(event) => updateMapping(column.index, event.target.value)}>
                    {selectableFields.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <p className="mapping-note">Ändrar du valet uppdateras förhandsgranskningen. Kolumner som är märkta ”Ta inte med” sparas inte.</p>
          </section>

          <section className="import-card" aria-labelledby="preview-heading">
            <div className="import-card__heading import-card__heading--split">
              <div className="import-card__heading-copy">
                <span className="import-step">2</span>
                <div>
                  <h2 id="preview-heading">Rätta och välj rader</h2>
                  <p>{includedRows.length} valda · {previewRows.length - includedRows.length} bortvalda · {blockingErrors.length} blockerande fel</p>
                </div>
              </div>
              <Button className="text-button" onPress={() => { setTable(null); setMapping([]); setPreviewRows([]); }}>
                <Trash2 aria-hidden="true" size={17} /> Avbryt import
              </Button>
            </div>

            <div className="import-preview-wrap">
              <table className="import-preview-table">
                <thead>
                  <tr>
                    <th scope="col">Ta med</th>
                    <th scope="col">Rad</th>
                    <th scope="col">Namn</th>
                    <th scope="col">Avdelning</th>
                    <th scope="col">Patrull</th>
                    <th scope="col">Matlag</th>
                    <th scope="col">Portionsstorlek</th>
                    <th scope="col">Ankomst</th>
                    <th scope="col">Avresa</th>
                    <th scope="col">Specialkost</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => {
                    const hasError = row.issues.some((issue) => issue.severity === "error");
                    return (
                      <tr key={row.id} className={!row.included ? "is-excluded" : hasError ? "has-error" : undefined}>
                        <td><input name={`include-row-${row.id}`} aria-label={`Ta med rad ${row.sourceRow}`} type="checkbox" checked={row.included} onChange={(event) => updateRow(row.id, { included: event.target.checked })} /></td>
                        <td>{row.sourceRow}</td>
                        <td><input name={`display-name-${row.id}`} aria-label={`Namn på rad ${row.sourceRow}`} value={row.displayName} onChange={(event) => updateRow(row.id, { displayName: event.target.value })} /></td>
                        <td><input name={`division-${row.id}`} aria-label={`Avdelning på rad ${row.sourceRow}`} value={row.division} onChange={(event) => updateRow(row.id, { division: event.target.value })} /></td>
                        <td><input name={`patrol-${row.id}`} aria-label={`Patrull på rad ${row.sourceRow}`} value={row.patrol} onChange={(event) => updateRow(row.id, { patrol: event.target.value })} /></td>
                        <td><input name={`meal-group-${row.id}`} aria-label={`Matlag på rad ${row.sourceRow}`} value={row.mealGroup} onChange={(event) => updateRow(row.id, { mealGroup: event.target.value })} /></td>
                        <td><input name={`food-factor-${row.id}`} aria-label={`Portionsstorlek på rad ${row.sourceRow}`} className="short-input" inputMode="decimal" value={row.foodFactor} onChange={(event) => updateRow(row.id, { foodFactor: event.target.value.replace(",", ".") })} /></td>
                        <td><input name={`attendance-start-${row.id}`} aria-label={`Ankomst på rad ${row.sourceRow}`} type="datetime-local" value={dateTimeInputValue(row.attendanceStart)} onChange={(event) => updateRow(row.id, { attendanceStart: dateTimeFromInput(event.target.value) })} /></td>
                        <td><input name={`attendance-end-${row.id}`} aria-label={`Avresa på rad ${row.sourceRow}`} type="datetime-local" value={dateTimeInputValue(row.attendanceEnd)} onChange={(event) => updateRow(row.id, { attendanceEnd: dateTimeFromInput(event.target.value) })} /></td>
                        <td><input name={`dietary-note-${row.id}`} aria-label={`Specialkost på rad ${row.sourceRow}`} value={row.dietaryNote} onChange={(event) => updateRow(row.id, { dietaryNote: event.target.value })} /></td>
                        <td className="import-status-cell">
                          {row.issues.length === 0 ? <span className="row-status row-status--ok"><Check aria-hidden="true" size={16} /> Klar</span> : row.issues.map((issue) => (
                            <span className={`row-status row-status--${issue.severity}`} key={issue.message}><CircleAlert aria-hidden="true" size={16} /> {issue.message}</span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <footer className="import-footer">
              <div>
                <strong>{sanitized.length} deltagare redo</strong>
                <span>{discardedColumns(mapping).length} kolumner tas inte med</span>
              </div>
              <Button className="primary-button" onPress={persistImport} isDisabled={saving || sanitized.length === 0 || blockingErrors.length > 0}>
                {saving ? <LoaderCircle className="spin" aria-hidden="true" size={19} /> : <FileSpreadsheet aria-hidden="true" size={19} />}
                {saving ? "Importerar lokalt…" : `Importera ${sanitized.length} deltagare`}
              </Button>
            </footer>
          </section>
        </div>
      ) : (
        <div className="participant-layout">
          <section className="participant-card" aria-labelledby="participant-list-heading">
            <div className="participant-card__heading">
              <UsersRound aria-hidden="true" size={24} />
              <div><h2 id="participant-list-heading">Deltagare i lägret</h2><p>{participantFilterActive ? `${participantCount(visibleParticipants.length)} av ${participantCount(participants.length)}` : participantCount(participants.length)}</p></div>
            </div>
            {participantQuery.isLoading ? <LoaderCircle className="spin" aria-label="Läser deltagare" size={28} /> : participantQuery.error ? (
              <p className="form-error">{userFacingError(participantQuery.error, "Deltagarna kunde inte läsas.")}</p>
            ) : (participantQuery.data?.participants.length ?? 0) === 0 ? (
              <div className="participant-empty"><FileSpreadsheet aria-hidden="true" size={35} /><p>Inga deltagare ännu. Lägg till en person eller välj en Scoutnet-fil för att börja.</p></div>
            ) : (
              <>
                <div role="search" aria-label="Sök och filtrera deltagare">
                  <label className="recipe-search">
                    <Search aria-hidden="true" size={19} />
                    <span className="sr-only">Sök deltagare</span>
                    <input name="participant-search" type="search" value={participantSearch} onChange={(event) => setParticipantSearch(event.target.value)} placeholder="Sök namn, avdelning eller patrull" />
                  </label>
                  <label className="field-label">Avdelning
                    <select name="participant-division-filter" aria-label="Filtrera deltagare efter avdelning" value={divisionFilter} onChange={(event) => setDivisionFilter(event.target.value)}>
                      <option value="">Alla avdelningar</option>
                      {divisionOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                    </select>
                  </label>
                </div>
                {visibleParticipants.length === 0 ? (
                  <div className="participant-empty"><UsersRound aria-hidden="true" size={35} /><p>Inga deltagare matchar sökningen eller filtret.</p></div>
                ) : <div className="participant-list">
                {visibleParticipants.map((participant) => (
                  <div className="participant-record" key={participant.id}>
                    <div className="participant-row">
                      <span className="participant-avatar">{participant.display_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
                      <div><strong>{participant.display_name}</strong><span>{participant.division_id ? groupNames.get(participant.division_id) : "Ingen avdelning"}{participant.patrol_id ? ` · ${groupNames.get(participant.patrol_id)}` : ""}</span></div>
                      <span className="participant-row__portion">{portionSizeLabel(participant.food_factor)}</span>
                      <div className="participant-row__actions">
                        <Button className="icon-button" aria-label={`Redigera ${participant.display_name}`} onPress={() => startEditing(participant)}><Pencil aria-hidden="true" size={18} /></Button>
                        {activeMembership.role === "admin" ? (
                          <ParticipantPrivacyDialog
                            participantId={participant.id}
                            participantName={participant.display_name}
                            onDeleted={async (displayName) => {
                              if (editingId === participant.id) {
                                setEditingId(null);
                                setEditDraft(null);
                              }
                              await Promise.all([
                                queryClient.invalidateQueries({ queryKey: ["participants-page"] }),
                                queryClient.invalidateQueries({ queryKey: ["camp-overview"] }),
                                queryClient.invalidateQueries({ queryKey: ["special-diets"] })
                              ]);
                              setMessage({ kind: "success", text: `${displayName} och personens lägeruppgifter raderades.` });
                            }}
                          />
                        ) : null}
                      </div>
                    </div>
                    {editingId === participant.id && editDraft ? (
                      <div className="participant-editor">
                        <div className="participant-editor__heading"><strong>Redigera deltagare</strong><Button className="icon-button" aria-label="Stäng deltagarredigering" onPress={() => { setEditingId(null); setEditDraft(null); }}><X aria-hidden="true" size={19} /></Button></div>
                        <div className="participant-editor__grid">
                          <label>Namn<input name="participant-name" value={editDraft.displayName} onChange={(event) => setEditDraft({ ...editDraft, displayName: event.target.value })} /></label>
                          <label>Avdelning<input name="participant-division" value={editDraft.division} onChange={(event) => setEditDraft({ ...editDraft, division: event.target.value })} /></label>
                          <label>Patrull<input name="participant-patrol" value={editDraft.patrol} onChange={(event) => setEditDraft({ ...editDraft, patrol: event.target.value })} /></label>
                          <label>Matlag<input name="participant-meal-group" value={editDraft.mealGroup} onChange={(event) => setEditDraft({ ...editDraft, mealGroup: event.target.value })} /></label>
                          <label>Portionsstorlek <small>1 = normal portion, 0,5 = halv portion</small><input name="participant-food-factor" inputMode="decimal" value={editDraft.foodFactor} onChange={(event) => setEditDraft({ ...editDraft, foodFactor: event.target.value })} /></label>
                          <label>Ankomst<input name="participant-attendance-start" type="datetime-local" value={dateTimeInputValue(editDraft.attendanceStart)} onChange={(event) => setEditDraft({ ...editDraft, attendanceStart: dateTimeFromInput(event.target.value) })} /></label>
                          <label>Avresa<input name="participant-attendance-end" type="datetime-local" value={dateTimeInputValue(editDraft.attendanceEnd)} onChange={(event) => setEditDraft({ ...editDraft, attendanceEnd: dateTimeFromInput(event.target.value) })} /></label>
                        </div>
                        <Button className="primary-button" onPress={saveParticipant} isDisabled={saving || !editDraft.displayName.trim() || !editDraft.attendanceStart || !editDraft.attendanceEnd}>{saving ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <Check aria-hidden="true" size={18} />} Spara deltagare</Button>
                      </div>
                    ) : null}
                  </div>
                ))}
                </div>}
              </>
            )}
          </section>

          <aside className="participant-card" aria-labelledby="import-history-heading">
            <div className="participant-card__heading"><FileSpreadsheet aria-hidden="true" size={24} /><div><h2 id="import-history-heading">Senast importerade filer</h2><p>Visar filnamn och antal. Bortvalda personuppgifter sparas inte.</p></div></div>
            {(participantQuery.data?.batches.length ?? 0) === 0 ? <p className="muted-copy">Ingen import är registrerad ännu.</p> : (
              <div className="import-history">
                {participantQuery.data?.batches.map((batch) => {
                  const summary = batch.validation_summary as { accepted?: number; excluded?: number } | null;
                  return <div key={batch.id}><strong>{batch.source_filename}</strong><span>{summary?.accepted ?? 0} importerade · {summary?.excluded ?? 0} bortvalda</span><time>{batch.completed_at ? readableDateTime(batch.completed_at) : batch.status}</time></div>;
                })}
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
