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
          <h1>Demot är inte tillgängligt</h1>
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
          aria-label="Kontrollerar demosessionen"
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
        <p className="auth-card__eyebrow">Din privata demo</p>
        <h1>{expired ? "Demot har gått ut" : "Demot behöver förberedas"}</h1>
        <p className="auth-card__intro">
          {expired
            ? "Den gamla kopian går inte längre att öppna. När du fortsätter rensas bara den här demoidentitetens lokala data och en ny kopia skapas."
            : "Sessionen finns kvar, men saknar en färdig demokopia. Försök igen för att slutföra den."}
        </p>
        <DemoStartPanel
          siteKey={demoConfiguration.siteKey}
          busy={false}
          error={demoState.error}
          buttonLabel="Starta ett nytt demo"
          onStart={startDemo}
        />
      </section>
    </main>
  );
}
