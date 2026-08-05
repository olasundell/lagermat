import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

const supabaseUrl = process.env.PLAYWRIGHT_SUPABASE_URL
  ?? "http://127.0.0.1:54321";
const mailpitUrl = process.env.PLAYWRIGHT_MAILPIT_URL
  ?? "http://127.0.0.1:54324";

interface MailpitList {
  messages: Array<{
    ID: string;
    To: Array<{ Address: string }>;
  }>;
}

interface MailpitMessage {
  Text: string;
}

function decodeBase32(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const character of secret.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
      value &= (1 << bits) - 1;
    }
  }

  return Buffer.from(bytes);
}

function currentTotp(secret: string): string {
  const counter = BigInt(Math.floor(Date.now() / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

export async function localMessageIds(request: APIRequestContext): Promise<Set<string>> {
  const response = await request.get(`${mailpitUrl}/api/v1/messages`);
  expect(response.ok()).toBe(true);
  const inbox = await response.json() as MailpitList;
  return new Set(inbox.messages.map((message) => message.ID));
}

export async function waitForLocalAuthLink(
  request: APIRequestContext,
  email: string,
  previousIds: ReadonlySet<string>,
): Promise<string> {
  let messageId = "";
  await expect.poll(async () => {
    const response = await request.get(`${mailpitUrl}/api/v1/messages`);
    if (!response.ok()) return false;
    const inbox = await response.json() as MailpitList;
    const message = inbox.messages.find((candidate) =>
      !previousIds.has(candidate.ID)
      && candidate.To.some((recipient) => recipient.Address === email)
    );
    messageId = message?.ID ?? "";
    return Boolean(messageId);
  }).toBe(true);

  const messageResponse = await request.get(`${mailpitUrl}/api/v1/message/${messageId}`);
  expect(messageResponse.ok()).toBe(true);
  const message = await messageResponse.json() as MailpitMessage;
  const link = [...message.Text.matchAll(/\(\s*(https?:\/\/[^\s)]+)\s*\)/g)]
    .map((match) => match[1])
    .find((candidate) =>
      candidate.startsWith(`${supabaseUrl}/auth/v1/verify?`)
    );
  expect(link, "Mailpit message should contain a local auth link").toBeTruthy();
  return link!;
}

export async function loginWithLocalMagicLink(
  page: Page,
  request: APIRequestContext,
  email: string
): Promise<void> {
  const previousIds = await localMessageIds(request);

  await page.goto("/");
  await page.getByRole("textbox", { name: "E-postadress" }).fill(email);
  const requestButton = page.getByRole("button", { name: "Skicka inloggningslänk" });
  const sentStatus = page.getByText("Inloggningslänken är skickad");
  await requestButton.click();
  const firstAttempt = await Promise.race([
    sentStatus.waitFor({ state: "visible", timeout: 2_000 }).then(() => "sent" as const),
    page.getByRole("alert").waitFor({ state: "visible", timeout: 2_000 }).then(() => "error" as const)
  ]);
  if (firstAttempt === "error") {
    const errorText = await page.getByRole("alert").textContent();
    expect(errorText).toMatch(/For security purposes, you can only request this after \d+ seconds?\./);
    const remainingSeconds = Number(errorText?.match(/after (\d+) seconds?/)?.[1] ?? "0");
    await page.waitForTimeout((remainingSeconds + 1) * 1_000);
    await requestButton.click();
  }
  await expect(sentStatus).toBeVisible();

  await page.goto(await waitForLocalAuthLink(request, email, previousIds));
  await expect(page.getByRole("link", { name: "Gå till översikten" })).toBeVisible();
}

export async function enrolLocalAdminMfa(page: Page): Promise<void> {
  await page.goto("/team");
  await expect(page.getByRole("heading", { name: "Tvåstegsverifiering krävs" })).toBeVisible();
  await page.getByRole("button", { name: "Konfigurera autentiseringsapp" }).click();

  const secret = (await page.locator(".mfa-enrollment code").textContent())?.trim();
  expect(secret, "TOTP enrollment should expose a local test secret").toBeTruthy();

  const millisecondsIntoWindow = Date.now() % 30_000;
  if (millisecondsIntoWindow > 27_000) {
    await page.waitForTimeout(30_200 - millisecondsIntoWindow);
  }

  await page.getByLabel("Sexsiffrig kod").fill(currentTotp(secret!));
  await page.getByRole("button", { name: "Verifiera och fortsätt" }).click();
  await expect(page.getByRole("heading", { name: "Användare och behörigheter" })).toBeVisible();
}
