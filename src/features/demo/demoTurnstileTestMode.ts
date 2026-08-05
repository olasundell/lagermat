export const TURNSTILE_ALWAYS_PASS_SITE_KEY =
  "1x00000000000000000000AA";
export const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

export function isLocalTurnstileTestConfiguration(
  siteKey: string | null,
  hostname: string
): boolean {
  return siteKey === TURNSTILE_ALWAYS_PASS_SITE_KEY
    && isLoopbackHostname(hostname);
}

export function acceptsRepeatedTurnstileTestToken(
  authToken: string,
  provisionToken: string,
  siteKey: string | null,
  hostname: string
): boolean {
  return isLocalTurnstileTestConfiguration(siteKey, hostname)
    && authToken === TURNSTILE_DUMMY_TOKEN
    && provisionToken === TURNSTILE_DUMMY_TOKEN;
}
