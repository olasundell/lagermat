import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourceConfigPath = resolve("supabase/config.toml");
const sourceTemplatesPath = resolve("supabase/templates");
const targetRoot = resolve(".tmp/hosted-supabase");
const targetSupabase = resolve(targetRoot, "supabase");
const targetConfigPath = resolve(targetSupabase, "config.toml");
const targetTemplatesPath = resolve(targetSupabase, "templates");

const smtpPort = process.env.SMTP_PORT?.trim();
if (!smtpPort || !/^\d+$/.test(smtpPort) || Number(smtpPort) > 65535) {
  throw new Error("SMTP_PORT must be a valid integer before staging hosted Supabase config.");
}

const sourceConfig = await readFile(sourceConfigPath, "utf8");
const localPortSetting = "port = 1025";
if (!sourceConfig.includes(localPortSetting)) {
  throw new Error("Expected the versioned Supabase config to retain Mailpit port 1025.");
}

const hostedConfig = sourceConfig.replace(localPortSetting, `port = ${smtpPort}`);
if (hostedConfig === sourceConfig || !hostedConfig.includes(`port = ${smtpPort}`)) {
  throw new Error("Could not stage the hosted SMTP port in Supabase config.");
}

await rm(targetRoot, { recursive: true, force: true });
await mkdir(targetSupabase, { recursive: true });
await writeFile(targetConfigPath, hostedConfig, { encoding: "utf8", mode: 0o600 });
await cp(sourceTemplatesPath, targetTemplatesPath, { recursive: true });

console.log(`Hosted Supabase config staged with SMTP port ${smtpPort}.`);
