import { CalendarPlus, X } from "lucide-react";
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

interface CampDraft {
  name: string;
  startsOn: string;
  endsOn: string;
  timezone: string;
}

const initialDraft: CampDraft = {
  name: "",
  startsOn: "",
  endsOn: "",
  timezone: "Europe/Stockholm"
};

export function CreateCampDialog() {
  const { activeMembership, createCamp } = useWorkspace();
  const [draft, setDraft] = useState<CampDraft>(initialDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (activeMembership?.role !== "admin") return null;

  return (
    <DialogTrigger>
      <Button className="secondary-button">
        <CalendarPlus aria-hidden="true" size={18} /> Skapa läger
      </Button>
      <ModalOverlay className="dialog-overlay" isDismissable>
        <Modal className="dialog-modal">
          <Dialog className="camp-dialog" aria-label="Skapa nytt läger">
            {({ close }) => {
              async function handleSubmit(event: FormEvent<HTMLFormElement>) {
                event.preventDefault();
                setError(null);

                const name = draft.name.trim();
                if (name.length < 2 || name.length > 160) {
                  setError("Lägernamnet måste innehålla mellan 2 och 160 tecken.");
                  return;
                }
                if (!draft.startsOn || !draft.endsOn || draft.endsOn < draft.startsOn) {
                  setError("Slutdatumet måste vara samma dag som eller senare än startdatumet.");
                  return;
                }

                setSaving(true);
                try {
                  if (!supabase) {
                    throw new Error("Databasen är inte konfigurerad.");
                  }
                  const { data: assurance, error: assuranceError } =
                    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
                  if (assuranceError) throw assuranceError;
                  if (assurance.currentLevel !== "aal2") {
                    setError("Verifiera dig med tvåstegsverifiering under Team innan du skapar ett läger.");
                    return;
                  }
                  await createCamp({ ...draft, name });
                  setDraft(initialDraft);
                  close();
                } catch (cause) {
                  setError(userFacingError(cause, "Lägret kunde inte skapas."));
                } finally {
                  setSaving(false);
                }
              }

              return (
                <>
                  <div className="camp-dialog__heading">
                    <div>
                      <p className="page-heading__eyebrow">Nytt läger</p>
                      <h2>Skapa nytt läger</h2>
                      <p>Lägret skapas som utkast och blir automatiskt aktivt.</p>
                    </div>
                    <Button className="icon-button" aria-label="Stäng dialogen" onPress={close}>
                      <X aria-hidden="true" size={22} />
                    </Button>
                  </div>

                  <form className="camp-form" onSubmit={handleSubmit}>
                    {error ? <div className="form-error" role="alert">{error}</div> : null}
                    <label className="camp-form__wide">
                      <span>Lägernamn</span>
                      <input
                        name="camp-name"
                        required
                        minLength={2}
                        maxLength={160}
                        autoComplete="off"
                        value={draft.name}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Startdatum</span>
                      <input
                        name="camp-starts-on"
                        type="date"
                        required
                        value={draft.startsOn}
                        onChange={(event) => setDraft({ ...draft, startsOn: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Slutdatum</span>
                      <input
                        name="camp-ends-on"
                        type="date"
                        required
                        min={draft.startsOn || undefined}
                        value={draft.endsOn}
                        onChange={(event) => setDraft({ ...draft, endsOn: event.target.value })}
                      />
                    </label>
                    <label className="camp-form__wide">
                      <span>Tidszon</span>
                      <input
                        name="camp-timezone"
                        required
                        autoComplete="off"
                        value={draft.timezone}
                        onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
                      />
                    </label>
                    <div className="camp-form__actions">
                      <Button className="button-link" onPress={close}>Avbryt</Button>
                      <Button className="primary-button" type="submit" isDisabled={saving}>
                        {saving ? "Skapar läger…" : "Skapa läger"}
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
