import { LoaderCircle, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "react-aria-components";
import {
  DemoTurnstileChallenges,
  type DemoCaptchaTokens,
  type DemoTurnstileChallengesHandle
} from "./DemoTurnstileChallenges";
import type { DemoStartTokens } from "./demoSessionCoordinator";

interface DemoStartPanelProps {
  siteKey: string;
  busy: boolean;
  error: string | null;
  buttonLabel?: string;
  onStart: (tokens: DemoStartTokens) => Promise<void>;
}

export function DemoStartPanel({
  siteKey,
  busy,
  error,
  buttonLabel = "Prova demot",
  onStart
}: DemoStartPanelProps) {
  const challenges = useRef<DemoTurnstileChallengesHandle | null>(null);
  const [tokens, setTokens] = useState<DemoCaptchaTokens>({
    authCaptchaToken: null,
    provisionCaptchaToken: null
  });
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const ready = Boolean(
    tokens.authCaptchaToken
    && tokens.provisionCaptchaToken
    && tokens.authCaptchaToken !== tokens.provisionCaptchaToken
  );

  async function start() {
    if (
      busy
      || !tokens.authCaptchaToken
      || !tokens.provisionCaptchaToken
    ) {
      return;
    }
    setLocalError(null);
    try {
      await onStart({
        authCaptchaToken: tokens.authCaptchaToken,
        provisionCaptchaToken: tokens.provisionCaptchaToken
      });
    } catch (caught) {
      setLocalError(
        caught instanceof Error
          ? caught.message
          : "Demot kunde inte startas just nu."
      );
    } finally {
      challenges.current?.reset();
    }
  }

  const visibleError = localError ?? captchaError ?? error;

  return (
    <section className="demo-start" aria-labelledby="demo-start-title">
      <p className="demo-start__eyebrow">Ingen registrering</p>
      <h2 id="demo-start-title">Planera i ett eget demoläger</h2>
      <p>
        Du får en privat kopia med syntetiska deltagare, recept och måltider.
        Kopian sparas i högst 24 timmar och påverkar ingen annan.
      </p>
      <DemoTurnstileChallenges
        ref={challenges}
        siteKey={siteKey}
        onChange={setTokens}
        onError={setCaptchaError}
      />
      <p className="demo-start__captcha-status" role="status" aria-live="polite">
        {ready
          ? "Robotkontrollen är klar."
          : "Robotkontrollen förbereds…"}
      </p>
      {visibleError ? (
        <p className="form-error" role="alert">{visibleError}</p>
      ) : null}
      <Button
        className="primary-button demo-start__button"
        isDisabled={busy || !ready}
        onPress={() => void start()}
      >
        {busy ? (
          <LoaderCircle className="spin" aria-hidden="true" size={19} />
        ) : (
          <Sparkles aria-hidden="true" size={19} />
        )}
        {busy ? "Förbereder ditt demoläger…" : buttonLabel}
      </Button>
      <p className="demo-start__privacy">
        Endast testuppgifter används. Ingen e-postadress behövs.
      </p>
    </section>
  );
}
