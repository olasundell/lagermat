import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "dist");
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".svg", ".txt", ".webmanifest"]);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (textExtensions.has(extname(entry.name)) || entry.name === "_headers") files.push(path);
  }
  return files;
}

function decodeJwtRole(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role ?? null;
  } catch {
    return null;
  }
}

const forbidden = [
  // Router, Dexie and Supabase ship inert localhost feature-detection constants.
  // Reject Lägermat's actual local app/API/Mailpit endpoints rather than those
  // dependency internals.
  { label: "local application URL", pattern: /https?:\\?\/\\?\/(?:127\.0\.0\.1|localhost):(?:5173|5174|54321|54324)\b/i },
  { label: "test email address", pattern: /@[a-z0-9.-]+\.test\b/i },
  { label: "Supabase secret key", pattern: /\b(?:sb_secret_|supabase_secret_)[A-Za-z0-9._-]{12,}\b/ },
  { label: "service-role variable", pattern: /SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY/ }
];

let files;
try {
  files = await collectFiles(root);
} catch (error) {
  console.error(`Kan inte läsa produktionsbygget ${root}: ${error.message}`);
  process.exit(1);
}

const findings = [];
let combined = "";
for (const file of files) {
  const contents = await readFile(file, "utf8");
  combined += `\n${contents}`;
  for (const check of forbidden) {
    if (check.pattern.test(contents)) findings.push(`${relative(root, file)}: ${check.label}`);
  }

  for (const token of contents.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    if (decodeJwtRole(token) === "service_role") findings.push(`${relative(root, file)}: service-role JWT`);
  }
}

const expectedUrl = process.env.VITE_SUPABASE_URL?.trim();
if (expectedUrl) {
  const expectedOrigin = new URL(expectedUrl).origin;
  if (!combined.includes(expectedOrigin)) findings.push(`bygget saknar förväntad Supabase-origin ${expectedOrigin}`);
}

const headers = await readFile(join(root, "_headers"), "utf8").catch(() => "");
if (!headers.includes("Content-Security-Policy:")) findings.push("_headers: Content-Security-Policy saknas");
if (headers.includes("*.supabase.co")) findings.push("_headers: wildcard för Supabase är inte tillåten");
if (expectedUrl && !headers.includes(new URL(expectedUrl).origin)) {
  findings.push("_headers: den exakta Supabase-originen saknas i CSP");
}

if (findings.length > 0) {
  console.error("Produktionsbygget innehåller förbjuden eller saknad konfiguration:");
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log(`Produktionsbygget är kontrollerat: ${files.length} textfiler.`);
