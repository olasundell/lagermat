import { LoaderCircle } from "lucide-react";
import { BrandMark } from "../../components/BrandMark";
import { useAuth } from "../auth/AuthContext";
import { DemoStartPanel } from "./DemoStartPanel";
import { demoConfiguration } from "./demoConfiguration";

export function DemoRecoveryPage() {
  const { demoState, startDemo } = useAuth();

  if (!demoConfiguration.siteKey) {
    return (
      <main className="auth-page">
        <section className="auth-card auth-card--compact">
          <h1>Demoläget är inte tillgängligt</h1>
          <p className="auth-card__intro" role="alert">
            {demoConfiguration.error ?? "Robotkontrollen saknar konfiguration."}
          </p>
        </section>
      </main>
    );
  }

  if (demoState.status === "checking" || demoState.status === "starting") {
    return (
      <main className="auth-page">
        <LoaderCircle
          className="spin"
          aria-label="Kontrollerar demoläget"
          size={38}
        />
      </main>
    );
  }

  const expired = demoState.status === "expired";
  return (
    <main className="auth-page">
      <section className="auth-card auth-card--demo-recovery">
        <div className="auth-card__brand"><BrandMark /></div>
        <p className="auth-card__eyebrow">Prova utan konto</p>
        <h1>{expired ? "Demolägret har gått ut" : "Demolägret kunde inte öppnas"}</h1>
        <p className="auth-card__intro">
          {expired
            ? "Det gamla demolägret går inte längre att öppna. Öppna ett nytt för att fortsätta utforska Lägermat."
            : "Förberedelsen blev inte klar. Försök igen för att öppna demolägret."}
        </p>
        <DemoStartPanel
          siteKey={demoConfiguration.siteKey}
          busy={false}
          error={demoState.error}
          buttonLabel={expired ? "Öppna ett nytt demoläger" : "Försök igen"}
          onStart={startDemo}
        />
      </section>
    </main>
  );
}
