import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { supabase } from "../../lib/supabase";

interface AdminMfaGateProps {
  onVerified: () => Promise<unknown> | unknown;
}

export function AdminMfaGate({ onVerified }: AdminMfaGateProps) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    void supabase.auth.mfa.listFactors().then(({ data, error: listError }) => {
      if (!mounted) return;
      setLoading(false);
      if (listError) {
        setError(listError.message);
        return;
      }
      setFactorId(data.totp.find((factor) => factor.status === "verified")?.id ?? null);
    });
    return () => { mounted = false; };
  }, []);

  async function startEnrollment() {
    if (!supabase) return;
    setSubmitting(true);
    setError(null);
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Lägermat"
    });
    setSubmitting(false);
    if (enrollError) {
      setError(enrollError.message);
      return;
    }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !factorId) return;
    setSubmitting(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.replace(/\s/g, "")
    });
    setSubmitting(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    await onVerified();
  }

  return (
    <div className="page page--narrow team-page">
      <section className="team-card mfa-gate" aria-labelledby="mfa-heading">
        <div className="team-card__heading">
          <ShieldCheck aria-hidden="true" size={26} />
          <div>
            <h1 id="mfa-heading">Tvåstegsverifiering krävs</h1>
            <p>Administratörsåtgärder skyddas med en kod från en autentiseringsapp.</p>
          </div>
        </div>

        {loading ? <p><LoaderCircle className="spin" aria-hidden="true" size={18} /> Läser säkerhetsinställningar …</p> : null}

        {!loading && !factorId ? (
          <Button className="primary-button" onPress={() => void startEnrollment()} isDisabled={submitting}>
            <KeyRound aria-hidden="true" size={18} /> Konfigurera autentiseringsapp
          </Button>
        ) : null}

        {qrCode ? (
          <div className="mfa-enrollment">
            <img src={qrCode} alt="QR-kod för Lägermat i autentiseringsappen" />
            <p>Skanna QR-koden. Om det inte går kan du skriva in nyckeln:</p>
            <code>{secret}</code>
          </div>
        ) : null}

        {factorId ? (
          <form className="auth-form mfa-form" onSubmit={verify}>
            <label htmlFor="mfa-code">Sexsiffrig kod</label>
            <input
              id="mfa-code"
              name="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,11}"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
            <Button className="primary-button" type="submit" isDisabled={submitting || code.replace(/\s/g, "").length !== 6}>
              {submitting ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <ShieldCheck aria-hidden="true" size={18} />}
              Verifiera och fortsätt
            </Button>
          </form>
        ) : null}

        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
