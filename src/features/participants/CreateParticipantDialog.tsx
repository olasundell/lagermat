import { useQueryClient } from "@tanstack/react-query";
import { UserPlus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Modal,
  ModalOverlay
} from "react-aria-components";
import { supabase } from "../../lib/supabase";
import { userFacingError } from "../../lib/userFacingError";
import { useWorkspace } from "../workspace/WorkspaceContext";

interface ParticipantDraft {
  displayName: string;
  division: string;
  patrol: string;
  mealGroup: string;
  foodFactor: string;
  attendanceStart: string;
  attendanceEnd: string;
  dietaryNote: string;
}

interface CreateParticipantDialogProps {
  onCreated: (displayName: string) => void;
}

function initialDraft(startsOn: string, endsOn: string): ParticipantDraft {
  return {
    displayName: "",
    division: "",
    patrol: "",
    mealGroup: "",
    foodFactor: "1",
    attendanceStart: `${startsOn}T08:00`,
    attendanceEnd: `${endsOn}T18:00`,
    dietaryNote: ""
  };
}

export function CreateParticipantDialog({ onCreated }: CreateParticipantDialogProps) {
  const queryClient = useQueryClient();
  const { activeCamp, activeMembership } = useWorkspace();
  const [draft, setDraft] = useState(() => initialDraft(
    activeCamp?.startsOn ?? "",
    activeCamp?.endsOn ?? ""
  ));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!activeCamp || !activeMembership) return null;
  const camp = activeCamp;
  const membership = activeMembership;

  return (
    <DialogTrigger>
      <Button className="secondary-button">
        <UserPlus aria-hidden="true" size={18} /> Lägg till deltagare
      </Button>
      <ModalOverlay className="dialog-overlay" isDismissable>
        <Modal className="dialog-modal dialog-modal--wide">
          <Dialog className="participant-dialog" aria-label="Lägg till deltagare">
            {({ close }) => {
              async function handleSubmit(event: FormEvent<HTMLFormElement>) {
                event.preventDefault();
                setError(null);

                const displayName = draft.displayName.trim();
                const foodFactor = Number(draft.foodFactor.replace(",", "."));
                const attendanceStart = new Date(draft.attendanceStart);
                const attendanceEnd = new Date(draft.attendanceEnd);

                if (displayName.length < 1 || displayName.length > 160) {
                  setError("Namnet måste innehålla mellan 1 och 160 tecken.");
                  return;
                }
                if ([draft.division, draft.patrol, draft.mealGroup].some((value) => value.trim().length > 120)) {
                  setError("Avdelning, patrull och matlag får innehålla högst 120 tecken.");
                  return;
                }
                if (!Number.isFinite(foodFactor) || foodFactor <= 0 || foodFactor > 10) {
                  setError("Portionsstorleken måste vara större än 0 och högst 10.");
                  return;
                }
                if (
                  Number.isNaN(attendanceStart.getTime())
                  || Number.isNaN(attendanceEnd.getTime())
                  || attendanceEnd <= attendanceStart
                ) {
                  setError("Avresan måste vara senare än ankomsten.");
                  return;
                }
                if (draft.dietaryNote.length > 2000) {
                  setError("Specialkosten får innehålla högst 2 000 tecken.");
                  return;
                }
                if (!supabase) {
                  setError("Deltagaren kan bara sparas när den lokala databasen är konfigurerad.");
                  return;
                }

                setSaving(true);
                try {
                  const { error: rpcError } = await supabase.rpc("create_participant", {
                    p_organization_id: membership.organizationId,
                    p_camp_id: camp.id,
                    p_display_name: displayName,
                    p_division: draft.division,
                    p_patrol: draft.patrol,
                    p_meal_group: draft.mealGroup,
                    p_food_factor: foodFactor,
                    p_attendance_start: attendanceStart.toISOString(),
                    p_attendance_end: attendanceEnd.toISOString(),
                    p_dietary_note: draft.dietaryNote
                  });
                  if (rpcError) throw rpcError;

                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ["participants-page"] }),
                    queryClient.invalidateQueries({ queryKey: ["camp-overview"] }),
                    queryClient.invalidateQueries({ queryKey: ["special-diets"] })
                  ]);

                  setDraft(initialDraft(camp.startsOn, camp.endsOn));
                  onCreated(displayName);
                  close();
                } catch (cause) {
                  setError(userFacingError(cause, "Deltagaren kunde inte läggas till."));
                } finally {
                  setSaving(false);
                }
              }

              return (
                <>
                  <div className="participant-dialog__heading">
                    <div>
                      <p className="page-heading__eyebrow">Enskild deltagare</p>
                      <h2>Lägg till deltagare</h2>
                      <p>Spara bara uppgifter som behövs för mat, grupper och närvaro.</p>
                    </div>
                    <Button className="icon-button" aria-label="Stäng dialogen" onPress={close}>
                      <X aria-hidden="true" size={22} />
                    </Button>
                  </div>

                  <form className="participant-form" onSubmit={handleSubmit}>
                    {error ? <div className="form-error" role="alert">{error}</div> : null}
                    <label className="participant-form__wide">
                      <span>Namn</span>
                      <input
                        name="manual-participant-name"
                        required
                        maxLength={160}
                        autoComplete="name"
                        value={draft.displayName}
                        onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Avdelning</span>
                      <input
                        name="manual-participant-division"
                        maxLength={120}
                        autoComplete="off"
                        value={draft.division}
                        onChange={(event) => setDraft({ ...draft, division: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Patrull</span>
                      <input
                        name="manual-participant-patrol"
                        maxLength={120}
                        autoComplete="off"
                        value={draft.patrol}
                        onChange={(event) => setDraft({ ...draft, patrol: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Matlag</span>
                      <input
                        name="manual-participant-meal-group"
                        maxLength={120}
                        autoComplete="off"
                        value={draft.mealGroup}
                        onChange={(event) => setDraft({ ...draft, mealGroup: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Portionsstorlek</span>
                      <input
                        name="manual-participant-food-factor"
                        required
                        inputMode="decimal"
                        aria-describedby="manual-participant-food-factor-help"
                        value={draft.foodFactor}
                        onChange={(event) => setDraft({ ...draft, foodFactor: event.target.value })}
                      />
                      <small id="manual-participant-food-factor-help">1 = normal, 0,5 = halv portion</small>
                    </label>
                    <label>
                      <span>Ankomst</span>
                      <input
                        name="manual-participant-attendance-start"
                        type="datetime-local"
                        required
                        value={draft.attendanceStart}
                        onChange={(event) => setDraft({ ...draft, attendanceStart: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Avresa</span>
                      <input
                        name="manual-participant-attendance-end"
                        type="datetime-local"
                        required
                        min={draft.attendanceStart || undefined}
                        value={draft.attendanceEnd}
                        onChange={(event) => setDraft({ ...draft, attendanceEnd: event.target.value })}
                      />
                    </label>
                    <label className="participant-form__wide">
                      <span>Specialkost <small>valfritt</small></span>
                      <textarea
                        name="manual-participant-dietary-note"
                        rows={3}
                        maxLength={2000}
                        value={draft.dietaryNote}
                        onChange={(event) => setDraft({ ...draft, dietaryNote: event.target.value })}
                      />
                    </label>
                    <p className="participant-form__privacy">
                      Personnummer, kontaktuppgifter och generell hälsodeklaration ska inte anges här.
                    </p>
                    <div className="participant-form__actions">
                      <Button className="button-link" onPress={close}>Avbryt</Button>
                      <Button className="primary-button" type="submit" isDisabled={saving}>
                        {saving ? "Lägger till…" : "Lägg till deltagare"}
                      </Button>
                    </div>
                  </form>
                </>
              );
            }}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
