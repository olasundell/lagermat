import {
  Turnstile,
  type TurnstileInstance
} from "@marsidev/react-turnstile";
import {
  forwardRef,
  useImperativeHandle,
  useRef
} from "react";

export const DEMO_AUTH_TURNSTILE_ACTION = "anonymous-sign-in";
export const DEMO_PROVISION_TURNSTILE_ACTION = "start-demo";

export interface DemoCaptchaTokens {
  authCaptchaToken: string | null;
  provisionCaptchaToken: string | null;
}

export interface DemoTurnstileChallengesHandle {
  reset: () => void;
}

interface DemoTurnstileChallengesProps {
  siteKey: string;
  onChange: (tokens: DemoCaptchaTokens) => void;
  onError: (message: string | null) => void;
}

export const DemoTurnstileChallenges = forwardRef<
  DemoTurnstileChallengesHandle,
  DemoTurnstileChallengesProps
>(function DemoTurnstileChallenges({ siteKey, onChange, onError }, forwardedRef) {
  const authWidget = useRef<TurnstileInstance | null>(null);
  const provisionWidget = useRef<TurnstileInstance | null>(null);
  const tokens = useRef<DemoCaptchaTokens>({
    authCaptchaToken: null,
    provisionCaptchaToken: null
  });

  function updateTokens(nextTokens: Partial<DemoCaptchaTokens>) {
    tokens.current = { ...tokens.current, ...nextTokens };
    onChange(tokens.current);
  }

  useImperativeHandle(forwardedRef, () => ({
    reset: () => {
      authWidget.current?.reset();
      provisionWidget.current?.reset();
      updateTokens({
        authCaptchaToken: null,
        provisionCaptchaToken: null
      });
      onError(null);
    }
  }));

  const commonOptions = {
    appearance: "interaction-only" as const,
    language: "sv",
    responseField: false,
    retry: "auto" as const,
    size: "flexible" as const
  };

  return (
    <div className="demo-captcha" aria-label="Robotkontroll för demo">
      <Turnstile
        ref={authWidget}
        id="demo-auth-turnstile"
        siteKey={siteKey}
        options={{
          ...commonOptions,
          action: DEMO_AUTH_TURNSTILE_ACTION
        }}
        onSuccess={(token) => {
          onError(null);
          updateTokens({ authCaptchaToken: token });
        }}
        onExpire={() => updateTokens({ authCaptchaToken: null })}
        onError={() => {
          updateTokens({ authCaptchaToken: null });
          onError("Den första robotkontrollen misslyckades. Försök igen.");
        }}
      />
      <Turnstile
        ref={provisionWidget}
        id="demo-provision-turnstile"
        siteKey={siteKey}
        options={{
          ...commonOptions,
          action: DEMO_PROVISION_TURNSTILE_ACTION
        }}
        onSuccess={(token) => {
          onError(null);
          updateTokens({ provisionCaptchaToken: token });
        }}
        onExpire={() => updateTokens({ provisionCaptchaToken: null })}
        onError={() => {
          updateTokens({ provisionCaptchaToken: null });
          onError("Den andra robotkontrollen misslyckades. Försök igen.");
        }}
      />
    </div>
  );
});
