import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createClient } from "@supabase/supabase-js";

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) throw new Error(`Okänt argument: ${value}`);
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Argumentet --${key} saknar värde.`);
    result[key] = next;
    index += 1;
  }
  return result;
}

function required(args, key) {
  const value = args[key]?.trim();
  if (!value) throw new Error(`--${key} måste anges.`);
  return value;
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function validateHostedUrl(value, name) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} måste använda HTTPS.`);
  return url.origin;
}

async function confirmProduction(environment) {
  if (environment !== "production") return;
  if (!input.isTTY) {
    throw new Error("Produktionsbootstrap kräver en interaktiv terminal och uttrycklig bekräftelse.");
  }
  const prompt = createInterface({ input, output });
  const answer = await prompt.question("Skriv production för att skapa den första riktiga organisationen: ");
  prompt.close();
  if (answer !== "production") throw new Error("Produktionsbootstrap avbröts.");
}

async function findUserByEmail(client, email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const environment = required(args, "environment");
  if (environment !== "staging" && environment !== "production") {
    throw new Error("--environment måste vara staging eller production.");
  }

  const adminEmail = required(args, "admin-email").toLowerCase();
  const organizationName = required(args, "organisation-name");
  const organizationSlug = args["organisation-slug"]?.trim() || slugify(organizationName);
  const campName = required(args, "camp-name");
  const startsOn = required(args, "starts-on");
  const endsOn = required(args, "ends-on");
  const timezone = args.timezone?.trim() || "Europe/Stockholm";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || startsOn > endsOn) {
    throw new Error("Lägerdatumen måste vara giltiga ISO-datum och slutdatum får inte vara före startdatum.");
  }
  if (!organizationSlug) throw new Error("Organisationsnamnet kan inte omvandlas till en giltig slug.");

  const supabaseUrl = validateHostedUrl(required(process.env, "SUPABASE_URL"), "SUPABASE_URL");
  const appOrigin = validateHostedUrl(required(process.env, "APP_ORIGIN"), "APP_ORIGIN");
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY eller SUPABASE_SERVICE_ROLE_KEY måste anges.");

  await confirmProduction(environment);

  const client = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const existingUser = await findUserByEmail(client, adminEmail);
  const { data: organizations, error: organizationError } = await client
    .from("organizations")
    .select("id, name, slug")
    .limit(2);
  if (organizationError) throw organizationError;

  if (organizations.length > 0) {
    if (organizations.length !== 1 || organizations[0].slug !== organizationSlug || !existingUser) {
      throw new Error("Projektet innehåller redan en annan organisation; bootstrap vägrar ändra den.");
    }
    const { data: membership, error: membershipError } = await client
      .from("organization_memberships")
      .select("organization_id")
      .eq("organization_id", organizations[0].id)
      .eq("user_id", existingUser.id)
      .eq("role", "admin")
      .eq("status", "active")
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) throw new Error("Organisationen finns men den angivna användaren är inte aktiv administratör.");
    output.write(`Bootstrap var redan klar för ${organizations[0].name} (${organizations[0].id}).\n`);
    return;
  }

  let adminUser = existingUser;
  if (!adminUser) {
    const { data, error } = await client.auth.admin.inviteUserByEmail(adminEmail, {
      redirectTo: `${appOrigin}/auth/callback`
    });
    if (error) throw error;
    adminUser = data.user;
  }

  const { data, error } = await client.rpc("bootstrap_first_organization", {
    p_admin_user_id: adminUser.id,
    p_organization_name: organizationName,
    p_organization_slug: organizationSlug,
    p_camp_name: campName,
    p_starts_on: startsOn,
    p_ends_on: endsOn,
    p_timezone: timezone
  });
  if (error) throw error;
  const created = data?.[0];
  if (!created) throw new Error("Bootstrap returnerade inget resultat.");
  output.write(`Bootstrap klar. Organisation ${created.organization_id}, läger ${created.camp_id}.\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Bootstrap misslyckades: ${message}\n`);
  process.exitCode = 1;
});
