import {
  RotateCcw,
  ShieldCheck
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "react-aria-components";
import {
  Turnstile,
  type TurnstileInstance
} from "@marsidev/react-turnstile";
import type { DemoInstance } from "./demoSessionCoordinator";
import { DEMO_PROVISION_TURNSTILE_ACTION } from "./DemoTurnstileChallenges";

interface DemoBannerProps {
  instance: DemoInstance;
  siteKey: string;
  resetting: boolean;
  error: string | null;
  onReset: (captchaToken: string) => Promise<void>;
}

function expiryLabel(expiresAt: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(expiresAt));
}

export function DemoBanner({
  instance,
  siteKey,
  resetting,
  error,
  onReset
}: DemoBannerProps) {
  const widget = useRef<TurnstileInstance | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function reset() {
    if (!token || resetting) return;
    const confirmed = window.confirm(
      "Återställningen ersätter hela ditt demoläger med en ny kopia. "
      + "Ändringar i den nuvarande kopian försvinner. Vill du fortsätta?"
    );
    if (!confirmed) return;

    setLocalError(null);
    try {
      await onReset(token);
    } catch (caught) {
      setLocalError(
        caught instanceof Error
          ? caught.message
          : "Demot kunde inte återställas just nu."
      );
    } finally {
      setToken(null);
      widget.current?.reset();
    }
  }

  return (
    <aside className="demo-banner" aria-label="Information om demoläget">
      <div className="demo-banner__message">
        <ShieldCheck aria-hidden="true" size={20} />
        <div>
          <strong>Demoläge · bara syntetiska uppgifter</strong>
          <span>Din privata kopia raderas senast {expiryLabel(instance.expiresAt)}.</span>
        </div>
      </div>
      <div className="demo-banner__reset">
        <Turnstile
          ref={widget}
          id="demo-reset-turnstile"
          siteKey={siteKey}
          options={{
            action: DEMO_PROVISION_TURNSTILE_ACTION,
            appearance: "interaction-only",
            language: "sv",
            responseField: false,
            retry: "auto",
            size: "flexible"
          }}
          onSuccess={(nextToken) => {
            setCaptchaError(null);
            setToken(nextToken);
          }}
          onExpire={() => setToken(null)}
          onError={() => {
            setToken(null);
            setCaptchaError("Robotkontrollen för återställning misslyckades.");
          }}
        />
        <Button
          className="demo-banner__reset-button"
          isDisabled={resetting || !token}
          onPress={() => void reset()}
        >
          <RotateCcw aria-hidden="true" size={17} />
          {resetting ? "Återställer…" : "Återställ mitt demo"}
        </Button>
      </div>
      {localError ?? captchaError ?? error ? (
        <p className="demo-banner__error" role="alert">
          {localError ?? captchaError ?? error}
        </p>
      ) : null}
    </aside>
  );
}
