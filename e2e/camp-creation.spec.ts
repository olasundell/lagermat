import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { enrolLocalAdminMfa, loginWithLocalMagicLink } from "./localAuth";

test("an AAL2 administrator creates a camp and completes a participant privacy request", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only mutation");
  await loginWithLocalMagicLink(page, request, "sara@sjovik.test");
  await enrolLocalAdminMfa(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Skapa läger" }).click();
  const dialog = page.getByRole("dialog", { name: "Skapa nytt läger" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Lägernamn").fill("Vinterläger E2E");
  await dialog.getByLabel("Startdatum").fill("2025-01-03");
  await dialog.getByLabel("Slutdatum").fill("2025-01-05");
  await expect(dialog.getByLabel("Tidszon")).toHaveValue("Europe/Stockholm");
  await dialog.getByRole("button", { name: "Skapa läger" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Vinterläger E2E" })).toBeVisible();
  await expect(page.getByText("Sjövik scoutkår · 3–5 januari · 0 deltagare")).toBeVisible();
  await expect(page.getByRole("button", { name: "Vinterläger E2E Läger" })).toBeVisible();

  await page.goto("/deltagare");
  await page.getByRole("button", { name: "Lägg till deltagare" }).click();
  const participantDialog = page.getByRole("dialog", { name: "Lägg till deltagare" });
  await participantDialog.getByRole("textbox", { name: "Namn" }).fill("Integritet E2E");
  await participantDialog.getByRole("textbox", { name: /Specialkost/ }).fill("Glutenfri E2E-kost");
  await participantDialog.getByRole("button", { name: "Lägg till deltagare" }).click();
  await expect(page.getByText("Integritet E2E", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Integritetsärende för Integritet E2E" }).click();
  const privacyDialog = page.getByRole("dialog", { name: "Integritetsärende för Integritet E2E" });
  await expect(privacyDialog).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    privacyDialog.getByRole("button", { name: "Exportera personuppgifter" }).click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^lagermat-personuppgifter-[0-9a-f-]+\.json$/);
  const exportPath = await download.path();
  expect(exportPath).toBeTruthy();
  const exported = JSON.parse(await readFile(exportPath!, "utf8")) as {
    participant?: { display_name?: string };
    dietary_needs?: Array<{ raw_food_note?: string }>;
  };
  expect(exported.participant?.display_name).toBe("Integritet E2E");
  expect(exported.dietary_needs?.[0]?.raw_food_note).toBe("Glutenfri E2E-kost");
  await expect(privacyDialog.getByText("Personuppgifterna exporterades som JSON.")).toBeVisible();

  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("Radera Integritet E2E");
    await confirmation.accept();
  });
  await privacyDialog.getByRole("button", { name: "Radera deltagaren" }).click();
  await expect(privacyDialog).toBeHidden();
  await expect(page.locator(".participant-record").filter({ hasText: "Integritet E2E" })).toHaveCount(0);
  await expect(page.getByText("Integritet E2E och personens lägeruppgifter raderades.")).toBeVisible();
});

test("a planner cannot see the camp creation action", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only authorization check");
  await loginWithLocalMagicLink(page, request, "mobil@bjorkstad.test");

  await expect(page.getByRole("heading", { name: "Sommarläger 2026" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skapa läger" })).toHaveCount(0);
});
