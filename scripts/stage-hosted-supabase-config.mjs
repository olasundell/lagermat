import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  renderHostedSupabaseConfig,
  validateProtectedDeploymentEnvironment
} from "./hosted-environment.mjs";

const sourceConfigPath = resolve("supabase/config.toml");
const sourceFunctionsPath = resolve("supabase/functions");
const sourceSharedPath = resolve("shared");
const sourceTemplatesPath = resolve("supabase/templates");
const targetRoot = resolve(".tmp/hosted-supabase");
const targetSupabase = resolve(targetRoot, "supabase");
const targetConfigPath = resolve(targetSupabase, "config.toml");
const targetFunctionsPath = resolve(targetSupabase, "functions");
const targetSharedPath = resolve(targetRoot, "shared");
const targetTemplatesPath = resolve(targetSupabase, "templates");
const edgeEnvironmentPath = resolve(".tmp/hosted-edge.env");
const deploymentEnvironment = process.env.DEPLOYMENT_ENVIRONMENT?.trim();

const configuration = validateProtectedDeploymentEnvironment(
  deploymentEnvironment,
  process.env
);
const sourceConfig = await readFile(sourceConfigPath, "utf8");
const hostedConfig = renderHostedSupabaseConfig(sourceConfig, configuration);

await rm(targetRoot, { recursive: true, force: true });
await mkdir(targetSupabase, { recursive: true });
await writeFile(targetConfigPath, hostedConfig, {
  encoding: "utf8",
  mode: 0o600
});
await cp(sourceFunctionsPath, targetFunctionsPath, { recursive: true });
// The staging-only ICA function imports platform-neutral code from the
// repository root. Keep the dependency graph complete in both staged
// workdirs: production disables the function in config, but older CLI
// bundlers may still resolve every versioned function directory.
await cp(sourceSharedPath, targetSharedPath, { recursive: true });
await cp(sourceTemplatesPath, targetTemplatesPath, { recursive: true });

const edgeEnvironment = [
  `APP_ORIGIN=${configuration.appOrigin}`,
  `DEMO_MODE=${configuration.demoEnabled ? "true" : "false"}`,
  ...(configuration.demoEnabled
    ? [`TURNSTILE_SECRET_KEY=${process.env.TURNSTILE_SECRET_KEY}`]
    : [
      `SCOUTNET_SOURCE_REFERENCE_SECRET=${configuration.scoutnetSourceReferenceSecret}`
    ])
].join("\n") + "\n";
await mkdir(resolve(".tmp"), { recursive: true });
await writeFile(edgeEnvironmentPath, edgeEnvironment, {
  encoding: "utf8",
  mode: 0o600
});

console.log(
  `Hosted Supabase config staged for ${deploymentEnvironment}; `
  + `demo=${configuration.demoEnabled}.`
);
