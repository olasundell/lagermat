export interface DemoConfiguration {
  enabled: boolean;
  siteKey: string | null;
  error: string | null;
}

interface DemoEnvironment {
  mode?: string;
  turnstileSiteKey?: string;
}

export function resolveDemoConfiguration(
  environment: DemoEnvironment
): DemoConfiguration {
  const mode = environment.mode?.trim();
  const siteKey = environment.turnstileSiteKey?.trim() || null;

  if (mode !== undefined && mode !== "" && mode !== "true" && mode !== "false") {
    return {
      enabled: false,
      siteKey: null,
      error: "VITE_DEMO_MODE måste vara true eller false."
    };
  }
  if (mode !== "true") {
    return { enabled: false, siteKey: null, error: null };
  }
  if (!siteKey || siteKey.length > 256) {
    return {
      enabled: false,
      siteKey: null,
      error: "Demoläget saknar en giltig publik Turnstile-sitekey."
    };
  }

  return { enabled: true, siteKey, error: null };
}

export const demoConfiguration = resolveDemoConfiguration({
  mode: import.meta.env.VITE_DEMO_MODE,
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY
});
