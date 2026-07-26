import { expect, test } from "@playwright/test";
import { loginWithLocalMagicLink } from "./localAuth";

test("a planner adds one dataminimised participant without an import file", async ({
  page,
  request
}, testInfo) => {
  const viewportLabel = testInfo.project.name.includes("mobile") ? "Mobil" : "Desktop";
  const displayName = `Manuell ${viewportLabel} ${Date.now()}`;

  await loginWithLocalMagicLink(page, request, "mobil@bjorkstad.test");
  await page.goto("/deltagare");
  await page.getByRole("button", { name: "Lägg till deltagare" }).click();

  const dialog = page.getByRole("dialog", { name: "Lägg till deltagare" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Personnummer, kontaktuppgifter och generell hälsodeklaration/)).toBeVisible();
  await expect(dialog.locator('input[type="email"], input[type="tel"], input[name*="personnummer"]')).toHaveCount(0);

  await dialog.getByRole("textbox", { name: "Namn" }).fill(displayName);
  await dialog.getByRole("textbox", { name: "Avdelning" }).fill("Ledare");
  await dialog.getByRole("textbox", { name: "Patrull" }).fill("Korpen");
  await dialog.getByRole("textbox", { name: "Matlag" }).fill("Matlag Granen");
  await dialog.getByRole("textbox", { name: "Portionsstorlek" }).fill("1,1");
  await dialog.getByRole("textbox", { name: /Specialkost/ }).fill("Nötallergi");
  await dialog.getByRole("button", { name: "Lägg till deltagare" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(`${displayName} lades till i lägret.`)).toBeVisible();
  const participantRecord = page.locator(".participant-record").filter({ hasText: displayName });
  await expect(participantRecord.getByText(displayName, { exact: true })).toBeVisible();
  await expect(participantRecord.getByText("Ledare · Korpen", { exact: true })).toBeVisible();

  await page.goto("/specialkost");
  const dietaryCard = page.locator("article").filter({ hasText: displayName });
  await expect(dietaryCard.getByText("Nötallergi", { exact: true })).toBeVisible();
  await expect(dietaryCard.getByText("Behöver granskas", { exact: true })).toBeVisible();
});
