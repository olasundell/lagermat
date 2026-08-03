import { readFile } from "node:fs/promises";
import {
  renderHostedSupabaseConfig,
  validateProtectedDeploymentEnvironment
} from "./hosted-environment.mjs";

const common = {
  APP_ORIGIN: "https://lagermat-staging.netlify.app",
  AUTH_CALLBACK_URL:
    "https://lagermat-staging.netlify.app/auth/callback",
  AUTH_EMAIL_MAX_FREQUENCY: "1m",
  NETLIFY_AUTH_TOKEN: "ci-netlify-placeholder",
  NETLIFY_SITE_ID: "ci-site-placeholder",
  SUPABASE_ACCESS_TOKEN: "ci-access-placeholder",
  SUPABASE_DB_PASSWORD: "ci-database-placeholder",
  SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ci_placeholder",
  VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co"
};
const staging = {
  ...common,
  DEMO_MODE: "true",
  VITE_DEMO_MODE: "true",
  VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA"
};
const production = {
  ...common,
  APP_ORIGIN: "https://mat.example.se",
  AUTH_CALLBACK_URL: "https://mat.example.se/auth/callback",
  DEMO_MODE: "false",
  VITE_DEMO_MODE: "false",
  SMTP_FROM_ADDRESS: "auth@example.se",
  SMTP_FROM_NAME: "Lägermat",
  SMTP_HOST: "smtp.resend.com",
  SMTP_PASS: "ci-smtp-placeholder",
  SMTP_PORT: "587",
  SMTP_USER: "resend",
  SCOUTNET_SOURCE_REFERENCE_SECRET:
    "ci-scoutnet-source-reference-secret-placeholder"
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectFailure(label, operation, expectedMessage) {
  try {
    operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(
      message.includes(expectedMessage),
      `${label} gav fel felmeddelande: ${message}`
    );
    return;
  }
  throw new Error(`${label} skulle ha nekats.`);
}

const stagingConfiguration = validateProtectedDeploymentEnvironment(
  "staging",
  staging
);
const productionConfiguration = validateProtectedDeploymentEnvironment(
  "production",
  production
);
assert(stagingConfiguration.demoEnabled, "Stagingdemot aktiverades inte.");
assert(!productionConfiguration.demoEnabled, "Produktionens demo stängdes inte av.");

for (const [label, environment, expected] of [
  [
    "olika klient- och serverläge",
    { ...staging, VITE_DEMO_MODE: "false" },
    "måste vara identiska"
  ],
  [
    "SMTP i staging",
    { ...staging, SMTP_HOST: "smtp.resend.com" },
    "får inte få SMTP"
  ],
  [
    "Turnstile i produktion",
    { ...production, VITE_TURNSTILE_SITE_KEY: "unexpected-site-key" },
    "Produktion får inte innehålla"
  ],
  [
    "Scoutnet-hemlighet i staging",
    {
      ...staging,
      SCOUTNET_SOURCE_REFERENCE_SECRET:
        "must-not-exist-in-public-staging-environment"
    },
    "Stagingdemot får inte få SCOUTNET_SOURCE_REFERENCE_SECRET"
  ],
  [
    "Scoutnet-fixture i staging",
    {
      ...staging,
      SCOUTNET_RECONCILIATION_MODE: "fixture"
    },
    "Hostade miljöer får inte få SCOUTNET_RECONCILIATION_MODE"
  ],
  [
    "egen domän för staging",
    {
      ...staging,
      APP_ORIGIN: "https://demo.example.se",
      AUTH_CALLBACK_URL: "https://demo.example.se/auth/callback"
    },
    "fasta netlify.app-adressen"
  ]
]) {
  expectFailure(
    label,
    () => validateProtectedDeploymentEnvironment(
      label === "Turnstile i produktion" ? "production" : "staging",
      environment
    ),
    expected
  );
}

const source = await readFile("supabase/config.toml", "utf8");
const hostedBuildSource = await readFile("scripts/build-netlify.mjs", "utf8");
const stagingConfig = renderHostedSupabaseConfig(
  source,
  stagingConfiguration
);
const productionConfig = renderHostedSupabaseConfig(
  source,
  productionConfiguration
);

for (const [contents, required] of [
  [stagingConfig, [
    "enable_anonymous_sign_ins = true",
    "[auth.captcha]\nenabled = true\nprovider = \"turnstile\"",
    "[auth.email]\n# Stagingdemot använder bara anonym Auth.\n# E-postprovidern och alla inbjudningsflöden är avstängda.\nenable_signup = false",
    "[auth.email.smtp]\nenabled = false",
    "[functions.invite-member]\nenabled = false",
    "[functions.start-demo]\nenabled = true",
    "[functions.scoutnet-connection]\nenabled = false",
    'TURNSTILE_SECRET_KEY = "env(TURNSTILE_SECRET_KEY)"',
    "# SCOUTNET_SOURCE_REFERENCE_SECRET utelämnas i publik staging.",
    "# SCOUTNET_RECONCILIATION_MODE utelämnas i hostade miljöer."
  ]],
  [productionConfig, [
    "enable_anonymous_sign_ins = false",
    "[auth.email.smtp]\nenabled = true",
    "port = 587",
    "[functions.invite-member]\nenabled = true",
    "[functions.start-demo]\nenabled = false",
    "[functions.scoutnet-connection]\nenabled = true",
    "# TURNSTILE_SECRET_KEY utelämnas avsiktligt i produktion.",
    'SCOUTNET_SOURCE_REFERENCE_SECRET = "env(SCOUTNET_SOURCE_REFERENCE_SECRET)"',
    "# SCOUTNET_RECONCILIATION_MODE utelämnas i hostade miljöer."
  ]]
]) {
  for (const value of required) {
    assert(contents.includes(value), `Genererad konfiguration saknar: ${value}`);
  }
}
assert(
  !productionConfig.includes("\n[auth.captcha]\n"),
  "Produktion fick en aktiv CAPTCHA-konfiguration."
);
assert(
  !stagingConfig.includes('host = "env(SMTP_HOST)"'),
  "Staging blev beroende av SMTP."
);
const requiredEmailTemplateSections = [
  "auth.email.template.invite",
  "auth.email.template.magic_link"
];
const sourceEmailTemplateSections = [
  ...source.matchAll(/^\[(auth\.email\.template\.[^\]]+)\]\s*$/gm)
].map((match) => match[1]);
for (const sectionName of requiredEmailTemplateSections) {
  assert(
    sourceEmailTemplateSections.includes(sectionName),
    `Källkonfigurationen saknar e-postmallen ${sectionName}.`
  );
}
for (const sectionName of sourceEmailTemplateSections) {
  assert(
    !stagingConfig.includes(`[${sectionName}]`),
    `Staging försökte ändra e-postmallen ${sectionName}.`
  );
  assert(
    productionConfig.includes(`[${sectionName}]`),
    `Produktion förlorade e-postmallen ${sectionName}.`
  );
}
assert(
  hostedBuildSource.includes(".tmp/netlify-static-functions")
  && hostedBuildSource.includes("--functions=.tmp/netlify-static-functions")
  && hostedBuildSource.includes("--no-build"),
  "Den statiska Netlify-artefakten saknar ett explicit tomt funktionspaket."
);

console.log(
  "Hostade miljögränser verifierade: staging är demo-only och produktion privat."
);
