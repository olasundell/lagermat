import { Link } from "@tanstack/react-router";
import { Download, LoaderCircle, ShieldCheck, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Modal,
  ModalOverlay
} from "react-aria-components";
import { supabase } from "../../lib/supabase";
import { userFacingError } from "../../lib/userFacingError";

interface ParticipantPrivacyDialogProps {
  participantId: string;
  participantName: string;
  onDeleted: (displayName: string) => Promise<void> | void;
}

function downloadPrivacyExport(participantId: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob(
    [JSON.stringify(data, null, 2)],
    { type: "application/json;charset=utf-8" }
  ));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `lagermat-personuppgifter-${participantId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ParticipantPrivacyDialog({
  participantId,
  participantName,
  onDeleted
}: ParticipantPrivacyDialogProps) {
  const [working, setWorking] = useState<"export" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  async function hasAal2(): Promise<boolean> {
    if (!supabase) {
      setError("Databasen är inte konfigurerad.");
      return false;
    }
    const { data, error: assuranceError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    const verified = data.currentLevel === "aal2";
    setNeedsMfa(!verified);
    if (!verified) {
      setError("Verifiera dig med tvåstegsverifiering innan du fortsätter.");
    }
    return verified;
  }

  async function exportData() {
    if (!supabase) return;
    setWorking("export");
    setError(null);
    setNeedsMfa(false);
    setSuccess(null);
    try {
      if (!await hasAal2()) return;
      const { data, error: rpcError } = await supabase.rpc(
        "export_participant_privacy_data",
        { p_participant_id: participantId }
      );
      if (rpcError) throw rpcError;
      downloadPrivacyExport(participantId, data);
      setSuccess("Personuppgifterna exporterades som JSON.");
    } catch (cause) {
      setError(userFacingError(cause, "Personuppgifterna kunde inte exporteras."));
    } finally {
      setWorking(null);
    }
  }

  async function deleteParticipant(close: () => void) {
    if (!supabase) return;
    const confirmed = window.confirm(
      `Radera ${participantName} och all tillhörande närvaro och specialkost? `
      + "Åtgärden kan inte ångras i Lägermat."
    );
    if (!confirmed) return;

    setWorking("delete");
    setError(null);
    setNeedsMfa(false);
    setSuccess(null);
    try {
      if (!await hasAal2()) return;
      const { error: rpcError } = await supabase.rpc(
        "delete_participant_for_privacy",
        { p_participant_id: participantId }
      );
      if (rpcError) throw rpcError;
      await onDeleted(participantName);
      close();
    } catch (cause) {
      setError(userFacingError(cause, "Deltagaren kunde inte raderas."));
    } finally {
      setWorking(null);
    }
  }

  return (
    <DialogTrigger>
      <Button
        className="icon-button"
        aria-label={`Integritetsärende för ${participantName}`}
      >
        <ShieldCheck aria-hidden="true" size={18} />
      </Button>
      <ModalOverlay className="dialog-overlay" isDismissable>
        <Modal className="dialog-modal dialog-modal--wide">
          <Dialog
            className="participant-dialog"
            aria-label={`Integritetsärende för ${participantName}`}
          >
            {({ close }) => (
              <>
                <div className="participant-dialog__heading">
                  <div>
                    <p className="page-heading__eyebrow">Personuppgiftsärende</p>
                    <h2>{participantName}</h2>
                    <p>Export och radering kräver administratörsroll och tvåstegsverifiering.</p>
                  </div>
                  <Button
                    className="icon-button"
                    aria-label="Stäng integritetsärendet"
                    onPress={close}
                  >
                    <X aria-hidden="true" size={22} />
                  </Button>
                </div>

                <div className="privacy-request-dialog">
                  <section>
                    <h3>Begäran om tillgång</h3>
                    <p>Exporten innehåller deltagaruppgifter, grupper, närvaro, specialkost, importkälla och tillhörande granskningshändelser.</p>
                    <Button
                      className="secondary-button"
                      onPress={() => void exportData()}
                      isDisabled={working !== null}
                    >
                      {working === "export"
                        ? <LoaderCircle className="spin" aria-hidden="true" size={18} />
                        : <Download aria-hidden="true" size={18} />}
                      Exportera personuppgifter
                    </Button>
                  </section>

                  <section>
                    <h3>Rättelse och begränsning</h3>
                    <p>Rätta aktiva uppgifter med redigeringsknappen i deltagarlistan. Vid begränsning: exportera underlaget, ta bort personen från aktiv planering och lagra bara ärendet i det av organisationen godkända ärendesystemet.</p>
                  </section>

                  <section className="privacy-request-dialog__danger">
                    <h3>Radering</h3>
                    <p>Radering tar bort deltagaren, närvaro och specialkost. En begränsad granskningshändelse utan namn, deltagar-id eller kosttext sparas.</p>
                    <Button
                      className="danger-button"
                      onPress={() => void deleteParticipant(close)}
                      isDisabled={working !== null}
                    >
                      {working === "delete"
                        ? <LoaderCircle className="spin" aria-hidden="true" size={18} />
                        : <Trash2 aria-hidden="true" size={18} />}
                      Radera deltagaren
                    </Button>
                  </section>

                  {error ? <p className="form-error" role="alert">{error}</p> : null}
                  {needsMfa ? (
                    <Link to="/team" className="secondary-button">
                      Öppna tvåstegsverifiering
                    </Link>
                  ) : null}
                  {success ? <p className="form-success" role="status">{success}</p> : null}
                </div>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
