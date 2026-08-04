import {
  readHostedDemoMode,
  TURNSTILE_ORIGIN
} from "./hosted-environment.mjs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function origin(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} saknas.`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value) fail(`${name} måste vara en exakt HTTPS-origin.`);
  return url.origin;
}

async function fetchOk(url, init) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  fail(`${url} svarade inte korrekt: ${lastError?.message ?? "okänt fel"}`);
}

async function fetchStatus(url, init, expectedStatus) {
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      response = await fetch(url, init);
      if (response.status === expectedStatus) return response;
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await response?.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  fail(`${url} gav inte status ${expectedStatus}: ${lastError?.message ?? "okänt fel"}`);
}

const appOrigin = origin("APP_ORIGIN");
const supabaseOrigin = origin("VITE_SUPABASE_URL");
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
if (!publishableKey) fail("VITE_SUPABASE_PUBLISHABLE_KEY saknas.");
let hostedMode;
try {
  hostedMode = readHostedDemoMode(
    process.env.DEPLOYMENT_ENVIRONMENT?.trim(),
    process.env
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const page = await fetchOk(`${appOrigin}/auth/callback`);
const html = await page.text();
if (!html.includes("<div id=\"root\"></div>")) fail("SPA-fallbacken returnerade inte appskalet.");
if (/https?:\/\/(?:localhost|127\.0\.0\.1)|@[a-z0-9.-]+\.test\b/i.test(html)) {
  fail("Appskalet innehåller lokal eller testkonfiguration.");
}

const csp = page.headers.get("content-security-policy") ?? "";
if (!csp.includes(supabaseOrigin) || csp.includes("*.supabase.co")) {
  fail("CSP saknar den exakta Supabase-originen eller använder wildcard.");
}
if (hostedMode.demoEnabled) {
  if (
    !csp.includes(`script-src 'self' ${TURNSTILE_ORIGIN}`)
    || !csp.includes(`frame-src ${TURNSTILE_ORIGIN}`)
  ) {
    fail("Stagingens CSP saknar den exakta Turnstile-gränsen.");
  }
} else if (
  csp.includes(TURNSTILE_ORIGIN)
  || !csp.includes("frame-src 'none'")
) {
  fail("Produktionens CSP tillåter demo- eller frame-innehåll.");
}
for (const [header, expected] of [
  ["referrer-policy", "no-referrer"],
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"]
]) {
  if (page.headers.get(header) !== expected) fail(`Säkerhetsheadern ${header} är fel eller saknas.`);
}
if (!/no-store/.test(page.headers.get("cache-control") ?? "")) fail("HTML måste levereras med no-store.");

const assetPath = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
if (!assetPath) fail("Hittade ingen hashad tillgång i appskalet.");
const asset = await fetchOk(`${appOrigin}${assetPath}`);
if (!/immutable/.test(asset.headers.get("cache-control") ?? "")) fail("Hashade tillgångar saknar immutable-cache.");

const authHealth = await fetchOk(`${supabaseOrigin}/auth/v1/health`, {
  headers: { apikey: publishableKey }
});
await authHealth.body?.cancel();

const corsProtectedFunctions = hostedMode.demoEnabled
  ? [
    `${supabaseOrigin}/functions/v1/start-demo`,
    `${supabaseOrigin}/functions/v1/ica-catalogue`
  ]
  : [`${supabaseOrigin}/functions/v1/invite-member`];
const corsRequestHeaders = {
  Origin: appOrigin,
  "Access-Control-Request-Method": "POST",
  "Access-Control-Request-Headers": "authorization, apikey, content-type"
};
for (const corsProtectedFunction of corsProtectedFunctions) {
  const allowedPreflight = await fetchStatus(corsProtectedFunction, {
    method: "OPTIONS",
    headers: corsRequestHeaders
  }, 204);
  if (allowedPreflight.headers.get("access-control-allow-origin") !== appOrigin) {
    fail(`${corsProtectedFunction} returnerar inte den exakta app-originen för tillåtna CORS-anrop.`);
  }
  const varyHeaders = (allowedPreflight.headers.get("vary") ?? "")
    .toLowerCase()
    .split(",")
    .map((value) => value.trim());
  if (!varyHeaders.includes("origin")) {
    fail(`${corsProtectedFunction} varierar inte CORS-svaret på Origin.`);
  }
  if (!(allowedPreflight.headers.get("access-control-allow-methods") ?? "").includes("POST")) {
    fail(`${corsProtectedFunction} tillåter inte det avsedda POST-anropet.`);
  }
  await allowedPreflight.body?.cancel();

  const rejectedPreflight = await fetchStatus(corsProtectedFunction, {
    method: "OPTIONS",
    headers: {
      ...corsRequestHeaders,
      Origin: "https://cors-check.invalid"
    }
  }, 403);
  if (rejectedPreflight.headers.has("access-control-allow-origin")) {
    fail(`${corsProtectedFunction} exponerar en CORS-origin för en otillåten webbplats.`);
  }
  await rejectedPreflight.body?.cancel();
}

console.log(
  `Hosted smoke test godkänd för ${appOrigin} `
  + `(${hostedMode.demoEnabled ? "stagingdemo" : "privat produktion"}).`
);
