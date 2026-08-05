import { LoaderCircle, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "react-aria-components";
import {
  DemoTurnstileChallenges,
  type DemoCaptchaTokens,
  type DemoTurnstileChallengesHandle
} from "./DemoTurnstileChallenges";
import type { DemoStartTokens } from "./demoSessionCoordinator";
import { acceptsRepeatedTurnstileTestToken } from "./demoTurnstileTestMode";

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
  buttonLabel = "Öppna demolägret",
  onStart
}: DemoStartPanelProps) {
  const challenges = useRef<DemoTurnstileChallengesHandle | null>(null);
  const [tokens, setTokens] = useState<DemoCaptchaTokens>({
    authCaptchaToken: null,
    provisionCaptchaToken: null
  });
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const repeatedLocalTestToken = Boolean(
    tokens.authCaptchaToken
    && tokens.provisionCaptchaToken
    && acceptsRepeatedTurnstileTestToken(
      tokens.authCaptchaToken,
      tokens.provisionCaptchaToken,
      siteKey,
      window.location.hostname
    )
  );
  const ready = Boolean(
    tokens.authCaptchaToken
    && tokens.provisionCaptchaToken
    && (
      tokens.authCaptchaToken !== tokens.provisionCaptchaToken
      || repeatedLocalTestToken
    )
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
          : "Demolägret kunde inte öppnas. Försök igen."
      );
    } finally {
      challenges.current?.reset();
    }
  }

  const visibleError = localError ?? captchaError ?? error;

  return (
    <section className="demo-start" aria-labelledby="demo-start-title">
      <p className="demo-start__eyebrow">Kräver inget konto</p>
      <h2 id="demo-start-title">Öppna ett färdigt demoläger</h2>
      <p>
        Du får ett eget demoläger som raderas automatiskt inom 24 timmar.
        Det du gör påverkar ingen annan.
      </p>
      <DemoTurnstileChallenges
        ref={challenges}
        siteKey={siteKey}
        onChange={setTokens}
        onError={setCaptchaError}
      />
      <p className="demo-start__captcha-status" role="status" aria-live="polite">
        {ready
          ? "Kontrollen är klar."
          : "Kontrollerar att du inte är en robot…"}
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
        {busy ? "Förbereder demolägret…" : buttonLabel}
      </Button>
      <p className="demo-start__privacy">
        Ingen e-postadress behövs.
      </p>
    </section>
  );
}
