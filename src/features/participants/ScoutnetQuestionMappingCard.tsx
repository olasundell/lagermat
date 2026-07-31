import { useQuery } from "@tanstack/react-query";
import {
  CloudDownload,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { useState } from "react";
import { Button } from "react-aria-components";
import { supabase, supabaseConfiguration } from "../../lib/supabase";
import { useWorkspace } from "../workspace/WorkspaceContext";
import {
  readScoutnetConnectionStatus,
  readScoutnetQuestionCatalogue,
  saveScoutnetQuestionMapping,
  type ScoutnetQuestionCatalogueResponse
} from "./scoutnetApi";
import {
  createScoutnetQuestionMappingDraft,
  mappingFromScoutnetDraft,
  type ScoutnetQuestionMappingDraft
} from "./scoutnetQuestionMappingModel";

interface QuestionSelectProps {
  label: string;
  name: string;
  value: string;
  catalogue: ScoutnetQuestionCatalogueResponse;
  optional?: boolean;
  onChange: (value: string) => void;
}

function QuestionSelect({
  label,
  name,
  value,
  catalogue,
  optional = false,
  onChange
}: QuestionSelectProps) {
  return (
    <label>
      <span>{label}</span>
      <select
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {optional ? "Ingen fråga" : "Välj fråga"}
        </option>
        {catalogue.questions.map((question) => (
          <option key={question.id} value={question.id}>
            {question.label} · #{question.id}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ScoutnetQuestionMappingCard() {
  const { activeCamp, activeMembership } = useWorkspace();
  const [catalogue, setCatalogue] =
    useState<ScoutnetQuestionCatalogueResponse | null>(null);
  const [draft, setDraft] = useState<ScoutnetQuestionMappingDraft | null>(null);
  const [loadingCatalogue, setLoadingCatalogue] = useState(false);
  const [saving, setSaving] = useState(false);
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

  if (!isAdmin || !activeCamp) return null;

  async function loadCatalogue() {
    if (!supabase || !activeCamp) return;
    setLoadingCatalogue(true);
    setMessage(null);
    try {
      const next = await readScoutnetQuestionCatalogue(
        supabase,
        activeCamp.id
      );
      setCatalogue(next);
      setDraft(createScoutnetQuestionMappingDraft(next));
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error
          ? error.message
          : "Scoutnets frågelista kunde inte hämtas."
      });
    } finally {
      setLoadingCatalogue(false);
    }
  }

  async function saveMapping() {
    if (!supabase || !activeCamp || !catalogue || !draft) return;
    const result = mappingFromScoutnetDraft(
      draft,
      catalogue,
      activeCamp.startsOn,
      activeCamp.endsOn
    );
    if (!result.valid) {
      setMessage({ kind: "error", text: result.message });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const status = await saveScoutnetQuestionMapping(
        supabase,
        activeCamp.id,
        result.mapping
      );
      const nextCatalogue = {
        ...catalogue,
        currentMapping: status.questionMapping,
        mappingValid: true,
        mappingUpdatedAt: status.questionMappingUpdatedAt
      };
      setCatalogue(nextCatalogue);
      setDraft({
        ...createScoutnetQuestionMappingDraft(nextCatalogue),
        usesSuggestions: false
      });
      setMessage({
        kind: "success",
        text: "Frågemappningen sparades och omvaliderades mot Scoutnet."
      });
      await statusQuery.refetch();
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error
          ? error.message
          : "Scoutnet-mappningen kunde inte sparas."
      });
    } finally {
      setSaving(false);
    }
  }

  const status = statusQuery.data;
  const specialDietQuestionCount = status?.questionMapping
    .special_diet_question_ids?.length
    ?? (status?.questionMapping.special_diet_question_id ? 1 : 0);
  const attendanceMappingCount = status?.questionMapping
    .attendance_intervals?.length
    ?? status?.questionMapping.attendance_days?.length
    ?? 0;

  return (
    <details className="scoutnet-mapping-card">
      <summary>
        <span className="scoutnet-mapping-card__icon">
          <ShieldCheck aria-hidden="true" size={21} />
        </span>
        <span>
          <strong>Scoutnet-frågemappning</strong>
          <small>
            {status?.connected
              ? status.questionMappingUpdatedAt
                ? "Sparad mappning finns"
                : "Ansluten · mappning behöver kontrolleras"
              : "Valfri administratörsfunktion"}
          </small>
        </span>
      </summary>

      <div className="scoutnet-mapping-card__body">
        <p>
          Scoutnet är ett valfritt komplement till manuell registrering och
          XLSX/CSV. Inga deltagaruppgifter hämtas när sidan öppnas.
        </p>

        {statusQuery.isLoading ? (
          <p className="inline-status">
            <LoaderCircle className="spin" aria-hidden="true" size={17} />
            Läser anslutningsstatus…
          </p>
        ) : statusQuery.error ? (
          <p className="form-error" role="alert">
            {statusQuery.error instanceof Error
              ? statusQuery.error.message
              : "Scoutnet-anslutningen kunde inte läsas."}
          </p>
        ) : !status?.connected ? (
          <p className="scoutnet-mapping-card__notice">
            Ingen Scoutnet-anslutning är sparad för det här lägret. Manuell
            registrering och filimport fungerar som vanligt.
          </p>
        ) : (
          <>
            <div className="scoutnet-mapping-card__connection">
              <span>Scoutnet-projekt {status.projectId}</span>
              {supabaseConfiguration.isLocal ? (
                <span className="scoutnet-local-fixture-label">
                  Lokal syntetisk fixture
                </span>
              ) : (
                <Button
                  className="secondary-button"
                  onPress={loadCatalogue}
                  isDisabled={loadingCatalogue || saving}
                >
                  {loadingCatalogue
                    ? <LoaderCircle className="spin" aria-hidden="true" size={18} />
                    : <CloudDownload aria-hidden="true" size={18} />}
                  {catalogue ? "Hämta frågorna igen" : "Hämta Scoutnet-frågor"}
                </Button>
              )}
            </div>

            {supabaseConfiguration.isLocal ? (
              <p className="scoutnet-mapping-card__notice">
                Testläget gör inga externa frågeanrop. Sparad fixture-mappning:
                {" "}{specialDietQuestionCount} specialkostfrågor och
                {" "}{attendanceMappingCount} närvaromappningar.
              </p>
            ) : null}

            {catalogue && draft ? (
              <div className="scoutnet-mapping-form">
                <p className={
                  draft.usesSuggestions
                    ? "scoutnet-mapping-form__suggestion"
                    : "scoutnet-mapping-form__confirmed"
                }>
                  {draft.usesSuggestions
                    ? "Automatiska förslag har fyllts i. Kontrollera varje val innan du sparar."
                    : catalogue.mappingValid
                      ? "Den sparade mappningen är giltig mot den aktuella frågelistan."
                      : "Den sparade mappningen behöver rättas innan deltagare kan förhandsgranskas."}
                </p>

                <fieldset>
                  <legend>Organisation <small>valfritt</small></legend>
                  <div className="scoutnet-mapping-grid">
                    <QuestionSelect
                      label="Scoutkår eller grupp"
                      name="scoutnet-group-question"
                      value={draft.groupQuestionId}
                      catalogue={catalogue}
                      optional
                      onChange={(groupQuestionId) =>
                        setDraft({ ...draft, groupQuestionId })
                      }
                    />
                    <QuestionSelect
                      label="Avdelning"
                      name="scoutnet-division-question"
                      value={draft.divisionQuestionId}
                      catalogue={catalogue}
                      optional
                      onChange={(divisionQuestionId) =>
                        setDraft({ ...draft, divisionQuestionId })
                      }
                    />
                    <QuestionSelect
                      label="Patrull"
                      name="scoutnet-patrol-question"
                      value={draft.patrolQuestionId}
                      catalogue={catalogue}
                      optional
                      onChange={(patrolQuestionId) =>
                        setDraft({ ...draft, patrolQuestionId })
                      }
                    />
                  </div>
                </fieldset>

                <fieldset>
                  <legend>Specialkost</legend>
                  <p className="field-help">
                    Välj en eller flera frågor. Bara svar från dessa frågor
                    lämnar adaptern.
                  </p>
                  <div className="scoutnet-question-checklist">
                    {catalogue.questions.map((question) => (
                      <label key={question.id}>
                        <input
                          type="checkbox"
                          name={`scoutnet-diet-question-${question.id}`}
                          checked={draft.specialDietQuestionIds.includes(
                            question.id
                          )}
                          onChange={(event) => setDraft({
                            ...draft,
                            specialDietQuestionIds: event.target.checked
                              ? [...draft.specialDietQuestionIds, question.id]
                              : draft.specialDietQuestionIds.filter(
                                  (questionId) => questionId !== question.id
                                )
                          })}
                        />
                        <span>{question.label} <small>#{question.id}</small></span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend>Närvaro</legend>
                  <div className="scoutnet-attendance-mode">
                    <label>
                      <input
                        type="radio"
                        name="scoutnet-attendance-mode"
                        value="intervals"
                        checked={draft.attendanceMode === "intervals"}
                        onChange={() => setDraft({
                          ...draft,
                          attendanceMode: "intervals"
                        })}
                      />
                      Ankomst och avresa
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="scoutnet-attendance-mode"
                        value="days"
                        checked={draft.attendanceMode === "days"}
                        onChange={() => setDraft({
                          ...draft,
                          attendanceMode: "days"
                        })}
                      />
                      En fråga per lägerdag
                    </label>
                  </div>

                  {draft.attendanceMode === "intervals" ? (
                    <div className="scoutnet-repeat-list">
                      {draft.intervals.map((interval, index) => (
                        <div
                          className="scoutnet-repeat-row"
                          key={`interval-${index}`}
                        >
                          <QuestionSelect
                            label={`Ankomst ${index + 1}`}
                            name={`scoutnet-arrival-question-${index}`}
                            value={interval.startsAtQuestionId}
                            catalogue={catalogue}
                            onChange={(startsAtQuestionId) =>
                              setDraft({
                                ...draft,
                                intervals: draft.intervals.map(
                                  (row, rowIndex) => rowIndex === index
                                    ? { ...row, startsAtQuestionId }
                                    : row
                                )
                              })
                            }
                          />
                          <QuestionSelect
                            label={`Avresa ${index + 1}`}
                            name={`scoutnet-departure-question-${index}`}
                            value={interval.endsAtQuestionId}
                            catalogue={catalogue}
                            onChange={(endsAtQuestionId) =>
                              setDraft({
                                ...draft,
                                intervals: draft.intervals.map(
                                  (row, rowIndex) => rowIndex === index
                                    ? { ...row, endsAtQuestionId }
                                    : row
                                )
                              })
                            }
                          />
                          <Button
                            className="icon-button"
                            aria-label={`Ta bort närvaroperiod ${index + 1}`}
                            onPress={() => setDraft({
                              ...draft,
                              intervals: draft.intervals.filter(
                                (_row, rowIndex) => rowIndex !== index
                              )
                            })}
                          >
                            <Trash2 aria-hidden="true" size={18} />
                          </Button>
                        </div>
                      ))}
                      <Button
                        className="text-button"
                        onPress={() => setDraft({
                          ...draft,
                          intervals: [
                            ...draft.intervals,
                            { startsAtQuestionId: "", endsAtQuestionId: "" }
                          ]
                        })}
                      >
                        <Plus aria-hidden="true" size={17} />
                        Lägg till närvaroperiod
                      </Button>
                    </div>
                  ) : (
                    <div className="scoutnet-repeat-list">
                      {draft.days.map((day, index) => (
                        <div
                          className="scoutnet-repeat-row scoutnet-repeat-row--day"
                          key={`day-${index}`}
                        >
                          <QuestionSelect
                            label={`Lägerdag ${index + 1}`}
                            name={`scoutnet-day-question-${index}`}
                            value={day.questionId}
                            catalogue={catalogue}
                            onChange={(questionId) =>
                              setDraft({
                                ...draft,
                                days: draft.days.map(
                                  (row, rowIndex) => rowIndex === index
                                    ? { ...row, questionId }
                                    : row
                                )
                              })
                            }
                          />
                          <label>
                            <span>Datum</span>
                            <input
                              name={`scoutnet-day-date-${index}`}
                              type="date"
                              min={activeCamp.startsOn}
                              max={activeCamp.endsOn}
                              value={day.date}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  days: draft.days.map(
                                    (row, rowIndex) => rowIndex === index
                                      ? { ...row, date: event.target.value }
                                      : row
                                  )
                                })
                              }
                            />
                          </label>
                          <Button
                            className="icon-button"
                            aria-label={`Ta bort lägerdag ${index + 1}`}
                            onPress={() => setDraft({
                              ...draft,
                              days: draft.days.filter(
                                (_row, rowIndex) => rowIndex !== index
                              )
                            })}
                          >
                            <Trash2 aria-hidden="true" size={18} />
                          </Button>
                        </div>
                      ))}
                      <Button
                        className="text-button"
                        onPress={() => setDraft({
                          ...draft,
                          days: [
                            ...draft.days,
                            { questionId: "", date: "" }
                          ]
                        })}
                      >
                        <Plus aria-hidden="true" size={17} />
                        Lägg till lägerdag
                      </Button>
                    </div>
                  )}
                </fieldset>

                <div className="scoutnet-mapping-form__actions">
                  <p>
                    Spara kräver tvåfaktorsautentisering. Servern hämtar
                    frågelistan igen och omvaliderar alla val.
                  </p>
                  <Button
                    className="primary-button"
                    onPress={saveMapping}
                    isDisabled={saving || loadingCatalogue}
                  >
                    {saving
                      ? <LoaderCircle className="spin" aria-hidden="true" size={18} />
                      : <ShieldCheck aria-hidden="true" size={18} />}
                    {saving ? "Sparar…" : "Bekräfta och spara mappning"}
                  </Button>
                </div>
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
        ) : null}
      </div>
    </details>
  );
}
