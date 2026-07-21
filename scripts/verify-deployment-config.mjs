import { readFile } from "node:fs/promises";

const netlify = await readFile("netlify.toml", "utf8");
const deployWorkflow = await readFile(".github/workflows/deploy.yml", "utf8");
const reusableDeploy = await readFile(".github/workflows/deploy-environment.yml", "utf8");
const verifyWorkflow = await readFile(".github/workflows/verify.yml", "utf8");
const ignore = await readFile(".gitignore", "utf8");
const invitationFunction = await readFile("supabase/functions/invite-member/index.ts", "utf8");
const hostedSmoke = await readFile("scripts/smoke-hosted.mjs", "utf8");

const assertions = [
  [netlify.includes('command = "node scripts/build-netlify.mjs"'), "Netlify måste använda det härdade byggsteget."],
  [netlify.includes('publish = "dist"'), "Netlify måste publicera dist."],
  [netlify.includes('from = "/*"') && netlify.includes('to = "/index.html"'), "SPA-omskrivningen saknas."],
  [netlify.includes("[context.deploy-preview]") && netlify.includes("[context.branch-deploy]"), "Netlify preview- och branchbyggen måste vara blockerade."],
  [deployWorkflow.includes("workflow_run:"), "Distribution måste följa ett godkänt Verify-flöde."],
  [/db push[^\n]*--dry-run/.test(reusableDeploy), "Fjärrmigrering måste torrköras."],
  [reusableDeploy.includes("environment: production") === false, "Miljön måste väljas av det anropande flödet."],
  [!reusableDeploy.includes("--include-seed"), "Produktionsflödet får aldrig inkludera seed."],
  [reusableDeploy.includes("netlify-cli@26.2.0"), "Netlify CLI-versionen måste vara låst."],
  [verifyWorkflow.includes("bash scripts/actionlint.sh"), "Verify måste lintkontrollera GitHub Actions-flöden."],
  [ignore.includes("*.xlsx") && ignore.includes("supabase/seed/demo_recipes.sql") && ignore.includes(".netlify/") && ignore.includes("output/"), "Repositoryhygienen är ofullständig."],
  [invitationFunction.includes('origin !== appOrigin'), "Inbjudningsfunktionen måste neka alla andra origins."],
  [!/(?:localhost|127\.0\.0\.1)/.test(invitationFunction), "Inbjudningsfunktionen får inte innehålla en hosted CORS-genväg för localhost."],
  [invitationFunction.includes("?invitation=${invitationId}") && !invitationFunction.includes("token=${"), "Inbjudningslänken måste använda UUID och inte en bearer-token."],
  [hostedSmoke.includes('Origin: "https://cors-check.invalid"') && hostedSmoke.includes("access-control-allow-origin"), "Hosted smoke måste prova både tillåten och nekad CORS-origin."]
];

if (process.argv.includes("--hosted")) {
  const supabase = await readFile("supabase/config.toml", "utf8");
  assertions.push(
    [supabase.includes('site_url = "env(APP_ORIGIN)"'), "Hosted Auth site_url måste hämtas från APP_ORIGIN."],
    [supabase.includes("enable_signup = false"), "Publik registrering måste vara avstängd."],
    [supabase.includes("[auth.email.smtp]") && supabase.includes("enabled = true"), "Hosted SMTP måste vara aktiverad."],
    [supabase.includes('pass = "env(SMTP_PASS)"'), "SMTP-lösenordet måste hämtas från miljön."],
    [!supabase.includes("./seed/demo_recipes.sql"), "Genererad utvecklingsseed får inte ingå i databasåterställning."]
  );
}

const failures = assertions.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length > 0) {
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log("Distributionskonfigurationen är statiskt verifierad.");
