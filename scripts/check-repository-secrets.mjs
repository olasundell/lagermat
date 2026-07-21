import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const listed = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { encoding: "utf8" });
if (listed.status !== 0) {
  console.error(listed.stderr || "Kunde inte lista filer för hemlighetskontroll.");
  process.exit(1);
}

const files = listed.stdout.split("\0").filter(Boolean);
const tracked = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
const trackedFiles = tracked.stdout.split("\0").filter(Boolean);
const forbiddenTrackedFiles = trackedFiles.filter((file) =>
  /(?:^|\/)(?:dev-dist|dist|output|tmp|playwright-report|test-results)\//.test(file)
  || /\.(?:xlsx?|xlsm)$/i.test(file)
);

const secretPatterns = [
  { label: "privat nyckel", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "Supabase secret key", pattern: /\b(?:sb_secret_|supabase_secret_)[A-Za-z0-9._-]{12,}\b/ },
  { label: "GitHub-token", pattern: /\bgh[opusr]_[A-Za-z0-9]{30,}\b/ },
  { label: "GitLab-token", pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { label: "Netlify-token", pattern: /\bnfp_[A-Za-z0-9_-]{20,}\b/ },
  { label: "Resend-token", pattern: /\bre_[A-Za-z0-9]{24,}\b/ },
  { label: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ }
];
const textExtensions = new Set([
  "", ".cjs", ".css", ".env", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".sh", ".sql", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml"
]);

function jwtRole(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).role ?? null;
  } catch {
    return null;
  }
}

const findings = forbiddenTrackedFiles.map((file) => `${file}: filtypen eller artefaktkatalogen får inte versionshanteras`);
for (const file of files) {
  if (!textExtensions.has(extname(file).toLowerCase()) || file === "pnpm-lock.yaml") continue;
  const contents = await readFile(file, "utf8").catch(() => null);
  if (contents === null || contents.includes("\0")) continue;

  for (const check of secretPatterns) {
    if (check.pattern.test(contents)) findings.push(`${file}: ${check.label}`);
  }
  for (const token of contents.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    if (jwtRole(token) === "service_role") findings.push(`${file}: Supabase service-role JWT`);
  }
}

if (findings.length > 0) {
  console.error("Repositorykontrollen hittade material som inte får versionshanteras:");
  [...new Set(findings)].forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log(`Repositorykontrollen är godkänd: ${files.length} filer kontrollerade.`);
