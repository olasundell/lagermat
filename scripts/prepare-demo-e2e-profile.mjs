import {
  access,
  cp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { renderHostedSupabaseConfig } from "./hosted-environment.mjs";

const repositoryRoot = process.cwd();
const profileRoot = resolve(repositoryRoot, ".tmp/demo-e2e-profile");
const markerPath = join(profileRoot, ".generated-by-lagermat-demo-e2e");
const expectedMarker = "generated demo e2e profile v1\n";

if (
  dirname(profileRoot) !== resolve(repositoryRoot, ".tmp")
  || basename(profileRoot) !== "demo-e2e-profile"
  || !profileRoot.startsWith(`${repositoryRoot}${sep}`)
) {
  throw new Error("Den genererade demoprofilens sökväg är inte säker.");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function removeGeneratedProfile() {
  if (!(await exists(profileRoot))) return;
  const marker = await readFile(markerPath, "utf8").catch(() => null);
  if (marker !== expectedMarker) {
    throw new Error(
      "Den befintliga demo-e2e-katalogen saknar rätt markör och lämnas orörd."
    );
  }
  await rm(profileRoot, { recursive: true });
}

function replaceSectionSetting(source, sectionName, setting, value) {
  const escapedSectionName = sectionName.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
  const sectionPattern = new RegExp(
    `(^\\[${escapedSectionName}\\]\\s*$)([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`,
    "m"
  );
  const sectionMatch = source.match(sectionPattern);
  if (!sectionMatch) {
    throw new Error(`Supabase-sektionen ${sectionName} saknas.`);
  }
  const settingPattern = new RegExp(`^${setting}\\s*=.*$`, "m");
  if (!settingPattern.test(sectionMatch[2])) {
    throw new Error(`Inställningen ${sectionName}.${setting} saknas.`);
  }
  const nextSection = sectionMatch[2].replace(
    settingPattern,
    `${setting} = ${value}`
  );
  return source.slice(0, sectionMatch.index)
    + sectionMatch[1]
    + nextSection
    + source.slice(
      sectionMatch.index + sectionMatch[0].length
    );
}

if (process.argv.includes("--clean")) {
  await removeGeneratedProfile();
  process.exit(0);
}

await removeGeneratedProfile();
await mkdir(profileRoot, { recursive: true });
await writeFile(markerPath, expectedMarker, "utf8");
await cp(join(repositoryRoot, "supabase"), join(profileRoot, "supabase"), {
  recursive: true
});
await cp(join(repositoryRoot, "shared"), join(profileRoot, "shared"), {
  recursive: true
});

const configPath = join(profileRoot, "supabase/config.toml");
const sourceConfig = await readFile(configPath, "utf8");
let config = renderHostedSupabaseConfig(sourceConfig, {
  demoEnabled: true,
  smtpPort: 1025
});
config = config.replace(
  /^project_id\s*=.*$/m,
  'project_id = "scoutmat_demo_e2e"'
);

for (const [section, setting, value] of [
  ["api", "port", "55321"],
  ["db", "port", "55322"],
  ["db", "shadow_port", "55320"],
  ["db.pooler", "port", "55329"],
  ["studio", "port", "55323"],
  ["local_smtp", "port", "55324"],
  ["analytics", "port", "55327"],
  ["edge_runtime", "inspector_port", "8183"]
]) {
  config = replaceSectionSetting(config, section, setting, value);
}

await writeFile(configPath, config, "utf8");
console.log(profileRoot);
