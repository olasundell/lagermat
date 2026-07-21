import { Link } from "@tanstack/react-router";
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { useAuth } from "./AuthContext";

export function AuthCallbackPage() {
  const { invitation, clearInvitation } = useAuth();

  return (
    <main className="auth-page">
      <section className="auth-card auth-card--compact" aria-live="polite">
        {invitation.status === "accepting" ? (
          <>
            <LoaderCircle className="spin auth-card__status-icon" aria-hidden="true" size={42} />
            <h1>Accepterar inbjudan</h1>
            <p className="auth-card__intro">Kontrollerar inbjudan och din inloggade e-postadress.</p>
          </>
        ) : invitation.status === "accepted" ? (
          <>
            <CircleCheck className="auth-card__status-icon auth-card__status-icon--success" aria-hidden="true" size={42} />
            <h1>Du är med</h1>
            <p className="auth-card__intro">{invitation.message}</p>
            <Link to="/" className="primary-button" onClick={clearInvitation}>Öppna organisationen</Link>
          </>
        ) : (
          <>
            <TriangleAlert className="auth-card__status-icon auth-card__status-icon--error" aria-hidden="true" size={42} />
            <h1>Inbjudan kunde inte användas</h1>
            <p className="auth-card__intro">{invitation.message ?? "Länken är ogiltig eller har gått ut."}</p>
            <Link to="/" className="button-link" onClick={clearInvitation}>Till översikten</Link>
          </>
        )}
      </section>
    </main>
  );
}
