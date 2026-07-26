import { ExternalLink, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button, Input, Label, TextField } from "react-aria-components";
import { BrandMark } from "../../components/BrandMark";
import { supabaseConfiguration } from "../../lib/supabase";
import { useAuth } from "./AuthContext";

export function LoginPage() {
  const { automaticSignInError, requestMagicLink, status } = useAuth();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const localMailpitUrl = import.meta.env.DEV ? "http://127.0.0.1:54324" : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await requestMagicLink(email);
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Inloggningslänken kunde inte skapas.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-card__brand"><BrandMark /></div>
        <p className="auth-card__eyebrow">Säker lägerplanering</p>
        <h1 id="login-title">Logga in utan lösenord</h1>
        <p className="auth-card__intro">
          Ange e-postadressen som du har blivit inbjuden med. Du får en personlig engångslänk för inloggning.
        </p>

        {status === "unconfigured" ? (
          <div className="auth-notice auth-notice--error" role="alert">
            {supabaseConfiguration.error ?? <>Appen saknar Supabase-konfiguration. Kontrollera miljövariablerna och starta om.</>}
          </div>
        ) : null}

        {automaticSignInError ? (
          <div className="auth-notice auth-notice--error" role="alert">
            Automatisk lokal inloggning misslyckades: {automaticSignInError}
          </div>
        ) : null}

        {sent ? (
          <div className="auth-sent" role="status">
            <Mail aria-hidden="true" size={25} />
            <div>
              <strong>Inloggningslänken är skickad</strong>
              <p>Öppna inkorgen för {email} och använd länken inom en timme.</p>
            </div>
            {supabaseConfiguration.isLocal && localMailpitUrl ? (
              <a href={localMailpitUrl} target="_blank" rel="noreferrer" className="button-link">
                Öppna Mailpit <ExternalLink aria-hidden="true" size={17} />
              </a>
            ) : null}
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <TextField name="email" type="email" isRequired value={email} onChange={setEmail}>
              <Label>E-postadress</Label>
              <Input autoComplete="email" />
            </TextField>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <Button className="primary-button" type="submit" isDisabled={submitting || status !== "configured"}>
              {submitting ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <Mail aria-hidden="true" size={18} />}
              Skicka inloggningslänk
            </Button>
          </form>
        )}

        <div className="auth-card__security">
          <ShieldCheck aria-hidden="true" size={21} />
          <span>Endast inbjudna användare kan logga in</span>
        </div>
      </section>
    </main>
  );
}
