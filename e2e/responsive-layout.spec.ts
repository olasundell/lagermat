import { expect, test } from "@playwright/test";
import { loginWithLocalMagicLink } from "./localAuth";

test("recipe and schedule pages do not create desktop page overflow", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only responsive assertion");
  await page.setViewportSize({ width: 1200, height: 897 });
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");

  for (const route of ["/recept", "/matsedel"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    const widths = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth
    }));
    expect(widths.page, `${route} ska inte skapa horisontell sidskroll`).toBeLessThanOrEqual(widths.viewport);
  }
});

test("recipe summary and details fit their own columns", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only responsive assertion");
  await page.setViewportSize({ width: 1200, height: 897 });
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  await page.goto("/recept");

  for (const selector of [".recipe-summary", ".recipe-detail"]) {
    const widths = await page.locator(selector).evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth
    }));
    expect(widths.scroll, `${selector} ska inte kapa sitt innehåll`).toBeLessThanOrEqual(widths.client);
  }
});

test("recipe search no-match state remains a useful detail panel", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only responsive assertion");
  await page.setViewportSize({ width: 1200, height: 897 });
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  await page.goto("/recept");
  await page.getByRole("textbox", { name: "Sök recept" }).fill("zzzz");

  const emptyDetail = page.locator(".recipe-detail__empty");
  await expect(emptyDetail).toBeVisible();
  await expect(emptyDetail).toContainText("Ändra sökningen för att visa ett recept.");
  await expect(emptyDetail).toHaveCSS("text-align", "center");
  expect((await emptyDetail.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(180);
});
