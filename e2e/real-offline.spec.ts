import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { loginWithLocalMagicLink } from "./localAuth";

const appUrl = "http://127.0.0.1:4173";
const apiUrl = "http://127.0.0.1:54321";
const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const organizationId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const campId = "caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";

interface SupplyItem {
  id: string;
  item_name: string;
  row_version: number;
  ordered_amount: number | null;
  ordered_unit: string | null;
  package_note: string | null;
  comment: string | null;
  completed: boolean;
}

interface MutationReceipt {
  client_mutation_id: string;
  base_version: number;
  base_values: Record<string, unknown>;
  changes: Record<string, unknown>;
  result: { server_version: number };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForServer(expectedRunning: boolean): Promise<void> {
  await expect.poll(async () => {
    try {
      const response = await fetch(appUrl, { signal: AbortSignal.timeout(500) });
      return response.ok;
    } catch {
      return false;
    }
  }, { timeout: 15_000 }).toBe(expectedRunning);
}

async function startPreview(): Promise<ChildProcess> {
  const child = spawn(
    "./node_modules/.bin/vite",
    ["preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
    { cwd: process.cwd(), env: process.env, stdio: "ignore" },
  );
  await waitForServer(true);
  expect(child.exitCode, "Previewservern ska fortsätta köra").toBeNull();
  return child;
}

async function stopPreview(child: ChildProcess): Promise<void> {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(5_000)]);
  }
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
  await waitForServer(false);
}

async function accessToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    for (const value of Object.values(localStorage)) {
      try {
        const parsed = JSON.parse(value) as { access_token?: unknown };
        if (typeof parsed.access_token === "string") return parsed.access_token;
      } catch {
        // Other local state is intentionally ignored.
      }
    }
    throw new Error("Den lokala Auth-sessionen saknar access token");
  });
}

function headers(token: string): Record<string, string> {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function deliveryItems(request: APIRequestContext, token: string): Promise<SupplyItem[]> {
  const query = new URLSearchParams({
    select: "id,item_name,row_version,ordered_amount,ordered_unit,package_note,comment,completed,supply_lists!inner(kind,source_present)",
    organization_id: `eq.${organizationId}`,
    camp_id: `eq.${campId}`,
    "supply_lists.kind": "eq.delivery",
    "supply_lists.source_present": "eq.true",
    order: "item_name.asc",
  });
  const response = await request.get(`${apiUrl}/rest/v1/supply_list_items?${query}`, { headers: headers(token) });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<SupplyItem[]>;
}

async function applyMutation(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await request.post(`${apiUrl}/rest/v1/rpc/apply_supply_item_mutation`, {
    headers: headers(token),
    data: body,
  });
  if (!response.ok()) {
    throw new Error(`Den lokala mutationsfunktionen svarade ${response.status()}: ${await response.text()}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

async function receiptFor(
  request: APIRequestContext,
  token: string,
  itemId: string,
): Promise<MutationReceipt> {
  const query = new URLSearchParams({
    select: "client_mutation_id,base_version,base_values,changes,result",
    item_id: `eq.${itemId}`,
    order: "created_at.desc",
    limit: "1",
  });
  const response = await request.get(`${apiUrl}/rest/v1/supply_item_mutations?${query}`, { headers: headers(token) });
  expect(response.ok()).toBe(true);
  const receipts = await response.json() as MutationReceipt[];
  expect(receipts).toHaveLength(1);
  return receipts[0]!;
}

test.describe.configure({ mode: "serial" });

let preview: ChildProcess | null = null;

test.beforeAll(async () => {
  preview = await startPreview();
});

test.afterAll(async () => {
  if (preview) await stopPreview(preview);
  preview = null;
});

test("a physically stopped app server preserves cache, queue, replay safety and overlap conflicts", async ({ page, request }, testInfo) => {
  const runMarker = `${testInfo.project.name}-${Date.now()}`;
  const localConflictComment = `Lokal konfliktändring ${runMarker}`;
  const serverConflictComment = `Serverns konfliktändring ${runMarker}`;
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  const signedInStorage = await page.evaluate(() => Object.entries(localStorage));
  await page.goto(appUrl);
  await page.evaluate((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value);
  }, signedInStorage);
  await page.reload();
  await page.goto(`${appUrl}/leveranser`);
  await expect(page.getByRole("heading", { name: /^Leverans 1/ })).toBeVisible();

  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload();
  await expect(page.getByRole("heading", { name: /^Leverans 1/ })).toBeVisible();

  const token = await accessToken(page);
  const initialItems = await deliveryItems(request, token);
  expect(initialItems.length).toBeGreaterThanOrEqual(1);
  const syncItem = initialItems[0]!;
  const conflictItem = initialItems[1] ?? syncItem;
  await expect(page.getByRole("checkbox", { name: new RegExp(syncItem.item_name) })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: new RegExp(conflictItem.item_name) })).toBeVisible();

  await stopPreview(preview!);
  preview = null;
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: /^Leverans 1/ })).toBeVisible();
  await expect(page.getByText("Offline – visar senast sparade uppgifter", { exact: true })).toBeVisible();

  const syncCheckbox = page.getByRole("checkbox", { name: new RegExp(syncItem.item_name) });
  const initialChecked = await syncCheckbox.isChecked();
  await syncCheckbox.press("Space");
  await expect(syncCheckbox).toBeChecked({ checked: !initialChecked });
  await expect(page.getByText(/1 ändring väntar/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Markera leverans klar/ })).toBeDisabled();

  preview = await startPreview();
  await page.context().setOffline(false);
  await expect(page.getByText(/ändring(?:ar)? väntar/)).toBeHidden();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: new RegExp(syncItem.item_name) })).toBeChecked({ checked: !initialChecked });

  const receipt = await receiptFor(request, token, syncItem.id);
  const replay = await applyMutation(request, token, {
    p_organization_id: organizationId,
    p_camp_id: campId,
    p_item_id: syncItem.id,
    p_client_mutation_id: receipt.client_mutation_id,
    p_base_version: receipt.base_version,
    p_base_values: receipt.base_values,
    p_changes: receipt.changes,
  });
  expect(replay.replayed).toBe(true);
  expect(replay.server_version).toBe(receipt.result.server_version);

  const latestConflictItem = (await deliveryItems(request, token)).find((item) => item.id === conflictItem.id)!;
  await stopPreview(preview!);
  preview = null;
  await page.context().setOffline(true);
  await page.reload();
  const conflictRow = page.locator(".delivery-item").filter({ hasText: conflictItem.item_name });
  await conflictRow.getByRole("button", { name: `Visa detaljer för ${conflictItem.item_name}` }).click();
  await conflictRow.getByRole("textbox", { name: "Kommentar" }).fill(localConflictComment);
  await conflictRow.getByRole("button", { name: "Spara beställning" }).click();
  await expect(page.getByText(/1 ändring väntar/)).toBeVisible();

  const serverMutationId = crypto.randomUUID();
  const serverMutationBody = {
    p_organization_id: organizationId,
    p_camp_id: campId,
    p_item_id: latestConflictItem.id,
    p_client_mutation_id: serverMutationId,
    p_base_version: latestConflictItem.row_version,
    p_base_values: {
      ordered_amount: latestConflictItem.ordered_amount,
      ordered_unit: latestConflictItem.ordered_unit,
      package_note: latestConflictItem.package_note,
      comment: latestConflictItem.comment,
      completed: latestConflictItem.completed,
    },
    p_changes: { comment: serverConflictComment },
  };
  const serverApplied = await applyMutation(request, token, serverMutationBody);
  expect(serverApplied.status).toBe("applied");
  expect(serverApplied.replayed).toBe(false);

  preview = await startPreview();
  await page.context().setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine), { timeout: 15_000 }).toBe(true);
  await expect(page.getByText(`Två versioner av ${conflictItem.item_name}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/uppgifter ändrades både här och i den senast sparade versionen: kommentar/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Markera leverans klar/ })).toBeDisabled();

  await page.getByRole("button", { name: "Behåll senast sparade" }).click();
  await expect(page.getByText(`Två versioner av ${conflictItem.item_name}`)).toBeHidden();
  await page.reload();
  const refreshedRow = page.locator(".delivery-item").filter({ hasText: conflictItem.item_name });
  await refreshedRow.getByRole("button", { name: `Visa detaljer för ${conflictItem.item_name}` }).click();
  await expect(refreshedRow.getByRole("textbox", { name: "Kommentar" })).toHaveValue(serverConflictComment);

  const serverReplay = await applyMutation(request, token, serverMutationBody);
  expect(serverReplay.replayed).toBe(true);
  expect(serverReplay.server_version).toBe(serverApplied.server_version);
});
