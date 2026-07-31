import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  GitCompareArrows,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  TriangleAlert
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "react-aria-components";
import { supabase } from "../../lib/supabase";
import { useWorkspace } from "../workspace/WorkspaceContext";
import {
  applyScoutnetReconciliation,
  readScoutnetConnectionStatus,
  readScoutnetReconciliationPreview,
  type ScoutnetAttendanceWarning,
  type ScoutnetReconciliationApplyResult,
  type ScoutnetReconciliationCategory,
  type ScoutnetReconciliationChangeField,
  type ScoutnetReconciliationRow
} from "./scoutnetApi";
import {
  createScoutnetDecisionDraft,
  scoutnetDecisionsFromDraft,
  scoutnetRowNeedsExplicitDecision,
  type ScoutnetDecisionDraft
} from "./scoutnetReconciliationModel";
import { humanChangeValue } from "./scoutnetReconciliationPresentation";

const categoryLabels: Record<ScoutnetReconciliationCategory, string> = {
  new: "Nya",
  changed: "Ändrade",
  unchanged: "Oförändrade",
  reactivated: "Återaktiveras",
  withdrawn: "Återtas",
  possible_duplicate: "Möjliga dubbletter"
};

const changeLabels: Record<ScoutnetReconciliationChangeField, string> = {
  display_name: "Namn",
  registration_status: "Anmälningsstatus",
  division: "Avdelning",
  patrol: "Patrull",
  attendance: "Närvaro",
  special_diet: "Specialkost",
  lifecycle_status: "Deltagarstatus"
};

const attendanceWarningLabels: Record<ScoutnetAttendanceWarning, string> = {
  attendance_mapping_missing:
    "Närvarofrågor saknas. Hela lägerperioden används som tillfällig närvaro.",
  attendance_answer_missing:
    "Närvarosvar saknas. Hela lägerperioden används som tillfällig närvaro.",
  attendance_answer_incomplete:
    "Närvarosvaret är ofullständigt och behöver kontrolleras.",
  attendance_answer_invalid:
    "Närvarosvaret kunde inte tolkas och behöver kontrolleras.",
  attendance_no_days_selected:
    "Ingen lägerdag är markerad som närvarande."
};

function readableDateTime(value: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function proposedActionLabel(row: ScoutnetReconciliationRow): string {
  if (row.proposedAction === "create") return "Skapa deltagaren";
  if (row.proposedAction === "update") return "Uppdatera deltagaren";
  if (row.proposedAction === "reactivate") return "Återaktivera deltagaren";
  if (row.proposedAction === "withdraw") return "Återta deltagaren";
  return "Tillämpa förslaget";
}

function rowWarnings(row: ScoutnetReconciliationRow): string[] {
  const warnings = row.attendanceWarnings.map(
    (warning) => attendanceWarningLabels[warning]
  );
  if (row.registrationStatus === "unconfirmed") {
    warnings.unshift("Anmälan är ännu inte bekräftad i Scoutnet.");
  }
  if (row.category === "possible_duplicate") {
    warnings.unshift(
      "Samma namn finns redan. Lägermat länkar aldrig automatiskt på namn."
    );
  }
  if (row.specialDietChange === "changed") {
    warnings.push(
      "Specialkosten har ändrats. Tidigare granskning och kosttaggar öppnas igen."
    );
  }
  if (row.specialDietChange === "cleared") {
    warnings.push(
      "Specialkosttexten tas bort. Tidigare granskning och kosttaggar ersätts."
    );
  }
  if (row.category === "withdrawn" && row.proposedAction === "withdraw") {
    warnings.push(
      "Personen markeras som återtagen och räknas inte längre med, men historiken finns kvar."
    );
  }
  return warnings;
}

function resultSummary(result: ScoutnetReconciliationApplyResult): string {
  const { counts } = result;
  return [
    `${counts.created} skapade`,
    `${counts.linked} länkade`,
    `${counts.updated} uppdaterade`,
    `${counts.reactivated} återaktiverade`,
    `${counts.withdrawn} återtagna`,
    `${counts.skipped} hoppades över`
  ].join(" · ");
}

function DecisionSelect({
  row,
  value,
  onChange
}: {
  row: ScoutnetReconciliationRow;
  value: string;
  onChange: (value: string) => void;
}) {
  if (row.proposedAction === "none" && row.category === "unchanged") {
    return <span className="scoutnet-decision-static">Ingen ändring</span>;
  }

  return (
    <label className="scoutnet-decision">
      <span>Beslut</span>
      <select
        name={`scoutnet-decision-${row.sourceReference}`}
        aria-label={`Beslut för ${row.displayName}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Välj innan synken kan genomföras</option>
        {row.category === "possible_duplicate" ? (
          <>
            <option value="apply">Skapa som ny deltagare</option>
            {row.duplicateCandidates.map((candidate) => (
              <option
                key={candidate.participantId}
                value={`link:${candidate.participantId}`}
              >
                Länka till {candidate.displayName}
                {candidate.lifecycleStatus === "withdrawn"
                  ? " (återtagen)"
                  : ""}
              </option>
            ))}
          </>
        ) : row.proposedAction !== "none" ? (
          <option value="apply">{proposedActionLabel(row)}</option>
        ) : null}
        <option value="skip">
          {row.proposedAction === "withdraw"
            ? "Behåll deltagaren aktiv tills vidare"
            : "Hoppa över den här raden"}
        </option>
      </select>
    </label>
  );
}

export function ScoutnetReconciliationCard() {
  const queryClient = useQueryClient();
  const { activeCamp, activeMembership } = useWorkspace();
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof readScoutnetReconciliationPreview>
  > | null>(null);
  const [draft, setDraft] = useState<ScoutnetDecisionDraft>({});
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] =
    useState<ScoutnetReconciliationApplyResult | null>(null);
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const isAdmin = activeMembership?.role === "admin";
  const statusQuery = useQuery({
    queryKey: ["scoutnet-connection-status", activeCamp?.id],
    enabled: Boolean(isAdmin && activeCamp && supabase),
    retry: false,
    queryFn: async () => {
      if (!supabase || !activeCamp) {
        throw new Error("Scoutnet-anslutningen är inte tillgänglig.");
      }
      return readScoutnetConnectionStatus(supabase, activeCamp.id);
    }
  });
  const decisions = useMemo(
    () => preview ? scoutnetDecisionsFromDraft(preview, draft) : null,
    [draft, preview]
  );
  const unresolvedDecisionCount = preview
    ? preview.rows.filter((row) =>
        !(draft[row.sourceReference] ?? "")
      ).length
    : 0;

  if (!isAdmin || !activeCamp) return null;

  async function loadPreview() {
    if (!supabase || !activeCamp) return;
    setLoading(true);
    setMessage(null);
    setResult(null);
    try {
      const next = await readScoutnetReconciliationPreview(
        supabase,
        activeCamp.id
      );
      setPreview(next);
      setDraft(createScoutnetDecisionDraft(next));
    } catch (error) {
      setPreview(null);
      setDraft({});
      setMessage({
        kind: "error",
        text: error instanceof Error
          ? error.message
          : "Scoutnet-underlaget kunde inte förhandsgranskas."
      });
    } finally {
      setLoading(false);
    }
  }

  async function applyPreview() {
    if (!supabase || !activeCamp || !preview || !decisions) return;
    const campId = activeCamp.id;
    setApplying(true);
    setMessage(null);
    try {
      const nextResult = await applyScoutnetReconciliation(
        supabase,
        preview,
        decisions,
        crypto.randomUUID()
      );
      setResult(nextResult);
      setPreview(null);
      setDraft({});
      setMessage({
        kind: "success",
        text: `Scoutnet-avstämningen sparades. ${resultSummary(nextResult)}.`
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["participants-page"] }),
        queryClient.invalidateQueries({ queryKey: ["camp-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["special-diets"] }),
        queryClient.invalidateQueries({
          queryKey: ["scoutnet-connection-status", campId]
        })
      ]);
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error
          ? error.message
          : "Scoutnet-avstämningen kunde inte tillämpas."
      });
    } finally {
      setApplying(false);
    }
  }

  const status = statusQuery.data;
  return (
    <section
      className="scoutnet-sync-card"
      aria-labelledby="scoutnet-sync-heading"
    >
      <div className="scoutnet-sync-card__heading">
        <span className="scoutnet-mapping-card__icon">
          <GitCompareArrows aria-hidden="true" size={21} />
        </span>
        <div>
          <h2 id="scoutnet-sync-heading">Stäm av deltagare från Scoutnet</h2>
          <p>
            Du hämtar först en diff och bestämmer sedan vad som ska sparas.
            Ingenting skickas tillbaka till Scoutnet.
          </p>
        </div>
        <div className="scoutnet-sync-card__status">
          {status?.lastSuccessfulSyncAt ? (
            <>
              <strong>Senast synkad</strong>
              <time dateTime={status.lastSuccessfulSyncAt}>
                {readableDateTime(status.lastSuccessfulSyncAt)}
              </time>
              <span>
                {status.lastSuccessfulSyncParticipantCount} deltagare i
                underlaget
              </span>
            </>
          ) : <span>Inte synkad ännu</span>}
        </div>
      </div>

      {statusQuery.isLoading ? (
        <p className="inline-status">
          <LoaderCircle className="spin" aria-hidden="true" size={17} />
          Läser Scoutnet-status…
        </p>
      ) : statusQuery.error ? (
        <p className="form-error" role="alert">
          {statusQuery.error instanceof Error
            ? statusQuery.error.message
            : "Scoutnet-statusen kunde inte läsas."}
        </p>
      ) : !status?.connected ? (
        <p className="scoutnet-mapping-card__notice">
          Anslut först lägrets Scoutnet-projekt i administratörssektionen
          ovan. Manuell registrering och filimport påverkas inte.
        </p>
      ) : (
        <>
          <div className="scoutnet-sync-card__toolbar">
            <div>
              <strong>Scoutnet-projekt {status.projectId}</strong>
              <span>
                Lokal acceptans använder en tydligt märkt syntetisk fixture.
              </span>
            </div>
            <Button
              className="primary-button"
              onPress={loadPreview}
              isDisabled={loading || applying}
            >
              {loading
                ? <LoaderCircle className="spin" aria-hidden="true" size={18} />
                : <RefreshCw aria-hidden="true" size={18} />}
              {loading
                ? "Hämtar och jämför…"
                : preview
                  ? "Hämta om underlaget"
                  : "Synka nu"}
            </Button>
          </div>

          {preview ? (
            <div className="scoutnet-preview">
              <div className="scoutnet-preview__summary">
                <div>
                  <strong>Förhandsgranskning</strong>
                  <span>
                    {preview.snapshotParticipantCount} syntetiska
                    Scoutnet-deltagare · inga ändringar har sparats
                  </span>
                </div>
                <dl>
                  {Object.entries(categoryLabels).map(
                    ([category, label]) => (
                      <div key={category}>
                        <dt>{label}</dt>
                        <dd>
                          {preview.counts[
                            category as ScoutnetReconciliationCategory
                          ]}
                        </dd>
                      </div>
                    )
                  )}
                </dl>
              </div>

              <div className="scoutnet-preview__rows">
                {preview.rows.map((row) => {
                  const warnings = rowWarnings(row);
                  const needsChoice = scoutnetRowNeedsExplicitDecision(row);
                  return (
                    <article
                      className={
                        needsChoice
                          ? "scoutnet-diff-row scoutnet-diff-row--attention"
                          : "scoutnet-diff-row"
                      }
                      key={row.sourceReference}
                    >
                      <header>
                        <div>
                          <strong>{row.displayName}</strong>
                          <span>{categoryLabels[row.category]}</span>
                        </div>
                        {row.registrationStatus === "confirmed"
                          ? <span className="row-status row-status--ok">
                              <CheckCircle2 aria-hidden="true" size={15} />
                              Bekräftad
                            </span>
                          : null}
                      </header>

                      {warnings.length > 0 ? (
                        <ul className="scoutnet-diff-row__warnings">
                          {warnings.map((warning) => (
                            <li key={warning}>
                              <TriangleAlert aria-hidden="true" size={16} />
                              {warning}
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      {row.changes.length > 0 ? (
                        <dl className="scoutnet-change-list">
                          {row.changes.map((change) => (
                            <div key={change.field}>
                              <dt>
                                {changeLabels[change.field]}
                                {change.destructive
                                  ? <span>kräver beslut</span>
                                  : null}
                              </dt>
                              <dd>
                                <del>
                                  {humanChangeValue(
                                    change.field,
                                    change.previous,
                                    activeCamp.timezone
                                  )}
                                </del>
                                <span aria-hidden="true">→</span>
                                <ins>
                                  {humanChangeValue(
                                    change.field,
                                    change.next,
                                    activeCamp.timezone
                                  )}
                                </ins>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : row.category === "new" ? (
                        <p className="scoutnet-diff-row__copy">
                          Ny deltagare med Scoutnets namn, avdelning, patrull,
                          närvaro och råa specialkosttext.
                        </p>
                      ) : null}

                      <DecisionSelect
                        row={row}
                        value={draft[row.sourceReference] ?? ""}
                        onChange={(value) => setDraft({
                          ...draft,
                          [row.sourceReference]: value
                        })}
                      />
                    </article>
                  );
                })}
              </div>

              <footer className="scoutnet-preview__footer">
                <div>
                  <strong>
                    {unresolvedDecisionCount > 0
                      ? `${unresolvedDecisionCount} beslut återstår`
                      : "Alla rader har ett beslut"}
                  </strong>
                  <span>
                    Servern kontrollerar diffen och lägerbehörigheten igen
                    innan något sparas.
                  </span>
                </div>
                <Button
                  className="primary-button"
                  onPress={applyPreview}
                  isDisabled={applying || !decisions}
                >
                  {applying
                    ? <LoaderCircle className="spin" aria-hidden="true" size={18} />
                    : <ShieldAlert aria-hidden="true" size={18} />}
                  {applying
                    ? "Sparar avstämningen…"
                    : "Tillämpa granskad avstämning"}
                </Button>
              </footer>
            </div>
          ) : null}
        </>
      )}

      {message ? (
        <p
          className={message.kind === "success"
            ? "form-success"
            : "form-error"}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : result ? (
        <p className="form-success" role="status">
          Synkad {readableDateTime(result.appliedAt)}.
        </p>
      ) : null}
    </section>
  );
}
