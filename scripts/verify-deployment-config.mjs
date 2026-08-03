import { readFile } from "node:fs/promises";

const netlify = await readFile("netlify.toml", "utf8");
const deployWorkflow = await readFile(".github/workflows/deploy.yml", "utf8");
const reusableDeploy = await readFile(".github/workflows/deploy-environment.yml", "utf8");
const verifyWorkflow = await readFile(".github/workflows/verify.yml", "utf8");
const ignore = await readFile(".gitignore", "utf8");
const invitationFunction = await readFile("supabase/functions/invite-member/index.ts", "utf8");
const demoFunction = await readFile("supabase/functions/start-demo/index.ts", "utf8");
const demoHandler = await readFile("supabase/functions/start-demo/handler.ts", "utf8");
const scoutnetFunction = await readFile("supabase/functions/scoutnet-connection/index.ts", "utf8");
const scoutnetHandler = await readFile("supabase/functions/scoutnet-connection/handler.ts", "utf8");
const scoutnetAdapter = await readFile("supabase/functions/scoutnet-connection/adapter.ts", "utf8");
const supabaseConfig = await readFile("supabase/config.toml", "utf8");
const environmentExample = await readFile(".env.example", "utf8");
const loginPage = await readFile("src/features/auth/LoginPage.tsx", "utf8");
const hostedSmoke = await readFile("scripts/smoke-hosted.mjs", "utf8");
const hostedBoundary = await readFile("scripts/hosted-environment.mjs", "utf8");
const hostedBoundaryVerification = await readFile("scripts/verify-hosted-environment-boundaries.mjs", "utf8");
const hostedBuild = await readFile("scripts/build-netlify.mjs", "utf8");
const configPushStep = reusableDeploy.match(
  / {6}- name: Push hosted Auth and SMTP configuration[\s\S]*?(?=\n {6}- name: |$)/
)?.[0] ?? "";
const removeForbiddenSecretStep = reusableDeploy.match(
  / {6}- name: Remove mode-forbidden Edge Function secret[\s\S]*?(?=\n {6}- name: |$)/
)?.[0] ?? "";
const setProtectedSecretStep = reusableDeploy.match(
  / {6}- name: Set protected Edge Function environment[\s\S]*?(?=\n {6}- name: |$)/
)?.[0] ?? "";

const assertions = [
  [netlify.includes('command = "node scripts/build-netlify.mjs"'), "Netlify måste använda det härdade byggsteget."],
  [netlify.includes('publish = "dist"'), "Netlify måste publicera dist."],
  [netlify.includes('from = "/*"') && netlify.includes('to = "/index.html"'), "SPA-omskrivningen saknas."],
  [netlify.includes("[context.deploy-preview]") && netlify.includes("[context.branch-deploy]"), "Netlify preview- och branchbyggen måste vara blockerade."],
  [deployWorkflow.includes("workflow_run:"), "Distribution måste följa ett godkänt Verify-flöde."],
  [/db push[^\n]*--dry-run/.test(reusableDeploy), "Fjärrmigrering måste torrköras."],
  [reusableDeploy.includes("environment: production") === false, "Miljön måste väljas av det anropande flödet."],
  [/jobs:\n {2}deploy:[\s\S]*?\n {4}env:\n[\s\S]*?\n {6}DEPLOYMENT_ENVIRONMENT: \$\{\{ inputs\.environment_name \}\}[\s\S]*?\n {4}steps:/.test(reusableDeploy), "Deployjobbet måste exponera vald miljö för samtliga miljömedvetna steg."],
  [!reusableDeploy.includes("--include-seed"), "Produktionsflödet får aldrig inkludera seed."],
  [reusableDeploy.includes("netlify-cli@26.2.0"), "Netlify CLI-versionen måste vara låst."],
  [reusableDeploy.includes("stage-hosted-supabase-config.mjs"), "Hosted Supabase-konfiguration måste först genereras i den skyddade temporära katalogen."],
  [
    configPushStep.includes("working-directory: .tmp/hosted-supabase")
      && configPushStep.includes("../../node_modules/.bin/supabase config push")
      && configPushStep.includes('--project-ref "$SUPABASE_PROJECT_REF"')
      && configPushStep.includes("--yes")
      && !configPushStep.includes("--workdir"),
    "Hosted Supabase config push måste köras från den typkorrekta temporära katalogen utan CLI:ns opålitliga --workdir-flagga."
  ],
  [reusableDeploy.includes("DEMO_MODE: ${{ vars.DEMO_MODE }}") && reusableDeploy.includes("VITE_DEMO_MODE: ${{ vars.DEMO_MODE }}"), "Deployflödet måste härleda klientens demoläge från samma skyddade miljövariabel som servern."],
  [reusableDeploy.includes("TURNSTILE_SECRET_KEY: ${{ secrets.TURNSTILE_SECRET_KEY }}") && reusableDeploy.includes("VITE_TURNSTILE_SITE_KEY: ${{ vars.TURNSTILE_SITE_KEY }}"), "Stagingflödet måste koppla Turnstiles hemliga och publika värden till rätt exekveringsyta."],
  [reusableDeploy.includes("SCOUTNET_SOURCE_REFERENCE_SECRET: ${{ secrets.SCOUTNET_SOURCE_REFERENCE_SECRET }}"), "Det privata produktionsflödet måste kunna sätta Scoutnets serverhemlighet utan Vite-exponering."],
  [removeForbiddenSecretStep.includes("SCOUTNET_SOURCE_REFERENCE_SECRET") && removeForbiddenSecretStep.includes("TURNSTILE_SECRET_KEY") && removeForbiddenSecretStep.includes('supabase secrets unset "$forbidden_secret"'), "Deployflödet måste välja och radera den Edge-hemlighet som är förbjuden i respektive läge."],
  [
    removeForbiddenSecretStep.includes("supabase secrets list")
      && removeForbiddenSecretStep.includes("--output json")
      && removeForbiddenSecretStep.includes("JSON.parse")
      && removeForbiddenSecretStep.includes("Array.isArray")
      && removeForbiddenSecretStep.includes("secret.name === process.env.FORBIDDEN_SECRET")
      && removeForbiddenSecretStep.includes('case "$forbidden_secret_state" in')
      && !removeForbiddenSecretStep.includes("|| true"),
    "Borttagning av mode-förbjudna Edge-hemligheter måste vara idempotent utan att maskera list-, format- eller providerfel."
  ],
  [
    setProtectedSecretStep.includes("working-directory: .tmp/hosted-supabase")
      && setProtectedSecretStep.includes("../../node_modules/.bin/supabase secrets set")
      && setProtectedSecretStep.includes("--env-file ../hosted-edge.env")
      && setProtectedSecretStep.includes('--project-ref "$SUPABASE_PROJECT_REF"')
      && !setProtectedSecretStep.includes("--workdir"),
    "Edge Function-hemligheter måste sättas från den typkorrekta temporära Supabase-katalogen med dess skyddade syskonfil."
  ],
  [reusableDeploy.includes("rm -f .tmp/hosted-edge.env"), "Den skyddade temporära Edge Function-filen måste alltid raderas från repo-roten."],
  [reusableDeploy.includes("--functions=.tmp/netlify-static-functions") && reusableDeploy.includes("--no-build"), "Netlify-publiceringen måste använda den verifierade statiska artefakten och en uttryckligen tom Functions-katalog."],
  [verifyWorkflow.includes("bash scripts/actionlint.sh"), "Verify måste lintkontrollera GitHub Actions-flöden."],
  [verifyWorkflow.includes("verify-hosted-environment-boundaries.mjs"), "Verify måste kontrollera staging-/produktionsgränsen utan provideranrop."],
  [verifyWorkflow.includes("DEPLOYMENT_ENVIRONMENT: production") && verifyWorkflow.includes("DEPLOYMENT_ENVIRONMENT: staging"), "Verify måste bygga både privat produktion och publik stagingdemo."],
  [/integration:[\s\S]*?env:\s*\n\s*DEMO_MODE: "false"\s*\n\s*VITE_DEMO_MODE: "false"/.test(verifyWorkflow), "Privat auth-acceptans måste välja DEMO_MODE=false explicit utan att ändra stagingdemots standard."],
  [verifyWorkflow.includes("sed -i '${/^$/d;}' .tmp/database.generated.ts"), "Genererad typkontroll måste normalisera Supabase CLI:s avslutande tomrad."],
  [ignore.includes("*.xlsx") && ignore.includes("supabase/seed/demo_recipes.sql") && ignore.includes(".netlify/") && ignore.includes("output/"), "Repositoryhygienen är ofullständig."],
  [invitationFunction.includes('origin !== appOrigin'), "Inbjudningsfunktionen måste neka alla andra origins."],
  [!/(?:localhost|127\.0\.0\.1)/.test(invitationFunction), "Inbjudningsfunktionen får inte innehålla en hosted CORS-genväg för localhost."],
  [invitationFunction.includes("?invitation=${invitationId}") && !invitationFunction.includes("token=${"), "Inbjudningslänken måste använda UUID och inte en bearer-token."],
  [demoFunction.includes("context.supabaseAdmin.auth.getUser") && demoFunction.includes('"provision_demo_instance"'), "Demofunktionen måste verifiera den persistenta Auth-användaren före service-RPC:n."],
  [demoHandler.includes('request.headers.get("Origin") !== appOrigin') && !demoHandler.includes('"Access-Control-Allow-Origin": "*"'), "Demofunktionen måste använda exakt CORS-origin utan wildcard."],
  [demoHandler.includes('keys.length !== 2') && !demoHandler.includes("body.organizationId") && !demoHandler.includes("body.userId"), "Demobegäran får inte acceptera klientvalda användar- eller tenant-ID:n."],
  [demoHandler.includes("START_DEMO_TURNSTILE_ACTION") && demoHandler.includes("turnstile.hostname !== configuration.appHostname"), "Demofunktionen måste validera Turnstile action och hostname."],
  [demoHandler.includes('environment.demoMode !== "true"') && demoHandler.includes('"demo_disabled"'), "Demofunktionen måste neka alla miljöer där serverns DEMO_MODE inte är true."],
  [scoutnetFunction.includes("context.supabaseAdmin.auth.getUser") && scoutnetFunction.includes('"connect_scoutnet_project"'), "Scoutnet-funktionen måste verifiera Auth-användaren före service-RPC:n."],
  [scoutnetHandler.includes('request.headers.get("Origin") !== appOrigin') && !scoutnetHandler.includes('"Access-Control-Allow-Origin": "*"'), "Scoutnet-funktionen måste använda exakt CORS-origin utan wildcard."],
  [scoutnetAdapter.includes("createAuthorizationHeader") && scoutnetAdapter.includes('redirect: "error"'), "Scoutnet-funktionen måste använda den låsta Basic Auth-hjälparen utan redirect."],
  [scoutnetHandler.includes('"question-catalogue"') && scoutnetHandler.includes('"participant-snapshot"') && scoutnetHandler.includes("validateScoutnetQuestionMappingAgainstCatalogue"), "Scoutnet-funktionen måste exponera avgränsad katalog/snapshot och omvalidera mappningen."],
  [scoutnetAdapter.includes("crypto.subtle") && scoutnetAdapter.includes('"HMAC"') && scoutnetAdapter.includes('"SHA-256"') && scoutnetAdapter.includes("scoutnet:v1:"), "Scoutnet-adaptern måste pseudonymisera källreferenser med HMAC."],
  [scoutnetFunction.includes("SCOUTNET_SOURCE_REFERENCE_SECRET") && supabaseConfig.includes('SCOUTNET_SOURCE_REFERENCE_SECRET = "env(SCOUTNET_SOURCE_REFERENCE_SECRET)"'), "HMAC-hemligheten måste vara server-side Edge Function-konfiguration."],
  [scoutnetFunction.includes("SCOUTNET_RECONCILIATION_MODE") && supabaseConfig.includes('SCOUTNET_RECONCILIATION_MODE = "env(SCOUTNET_RECONCILIATION_MODE)"') && hostedBoundary.includes("Hostade miljöer får inte få SCOUTNET_RECONCILIATION_MODE"), "Scoutnet-fixturen måste vara en lokal server-gate som nekas i hostade miljöer."],
  [environmentExample.includes("SCOUTNET_SOURCE_REFERENCE_SECRET=") && !environmentExample.includes("VITE_SCOUTNET_SOURCE_REFERENCE_SECRET"), "Scoutnet-HMAC-hemligheten måste dokumenteras utan VITE-prefix."],
  [!scoutnetHandler.includes("console.") && !scoutnetFunction.includes("console.") && !scoutnetAdapter.includes("console."), "Scoutnet-anslutningsflödet får inte logga nycklar, råsvar eller deltagardata."],
  [invitationFunction.includes('demoMode === "true"') && invitationFunction.includes("Inbjudningar är avstängda i demoläget."), "Inbjudningsfunktionen måste vara avstängd i demoläget."],
  [loginPage.includes("demoEnabled ? \"Prova Lägermat\"") && !loginPage.includes("eller logga in"), "Stagingens demoinloggning får inte erbjuda e-postflödet."],
  [hostedBoundary.includes("DEMO_MODE och VITE_DEMO_MODE måste vara identiska") && hostedBoundary.includes("Produktion får inte få TURNSTILE_SECRET_KEY"), "Den hostade miljövalidatorn måste binda klient-/serverläge och neka demohemligheter i produktion."],
  [hostedBoundaryVerification.includes("staging är demo-only och produktion privat"), "Den säkra CI-matrisen för miljögränser saknas."],
  [hostedBuild.includes("TURNSTILE_ORIGIN") && hostedBuild.includes("frame-src 'none'"), "CSP måste vara Turnstile-avgränsad i staging och frame-nekande i produktion."],
  [hostedSmoke.includes('Origin: "https://cors-check.invalid"') && hostedSmoke.includes("access-control-allow-origin"), "Hosted smoke måste prova både tillåten och nekad CORS-origin."]
];

if (process.argv.includes("--hosted")) {
  const supabase = supabaseConfig;
  assertions.push(
    [supabase.includes('site_url = "env(APP_ORIGIN)"'), "Hosted Auth site_url måste hämtas från APP_ORIGIN."],
    [supabase.includes("enable_signup = false"), "Publik registrering måste vara avstängd."],
    [supabase.includes("[auth.email.smtp]") && supabase.includes("enabled = true"), "Hosted SMTP måste vara aktiverad."],
    [supabase.includes("port = 1025") && !supabase.includes('port = "env(SMTP_PORT)"'), "Versionshanterad Supabase-konfiguration måste använda en giltig lokal SMTP-port."],
    [hostedBoundary.includes('"port",\n      String(smtpPort)') && hostedBoundary.includes("Number.isInteger(smtpPort)"), "Hosted Supabase-konfiguration måste validera och skriva SMTP_PORT som ett TOML-heltal."],
    [supabase.includes('pass = "env(SMTP_PASS)"'), "SMTP-lösenordet måste hämtas från miljön."],
    [supabase.includes('TURNSTILE_SECRET_KEY = "env(TURNSTILE_SECRET_KEY)"'), "Turnstile-hemligheten måste komma från servermiljön."],
    [supabase.includes('DEMO_MODE = "env(DEMO_MODE)"'), "Edge Functions måste få ett separat server-side DEMO_MODE."],
    [/\[functions\.start-demo\][\s\S]*?verify_jwt = true/.test(supabase), "Demofunktionen måste verifiera användar-JWT."],
    [/\[functions\.scoutnet-connection\][\s\S]*?verify_jwt = true/.test(supabase), "Scoutnet-funktionen måste verifiera användar-JWT."],
    [supabase.includes('SCOUTNET_SOURCE_REFERENCE_SECRET = "env(SCOUTNET_SOURCE_REFERENCE_SECRET)"'), "Scoutnet-HMAC-hemligheten måste komma från servermiljön."],
    [!supabase.includes("./seed/demo_recipes.sql"), "Genererad utvecklingsseed får inte ingå i databasåterställning."]
  );
}

const failures = assertions.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length > 0) {
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log("Distributionskonfigurationen är statiskt verifierad.");
