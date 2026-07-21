import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readHostedOrigin() {
  const value = process.env.VITE_SUPABASE_URL?.trim();
  if (!value) fail("VITE_SUPABASE_URL måste vara satt för ett Netlify-bygge.");

  let url;
  try {
    url = new URL(value);
  } catch {
    fail("VITE_SUPABASE_URL är inte en giltig URL.");
  }

  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    fail("VITE_SUPABASE_URL måste vara en ren HTTPS-origin utan autentiseringsuppgifter, query eller fragment.");
  }
  if (url.pathname !== "/") fail("VITE_SUPABASE_URL får inte innehålla en sökväg.");
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    fail("Netlify får inte byggas mot en lokal Supabase-instans.");
  }
  return url.origin;
}

function assertPublishableKey() {
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!key) fail("VITE_SUPABASE_PUBLISHABLE_KEY måste vara satt för ett Netlify-bygge.");
  if (/^(?:sb_secret_|supabase_secret_)/.test(key)) fail("En Supabase-hemlig nyckel får inte användas i Vite.");
}

const supabaseOrigin = readHostedOrigin();
assertPublishableKey();

for (const [command, args, label] of [
  ["./node_modules/.bin/tsc", ["-b"], "TypeScript-kontrollen"],
  ["./node_modules/.bin/vite", ["build"], "Vite-bygget"]
]) {
  const build = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (build.error) fail(`Kunde inte starta ${label}: ${build.error.message}`);
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const realtimeOrigin = supabaseOrigin.replace(/^https:/, "wss:");
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  `connect-src 'self' ${supabaseOrigin} ${realtimeOrigin}`,
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "img-src 'self' data: blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests"
].join("; ");

const headers = `/*
  Cache-Control: no-store
  Content-Security-Policy: ${contentSecurityPolicy}
  Permissions-Policy: accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/index.html
  Cache-Control: no-store

/*.html
  Cache-Control: no-store

/manifest.webmanifest
  Cache-Control: public, max-age=0, must-revalidate

/sw.js
  Cache-Control: public, max-age=0, must-revalidate
  Service-Worker-Allowed: /

/registerSW.js
  Cache-Control: public, max-age=0, must-revalidate

/workbox-*.js
  Cache-Control: public, max-age=0, must-revalidate
`;

const dist = resolve("dist");
await mkdir(dist, { recursive: true });
await writeFile(resolve(dist, "_headers"), headers, "utf8");

const check = spawnSync(process.execPath, ["scripts/check-production-bundle.mjs", "dist"], {
  stdio: "inherit",
  env: process.env
});
if (check.error) fail(`Kunde inte kontrollera produktionsbygget: ${check.error.message}`);
process.exit(check.status ?? 1);
