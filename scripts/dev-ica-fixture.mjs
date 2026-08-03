import { spawn, spawnSync } from "node:child_process";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseSupabaseEnvironment(output) {
  const environment = new Map();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line.trim());
    if (!match) continue;

    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        fail(`Supabase gav ett ogiltigt värde för ${match[1]}.`);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    environment.set(match[1], value);
  }
  return environment;
}

const status = spawnSync(
  "bash",
  ["scripts/supabase-local.sh", "status", "-o", "env"],
  {
    encoding: "utf8",
    env: { ...process.env, DO_NOT_TRACK: "1" },
    maxBuffer: 1024 * 1024,
  },
);

if (status.error) {
  fail(`Kunde inte läsa den lokala Supabase-miljön: ${status.error.message}`);
}
if (status.status !== 0) {
  fail(
    "Den lokala Supabase-miljön kör inte. Starta den med "
      + "`pnpm supabase:start` och försök igen.",
  );
}

const localEnvironment = parseSupabaseEnvironment(status.stdout);
const supabaseUrl = localEnvironment.get("API_URL")
  ?? localEnvironment.get("SUPABASE_URL");
const publishableKey = localEnvironment.get("PUBLISHABLE_KEY")
  ?? localEnvironment.get("ANON_KEY");
const serviceRoleKey = localEnvironment.get("SECRET_KEY")
  ?? localEnvironment.get("SERVICE_ROLE_KEY");

let parsedSupabaseUrl;
try {
  parsedSupabaseUrl = new URL(supabaseUrl ?? "");
} catch {
  fail("Supabase CLI gav ingen giltig lokal API-adress.");
}
if (
  parsedSupabaseUrl.protocol !== "http:"
  || !["127.0.0.1", "localhost"].includes(parsedSupabaseUrl.hostname)
) {
  fail("ICA-fixturen får bara köras mot lokal Supabase.");
}
if (!publishableKey || !serviceRoleKey) {
  fail("Supabase CLI gav inte de lokala nycklar som ICA-fixturen behöver.");
}

const viteArguments = process.argv.slice(2);
if (viteArguments[0] === "--") viteArguments.shift();

const vite = spawn(
  "./node_modules/.bin/vite",
  [...viteArguments, "--host", "127.0.0.1"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_DEV_AUTO_LOGIN: "true",
      VITE_DEV_AUTO_LOGIN_EMAIL: "oskar@bjorkstad.test",
      VITE_DEV_AUTO_LOGIN_PASSWORD: "lagermat-local-development-only",
      VITE_SUPABASE_URL: parsedSupabaseUrl.origin,
      VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      SUPABASE_URL: parsedSupabaseUrl.origin,
      SUPABASE_PUBLISHABLE_KEY: publishableKey,
      SUPABASE_ANON_KEY: publishableKey,
      SUPABASE_SECRET_KEY: serviceRoleKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      LOCAL_ICA_CATALOGUE_FIXTURE: "true",
      VITE_LOCAL_ICA_CATALOGUE_FIXTURE: "true",
    },
  },
);

vite.on("error", (error) => {
  fail(`Kunde inte starta Vite: ${error.message}`);
});
vite.on("exit", (code, signal) => {
  const signalExitCode = signal === "SIGINT"
    ? 130
    : signal === "SIGTERM"
    ? 143
    : 1;
  process.exit(code ?? signalExitCode);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => vite.kill(signal));
}
