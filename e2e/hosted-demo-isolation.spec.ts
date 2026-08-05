import { devices, expect, test, type Page } from "@playwright/test";

const stagingOrigin = "https://lagermat-staging.netlify.app";
const stagingSupabaseOrigin = "https://datiqfdwpalnuttfkthf.supabase.co";
const interactive = process.env.HOSTED_DEMO_INTERACTIVE === "true";
const configuredBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "") ?? "";

interface DemoInstance {
  organizationId: string;
  campId: string;
  expiresAt: string;
  templateVersion: number;
  reused: boolean;
}

interface BrowserCredentials {
  userId: string;
  accessToken: string;
  publishableKey: string;
}

interface DemoStatus {
  state: "active" | "expired" | "missing" | "not_demo";
  expiresAt: string | null;
  organizationId: string | null;
  campId: string | null;
}

function parseDemoInstance(source: unknown): DemoInstance {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("start-demo returned a non-object response");
  }
  const row = source as Record<string, unknown>;
  if (
    typeof row.organizationId !== "string"
    || typeof row.campId !== "string"
    || typeof row.expiresAt !== "string"
    || typeof row.templateVersion !== "number"
    || typeof row.reused !== "boolean"
  ) {
    throw new Error("start-demo returned an incomplete instance");
  }
  return {
    organizationId: row.organizationId,
    campId: row.campId,
    expiresAt: row.expiresAt,
    templateVersion: row.templateVersion,
    reused: row.reused
  };
}

function expectApproximatelyTwentyFourHours(expiresAt: string, observedAt: number) {
  const lifetimeMs = Date.parse(expiresAt) - observedAt;
  expect(lifetimeMs).toBeGreaterThan(23 * 60 * 60 * 1_000 + 55 * 60 * 1_000);
  expect(lifetimeMs).toBeLessThanOrEqual(24 * 60 * 60 * 1_000 + 60 * 1_000);
  return Number((lifetimeMs / (60 * 60 * 1_000)).toFixed(3));
}

function observeSupabaseKey(page: Page) {
  let publishableKey: string | null = null;
  page.on("request", (request) => {
    if (!request.url().startsWith(`${stagingSupabaseOrigin}/rest/v1/`)) return;
    const candidate = request.headers().apikey;
    if (candidate) publishableKey = candidate;
  });
  return () => publishableKey;
}

function countStartDemoRequests(page: Page) {
  let count = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST"
      && request.url() === `${stagingSupabaseOrigin}/functions/v1/start-demo`
    ) {
      count += 1;
    }
  });
  return () => count;
}

async function waitForInteractiveProvisioning(
  page: Page,
  instruction: string
): Promise<{ instance: DemoInstance; observedAt: number }> {
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST"
      && response.url() === `${stagingSupabaseOrigin}/functions/v1/start-demo`,
    { timeout: 10 * 60 * 1_000 }
  );

  console.info(instruction);
  await page.pause();

  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const source: unknown = await response.json();
  const observedAt = Date.now();
  const instance = parseDemoInstance(source);
  await expect(page.getByRole("heading", { name: "Översikt", exact: true })).toBeVisible({
    timeout: 60_000
  });
  return { instance, observedAt };
}

async function readBrowserCredentials(
  page: Page,
  readPublishableKey: () => string | null
): Promise<BrowserCredentials> {
  const session = await page.evaluate(() => {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const value = window.localStorage.getItem(key);
      if (!value) continue;
      try {
        const parsed = JSON.parse(value) as {
          access_token?: unknown;
          user?: { id?: unknown; is_anonymous?: unknown };
        };
        if (
          typeof parsed.access_token === "string"
          && typeof parsed.user?.id === "string"
          && parsed.user.is_anonymous === true
        ) {
          return { userId: parsed.user.id, accessToken: parsed.access_token };
        }
      } catch {
        // Ignore unrelated local state without returning it to the test runner.
      }
    }
    throw new Error("No anonymous Supabase session was found");
  });
  const publishableKey = readPublishableKey();
  if (!publishableKey) throw new Error("No Supabase publishable key was observed");
  return { ...session, publishableKey };
}

async function readDemoStatus(
  page: Page,
  credentials: BrowserCredentials
): Promise<DemoStatus> {
  return page.evaluate(async ({ supabaseOrigin, accessToken, publishableKey }) => {
    const response = await fetch(`${supabaseOrigin}/rest/v1/rpc/get_demo_session_status`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: "{}"
    });
    if (!response.ok) throw new Error(`Status RPC failed with ${response.status}`);
    const source = await response.json() as unknown;
    const row = Array.isArray(source) ? source[0] : source;
    if (!row || typeof row !== "object") throw new Error("Status RPC returned no row");
    const record = row as Record<string, unknown>;
    return {
      state: record.state as DemoStatus["state"],
      expiresAt: typeof record.expires_at === "string" ? record.expires_at : null,
      organizationId: typeof record.organization_id === "string" ? record.organization_id : null,
      campId: typeof record.camp_id === "string" ? record.camp_id : null
    };
  }, {
    supabaseOrigin: stagingSupabaseOrigin,
    accessToken: credentials.accessToken,
    publishableKey: credentials.publishableKey
  });
}

async function countParticipants(
  page: Page,
  credentials: BrowserCredentials,
  organizationId: string,
  campId: string
): Promise<number> {
  return page.evaluate(async ({
    supabaseOrigin,
    accessToken,
    publishableKey,
    targetOrganizationId,
    targetCampId
  }) => {
    const query = new URLSearchParams({
      select: "id",
      organization_id: `eq.${targetOrganizationId}`,
      camp_id: `eq.${targetCampId}`
    });
    const response = await fetch(`${supabaseOrigin}/rest/v1/participants?${query}`, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!response.ok) throw new Error(`Participant read failed with ${response.status}`);
    const rows = await response.json() as unknown;
    if (!Array.isArray(rows)) throw new Error("Participant read returned a non-array response");
    return rows.length;
  }, {
    supabaseOrigin: stagingSupabaseOrigin,
    accessToken: credentials.accessToken,
    publishableKey: credentials.publishableKey,
    targetOrganizationId: organizationId,
    targetCampId: campId
  });
}

test.describe.configure({ mode: "serial" });
test.use({ trace: "off", screenshot: "off", video: "off" });

test("two fresh hosted contexts remain isolated through reuse and reset", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Hosted acceptance uses one desktop browser");
  test.skip(!interactive, "Set HOSTED_DEMO_INTERACTIVE=true for the supervised hosted run");
  test.skip(configuredBaseUrl !== stagingOrigin, "Hosted acceptance is pinned to the fixed staging origin");
  test.setTimeout(30 * 60 * 1_000);

  const contextA = await browser.newContext({
    ...devices["Desktop Chrome"],
    baseURL: stagingOrigin,
    locale: "sv-SE",
    serviceWorkers: "block"
  });
  const contextB = await browser.newContext({
    ...devices["Desktop Chrome"],
    baseURL: stagingOrigin,
    locale: "sv-SE",
    serviceWorkers: "block"
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const readKeyA = observeSupabaseKey(pageA);
    const readKeyB = observeSupabaseKey(pageB);
    const readStartCountA = countStartDemoRequests(pageA);
    const readStartCountB = countStartDemoRequests(pageB);

    await pageA.goto("/");
    await expect(pageA.getByRole("heading", { name: "Prova Lägermat", exact: true })).toBeVisible();
    const startA = await waitForInteractiveProvisioning(
      pageA,
      "Context A: complete both real Turnstile checks, choose Öppna demolägret, wait for Översikt, then resume."
    );
    const credentialsA = await readBrowserCredentials(pageA, readKeyA);
    expect(startA.instance.reused).toBe(false);
    const expiryHoursA = expectApproximatelyTwentyFourHours(
      startA.instance.expiresAt,
      startA.observedAt
    );

    await pageB.goto("/");
    await expect(pageB.getByRole("heading", { name: "Prova Lägermat", exact: true })).toBeVisible();
    const startB = await waitForInteractiveProvisioning(
      pageB,
      "Context B: complete both real Turnstile checks, choose Öppna demolägret, wait for Översikt, then resume."
    );
    const credentialsB = await readBrowserCredentials(pageB, readKeyB);
    expect(startB.instance.reused).toBe(false);
    const expiryHoursB = expectApproximatelyTwentyFourHours(
      startB.instance.expiresAt,
      startB.observedAt
    );

    expect(credentialsA.userId).not.toBe(credentialsB.userId);
    expect(startA.instance.organizationId).not.toBe(startB.instance.organizationId);
    expect(startA.instance.campId).not.toBe(startB.instance.campId);
    expect(readStartCountA()).toBe(1);
    expect(readStartCountB()).toBe(1);

    const statusABeforeReload = await readDemoStatus(pageA, credentialsA);
    expect(statusABeforeReload).toMatchObject({
      state: "active",
      organizationId: startA.instance.organizationId,
      campId: startA.instance.campId
    });
    await pageA.reload();
    await expect(pageA.getByRole("heading", { name: "Översikt", exact: true })).toBeVisible({
      timeout: 60_000
    });
    const statusAAfterReload = await readDemoStatus(pageA, credentialsA);
    expect(statusAAfterReload).toEqual(statusABeforeReload);
    expect(readStartCountA()).toBe(1);

    const ownBeforeReset = await countParticipants(
      pageA,
      credentialsA,
      startA.instance.organizationId,
      startA.instance.campId
    );
    const crossABeforeReset = await countParticipants(
      pageA,
      credentialsA,
      startB.instance.organizationId,
      startB.instance.campId
    );
    const crossBBeforeReset = await countParticipants(
      pageB,
      credentialsB,
      startA.instance.organizationId,
      startA.instance.campId
    );
    expect(ownBeforeReset).toBe(55);
    expect(crossABeforeReset).toBe(0);
    expect(crossBBeforeReset).toBe(0);

    pageA.once("dialog", (dialog) => void dialog.accept());
    const resetA = await waitForInteractiveProvisioning(
      pageA,
      "Context A reset: complete the real reset Turnstile, choose Återställ demolägret, wait for Översikt, then resume."
    );
    const resetExpiryHours = expectApproximatelyTwentyFourHours(
      resetA.instance.expiresAt,
      resetA.observedAt
    );
    expect(resetA.instance.reused).toBe(false);
    expect(resetA.instance.organizationId).not.toBe(startA.instance.organizationId);
    expect(resetA.instance.campId).not.toBe(startA.instance.campId);
    expect(readStartCountA()).toBe(2);

    await pageB.reload();
    await expect(pageB.getByRole("heading", { name: "Översikt", exact: true })).toBeVisible({
      timeout: 60_000
    });
    const statusBAfterReset = await readDemoStatus(pageB, credentialsB);
    expect(statusBAfterReset).toMatchObject({
      state: "active",
      organizationId: startB.instance.organizationId,
      campId: startB.instance.campId
    });
    expect(readStartCountB()).toBe(1);

    const ownAAfterReset = await countParticipants(
      pageA,
      credentialsA,
      resetA.instance.organizationId,
      resetA.instance.campId
    );
    const oldAAfterReset = await countParticipants(
      pageA,
      credentialsA,
      startA.instance.organizationId,
      startA.instance.campId
    );
    const ownBAfterReset = await countParticipants(
      pageB,
      credentialsB,
      startB.instance.organizationId,
      startB.instance.campId
    );
    const crossAAfterReset = await countParticipants(
      pageA,
      credentialsA,
      startB.instance.organizationId,
      startB.instance.campId
    );
    const crossBAfterReset = await countParticipants(
      pageB,
      credentialsB,
      resetA.instance.organizationId,
      resetA.instance.campId
    );
    expect(ownAAfterReset).toBe(55);
    expect(oldAAfterReset).toBe(0);
    expect(ownBAfterReset).toBe(55);
    expect(crossAAfterReset).toBe(0);
    expect(crossBAfterReset).toBe(0);

    console.info(JSON.stringify({
      contexts: 2,
      distinctAnonymousUsers: true,
      distinctInitialTenants: true,
      sameContextReusedWithoutProvisioning: true,
      resetReplacedOnlyContextA: true,
      contextBUnchanged: true,
      ownParticipantCounts: [ownAAfterReset, ownBAfterReset],
      crossTenantParticipantCounts: [crossAAfterReset, crossBAfterReset],
      oldResetTenantParticipantCount: oldAAfterReset,
      expiryHours: [expiryHoursA, expiryHoursB, resetExpiryHours]
    }));
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close()]);
  }
});
