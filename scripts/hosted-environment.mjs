const HOSTED_ENVIRONMENTS = new Set(["staging", "production"]);

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Miljökonfiguration saknas: ${name}`);
  return value;
}

function exactBoolean(environment, name) {
  const value = required(environment, name);
  if (value !== "true" && value !== "false") {
    throw new Error(`${name} måste vara true eller false.`);
  }
  return value === "true";
}

function validTurnstileValue(value, maximumLength) {
  return value.length >= 10
    && value.length <= maximumLength
    && value.trim() === value
    && !/\s/.test(value);
}

function validServerSecret(value) {
  return value.length >= 32
    && value.length <= 4_096
    && value.trim() === value
    && !/\s/.test(value);
}

export function readHostedDemoMode(
  deploymentEnvironment,
  environment = process.env
) {
  if (!HOSTED_ENVIRONMENTS.has(deploymentEnvironment)) {
    throw new Error("Miljön måste vara staging eller production.");
  }

  const demoMode = exactBoolean(environment, "DEMO_MODE");
  const clientDemoMode = exactBoolean(environment, "VITE_DEMO_MODE");
  if (demoMode !== clientDemoMode) {
    throw new Error("DEMO_MODE och VITE_DEMO_MODE måste vara identiska.");
  }

  const siteKey = environment.VITE_TURNSTILE_SITE_KEY?.trim() ?? "";
  if (deploymentEnvironment === "staging") {
    if (!demoMode) {
      throw new Error("Staging måste ha DEMO_MODE=true.");
    }
    if (!validTurnstileValue(siteKey, 256)) {
      throw new Error(
        "Staging kräver en giltig publik VITE_TURNSTILE_SITE_KEY."
      );
    }
  } else {
    if (demoMode) {
      throw new Error("Produktion måste ha DEMO_MODE=false.");
    }
    if (siteKey) {
      throw new Error(
        "Produktion får inte innehålla VITE_TURNSTILE_SITE_KEY."
      );
    }
  }

  return {
    deploymentEnvironment,
    demoEnabled: demoMode,
    turnstileSiteKey: siteKey || null
  };
}

function exactHttpsOrigin(environment, name) {
  const value = required(environment, name);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} är inte en giltig URL.`);
  }
  if (
    url.protocol !== "https:"
    || url.origin !== value
    || url.username
    || url.password
  ) {
    throw new Error(
      `${name} måste vara en exakt HTTPS-origin utan avslutande snedstreck.`
    );
  }
  return url;
}

export function validateProtectedDeploymentEnvironment(
  deploymentEnvironment,
  environment = process.env
) {
  const demo = readHostedDemoMode(deploymentEnvironment, environment);
  for (const name of [
    "APP_ORIGIN",
    "AUTH_CALLBACK_URL",
    "AUTH_EMAIL_MAX_FREQUENCY",
    "NETLIFY_AUTH_TOKEN",
    "NETLIFY_SITE_ID",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_PROJECT_REF",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_URL"
  ]) {
    required(environment, name);
  }

  const appUrl = exactHttpsOrigin(environment, "APP_ORIGIN");
  const callbackUrl = new URL(required(environment, "AUTH_CALLBACK_URL"));
  if (
    callbackUrl.origin !== appUrl.origin
    || callbackUrl.pathname !== "/auth/callback"
    || callbackUrl.search
    || callbackUrl.hash
  ) {
    throw new Error(
      "AUTH_CALLBACK_URL måste vara APP_ORIGIN följt av /auth/callback."
    );
  }

  const supabaseUrl = exactHttpsOrigin(environment, "VITE_SUPABASE_URL");
  const projectReference = required(environment, "SUPABASE_PROJECT_REF");
  if (!/^[a-z0-9]{20}$/.test(projectReference)) {
    throw new Error("SUPABASE_PROJECT_REF har inte Supabases förväntade format.");
  }
  if (supabaseUrl.hostname !== `${projectReference}.supabase.co`) {
    throw new Error("VITE_SUPABASE_URL matchar inte SUPABASE_PROJECT_REF.");
  }
  if (
    deploymentEnvironment === "production"
    && appUrl.hostname.endsWith(".netlify.app")
  ) {
    throw new Error(
      "Produktion måste använda den godkända egna domänen, inte netlify.app."
    );
  }
  if (
    deploymentEnvironment === "staging"
    && !appUrl.hostname.endsWith(".netlify.app")
  ) {
    throw new Error(
      "Stagingdemot ska använda den fasta netlify.app-adressen utan egen domän."
    );
  }
  if (environment.AUTH_EMAIL_MAX_FREQUENCY !== "1m") {
    throw new Error(
      "AUTH_EMAIL_MAX_FREQUENCY måste vara 1m i en hostad miljö."
    );
  }
  if (
    /^(?:sb_secret_|supabase_secret_)/.test(
      required(environment, "VITE_SUPABASE_PUBLISHABLE_KEY")
    )
  ) {
    throw new Error(
      "VITE_SUPABASE_PUBLISHABLE_KEY får inte vara en hemlig Supabase-nyckel."
    );
  }

  const smtpNames = [
    "SMTP_FROM_ADDRESS",
    "SMTP_FROM_NAME",
    "SMTP_HOST",
    "SMTP_PASS",
    "SMTP_PORT",
    "SMTP_USER"
  ];
  const turnstileSecret = environment.TURNSTILE_SECRET_KEY?.trim() ?? "";
  const scoutnetSourceReferenceSecret =
    environment.SCOUTNET_SOURCE_REFERENCE_SECRET?.trim() ?? "";
  const scoutnetReconciliationMode =
    environment.SCOUTNET_RECONCILIATION_MODE?.trim() ?? "";
  if (scoutnetReconciliationMode) {
    throw new Error(
      "Hostade miljöer får inte få SCOUTNET_RECONCILIATION_MODE."
    );
  }
  if (demo.demoEnabled) {
    const configuredSmtp = smtpNames.filter((name) =>
      environment[name]?.trim()
    );
    if (configuredSmtp.length > 0) {
      throw new Error(
        `Stagingdemot får inte få SMTP-konfiguration: ${configuredSmtp.join(", ")}`
      );
    }
    if (!validTurnstileValue(turnstileSecret, 4_096)) {
      throw new Error("Staging kräver TURNSTILE_SECRET_KEY som serverhemlighet.");
    }
    if (turnstileSecret === demo.turnstileSiteKey) {
      throw new Error("Turnstiles sitekey och secret får inte vara samma värde.");
    }
    if (scoutnetSourceReferenceSecret) {
      throw new Error(
        "Stagingdemot får inte få SCOUTNET_SOURCE_REFERENCE_SECRET."
      );
    }
  } else {
    if (turnstileSecret) {
      throw new Error("Produktion får inte få TURNSTILE_SECRET_KEY.");
    }
    for (const name of smtpNames) required(environment, name);
    if (
      environment.SMTP_HOST !== "smtp.resend.com"
      || environment.SMTP_PORT !== "587"
      || environment.SMTP_USER !== "resend"
    ) {
      throw new Error(
        "SMTP måste använda den godkända Resend-konfigurationen "
        + "smtp.resend.com:587 med användaren resend."
      );
    }
    if (!required(environment, "SMTP_FROM_ADDRESS").includes("@")) {
      throw new Error("SMTP_FROM_ADDRESS är ogiltig.");
    }
    if (!validServerSecret(scoutnetSourceReferenceSecret)) {
      throw new Error(
        "Privat produktion kräver SCOUTNET_SOURCE_REFERENCE_SECRET "
        + "som en stabil serverhemlighet."
      );
    }
  }

  return {
    ...demo,
    appOrigin: appUrl.origin,
    smtpPort: demo.demoEnabled ? null : Number(environment.SMTP_PORT),
    scoutnetSourceReferenceSecret:
      scoutnetSourceReferenceSecret || null
  };
}

function sectionBounds(source, sectionName) {
  const heading = `[${sectionName}]`;
  const start = source.indexOf(`${heading}\n`);
  if (start < 0) throw new Error(`Supabase-konfigurationen saknar ${heading}.`);
  const next = source.indexOf("\n[", start + heading.length);
  return { start, end: next < 0 ? source.length : next + 1 };
}

function replaceSectionSetting(source, sectionName, key, nextValue) {
  const { start, end } = sectionBounds(source, sectionName);
  const section = source.slice(start, end);
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*=.*$`, "m");
  const matches = section.match(new RegExp(pattern.source, "gm")) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `${sectionName}.${key} måste förekomma exakt en gång i källkonfigurationen.`
    );
  }
  return source.slice(0, start)
    + section.replace(pattern, `${key} = ${nextValue}`)
    + source.slice(end);
}

function replaceWholeSection(source, sectionName, replacement) {
  const { start, end } = sectionBounds(source, sectionName);
  return source.slice(0, start)
    + replacement.trimEnd()
    + "\n\n"
    + source.slice(end).replace(/^\n+/, "");
}

function removeWholeSection(source, sectionName) {
  const { start, end } = sectionBounds(source, sectionName);
  return source.slice(0, start)
    + source.slice(end).replace(/^\n+/, "");
}

function sectionNamesWithPrefix(source, prefix) {
  return [...source.matchAll(/^\[([^\]]+)\]\s*$/gm)]
    .map((match) => match[1])
    .filter((sectionName) => sectionName.startsWith(prefix));
}

export function renderHostedSupabaseConfig(source, configuration) {
  const { demoEnabled, smtpPort } = configuration;
  let rendered = source;
  rendered = replaceSectionSetting(
    rendered,
    "auth",
    "enable_anonymous_sign_ins",
    demoEnabled ? "true" : "false"
  );
  rendered = replaceSectionSetting(
    rendered,
    "auth.email",
    "enable_signup",
    demoEnabled ? "false" : "true"
  );
  if (demoEnabled) {
    const productionEmailComment = [
      "# Keep the email provider available for invitations and passwordless sign-in.",
      "# Public account creation remains disabled by auth.enable_signup above."
    ].join("\n");
    if (!rendered.includes(productionEmailComment)) {
      throw new Error("Den kanoniska e-postkommentaren saknas.");
    }
    rendered = rendered.replace(
      productionEmailComment,
      [
        "# Stagingdemot använder bara anonym Auth.",
        "# E-postprovidern och alla inbjudningsflöden är avstängda."
      ].join("\n")
    );

    // New Supabase Free projects using the default email provider reject all
    // template fields, even when email signup and SMTP are disabled.
    for (const sectionName of sectionNamesWithPrefix(
      rendered,
      "auth.email.template."
    )) {
      rendered = removeWholeSection(rendered, sectionName);
    }
  }
  rendered = replaceSectionSetting(
    rendered,
    "functions.invite-member",
    "enabled",
    demoEnabled ? "false" : "true"
  );
  rendered = replaceSectionSetting(
    rendered,
    "functions.start-demo",
    "enabled",
    demoEnabled ? "true" : "false"
  );
  rendered = replaceSectionSetting(
    rendered,
    "functions.scoutnet-connection",
    "enabled",
    demoEnabled ? "false" : "true"
  );

  const captchaTemplate = [
    "# Configure one of the supported captcha providers: `hcaptcha`, `turnstile`.",
    "# [auth.captcha]",
    "# enabled = true",
    "# provider = \"hcaptcha\"",
    "# secret = \"\""
  ].join("\n");
  if (!rendered.includes(captchaTemplate)) {
    throw new Error("Den kanoniska kommenterade CAPTCHA-konfigurationen saknas.");
  }
  if (demoEnabled) {
    rendered = rendered.replace(captchaTemplate, [
      "# Staging-only CAPTCHA for anonymous demo authentication.",
      "[auth.captcha]",
      "enabled = true",
      "provider = \"turnstile\"",
      "secret = \"env(TURNSTILE_SECRET_KEY)\""
    ].join("\n"));
  }

  if (demoEnabled) {
    rendered = replaceWholeSection(rendered, "auth.email.smtp", [
      "[auth.email.smtp]",
      "enabled = false",
      "host = \"disabled.invalid\"",
      "port = 1025",
      "user = \"disabled\"",
      "pass = \"disabled\"",
      "admin_email = \"disabled@example.invalid\"",
      "sender_name = \"Lägermat stagingdemo – e-post avstängd\""
    ].join("\n"));
  } else {
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65_535) {
      throw new Error("Produktionskonfigurationen kräver en giltig SMTP-port.");
    }
    rendered = replaceSectionSetting(
      rendered,
      "auth.email.smtp",
      "port",
      String(smtpPort)
    );
  }

  if (!demoEnabled) {
    const turnstileSecretSetting =
      'TURNSTILE_SECRET_KEY = "env(TURNSTILE_SECRET_KEY)"';
    if (!rendered.includes(turnstileSecretSetting)) {
      throw new Error("Turnstiles serverhemlighet saknas i källkonfigurationen.");
    }
    rendered = rendered.replace(
      turnstileSecretSetting,
      "# TURNSTILE_SECRET_KEY utelämnas avsiktligt i produktion."
    );
  }

  if (demoEnabled) {
    const scoutnetSecretSetting =
      'SCOUTNET_SOURCE_REFERENCE_SECRET = "env(SCOUTNET_SOURCE_REFERENCE_SECRET)"';
    if (!rendered.includes(scoutnetSecretSetting)) {
      throw new Error("Scoutnets HMAC-serverhemlighet saknas i källkonfigurationen.");
    }
    rendered = rendered.replace(
      scoutnetSecretSetting,
      "# SCOUTNET_SOURCE_REFERENCE_SECRET utelämnas i publik staging."
    );
  }

  const scoutnetFixtureModeSetting =
    'SCOUTNET_RECONCILIATION_MODE = "env(SCOUTNET_RECONCILIATION_MODE)"';
  if (!rendered.includes(scoutnetFixtureModeSetting)) {
    throw new Error("Scoutnets lokala fixture-gate saknas i källkonfigurationen.");
  }
  rendered = rendered.replace(
    scoutnetFixtureModeSetting,
    "# SCOUTNET_RECONCILIATION_MODE utelämnas i hostade miljöer."
  );

  return rendered;
}
