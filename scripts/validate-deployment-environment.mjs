const required = [
  "APP_ORIGIN",
  "AUTH_CALLBACK_URL",
  "AUTH_EMAIL_MAX_FREQUENCY",
  "NETLIFY_AUTH_TOKEN",
  "NETLIFY_SITE_ID",
  "SMTP_FROM_ADDRESS",
  "SMTP_FROM_NAME",
  "SMTP_HOST",
  "SMTP_PASS",
  "SMTP_PORT",
  "SMTP_USER",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_PROJECT_REF",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_URL"
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(`Miljökonfiguration saknas: ${missing.join(", ")}`);
  process.exit(1);
}

function exactHttpsOrigin(name) {
  let url;
  try {
    url = new URL(process.env[name]);
  } catch {
    console.error(`${name} är inte en giltig URL.`);
    process.exit(1);
  }
  if (url.protocol !== "https:" || url.origin !== process.env[name] || url.username || url.password) {
    console.error(`${name} måste vara en exakt HTTPS-origin utan avslutande snedstreck.`);
    process.exit(1);
  }
  return url;
}

const environment = process.argv[2];
if (!new Set(["staging", "production"]).has(environment)) {
  console.error("Första argumentet måste vara staging eller production.");
  process.exit(1);
}

const appUrl = exactHttpsOrigin("APP_ORIGIN");
const callbackUrl = new URL(process.env.AUTH_CALLBACK_URL);
if (callbackUrl.origin !== appUrl.origin || callbackUrl.pathname !== "/auth/callback" || callbackUrl.search || callbackUrl.hash) {
  console.error("AUTH_CALLBACK_URL måste vara APP_ORIGIN följt av /auth/callback.");
  process.exit(1);
}
const supabaseUrl = exactHttpsOrigin("VITE_SUPABASE_URL");
if (!/^[a-z0-9]{20}$/.test(process.env.SUPABASE_PROJECT_REF)) {
  console.error("SUPABASE_PROJECT_REF har inte Supabases förväntade format.");
  process.exit(1);
}
if (supabaseUrl.hostname !== `${process.env.SUPABASE_PROJECT_REF}.supabase.co`) {
  console.error("VITE_SUPABASE_URL matchar inte SUPABASE_PROJECT_REF.");
  process.exit(1);
}
if (environment === "production" && appUrl.hostname.endsWith(".netlify.app")) {
  console.error("Produktion måste använda den godkända egna domänen, inte netlify.app.");
  process.exit(1);
}
if (process.env.AUTH_EMAIL_MAX_FREQUENCY !== "1m") {
  console.error("AUTH_EMAIL_MAX_FREQUENCY måste vara 1m i en hostad miljö.");
  process.exit(1);
}
if (!/^\d+$/.test(process.env.SMTP_PORT) || Number(process.env.SMTP_PORT) > 65535) {
  console.error("SMTP_PORT är ogiltig.");
  process.exit(1);
}
if (process.env.SMTP_HOST !== "smtp.resend.com" || process.env.SMTP_PORT !== "587" || process.env.SMTP_USER !== "resend") {
  console.error("SMTP måste använda den godkända Resend-konfigurationen smtp.resend.com:587 med användaren resend.");
  process.exit(1);
}
if (!process.env.SMTP_FROM_ADDRESS.includes("@")) {
  console.error("SMTP_FROM_ADDRESS är ogiltig.");
  process.exit(1);
}
if (/^(?:sb_secret_|supabase_secret_)/.test(process.env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
  console.error("VITE_SUPABASE_PUBLISHABLE_KEY får inte vara en hemlig Supabase-nyckel.");
  process.exit(1);
}

console.log(`${environment} har komplett och konsekvent distributionskonfiguration.`);
