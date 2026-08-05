import { expect, test, type Page, type Request } from "@playwright/test";
import { TUTORIAL_PROGRESS_KEY } from "../src/features/tutorial/tutorialProgress";

test.describe.configure({ mode: "serial" });
test.skip(
  process.env.PLAYWRIGHT_DEMO_MODE !== "true",
  "Körs endast mot den separata lokala demoprofilen."
);

const pageTips = [
  ["/deltagare", "Deltagarna är grunden", "Spara bara det köket behöver"],
  ["/specialkost", "Granska uppgifterna", "Du fattar beslutet"],
  ["/recept", "Välj recept", "Lägg till i lägret"],
  ["/matsedel", "Planera varje servering", "Räkna ut mängderna"],
  ["/inkop", "Skapa inköpsunderlaget", "Kontrollera innan du beställer"],
  ["/leveranser", "Fördela inköpen", "Gör klart leveransen"]
] as const;

async function provisionCanonicalDemo(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Prova Lägermat" })).toBeVisible();
  await expect(page.locator("[data-tutorial-ui]")).toHaveCount(0);

  const openButton = page.getByRole("button", { name: "Öppna demolägret" });
  await expect(openButton).toBeEnabled({ timeout: 30_000 });
  await openButton.click();

  await expect(page.getByRole("heading", { name: "Sommarläger 2026" }))
    .toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("main").getByText(
    "Björkstad scoutkår",
    { exact: false }
  ).first())
    .toBeVisible();
  await expect(page.getByRole("dialog", {
    name: "Välkommen till ditt demoläger"
  })).toBeVisible();
}

function nonReadRequests(page: Page) {
  const requests: string[] = [];
  const listener = (request: Request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      requests.push(`${request.method()} ${request.url()}`);
    }
  };
  page.on("request", listener);
  return {
    requests,
    stop: () => page.off("request", listener)
  };
}

async function expectTutorialLayout(
  page: Page,
  projectName: string,
  title: string
) {
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  const overlay = page.locator("[data-tutorial-layout]");
  const layout = await overlay.getAttribute("data-tutorial-layout");

  if (projectName.includes("mobile")) {
    expect(layout).toBe("sheet");
  } else {
    expect(layout).toMatch(/^(?:popover|dialog)$/);
  }

  if (layout === "popover") {
    await expect(page.locator("[data-tutorial-active='true']")).toBeVisible();
  }

  const viewport = page.viewportSize();
  const dialogBox = await dialog.boundingBox();
  expect(viewport).not.toBeNull();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport!.height);
}

async function browserStorageWithoutTutorial(page: Page) {
  return page.evaluate((tutorialKey) => Object.fromEntries(
    Object.entries(window.localStorage)
      .filter(([key]) => key !== tutorialKey)
      .sort(([left], [right]) => left.localeCompare(right))
  ), TUTORIAL_PROGRESS_KEY);
}

test("guiden fungerar på den kanoniska demoläger-fixturen", async ({ page }, testInfo) => {
  await provisionCanonicalDemo(page);

  expect(await page.locator("[data-tutorial-ready]").getAttribute("data-tutorial-ready"))
    .toBe("true");
  expect(await page.getByText("Steg 1 av 6").textContent()).toBe("Steg 1 av 6");
  await page.getByRole("button", { name: "Visa mig runt" }).click();
  await expectTutorialLayout(page, testInfo.project.name, "Du arbetar i demoläget");
  await page.getByRole("button", { name: "Nästa" }).click();
  await expectTutorialLayout(page, testInfo.project.name, "Organisation och läger");

  await page.reload();
  await expect(page.getByRole("dialog", { name: "Organisation och läger" }))
    .toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Steg 3 av 6")).toBeVisible();

  const introRequests = nonReadRequests(page);
  for (const title of ["Appens delar", "Planera i rätt ordning", "Nästa steg"] ) {
    await page.getByRole("button", { name: "Nästa" }).click();
    await expectTutorialLayout(page, testInfo.project.name, title);
  }
  introRequests.stop();
  expect(introRequests.requests, "Introduktionskontrollerna får inte skriva till servern")
    .toEqual([]);

  await expect(page.getByText(
    "Ta ett steg i taget. Vi visar vad som återstår innan inköpsunderlaget är klart."
  )).toBeVisible();
  await expect(page.getByText("Nästa steg", { exact: true }).first()).toBeVisible();
  const nextPath = await page.locator("[data-tutorial-id='overview-next-action']")
    .getAttribute("data-tutorial-next-path");
  expect(nextPath).toMatch(/^\/(?:deltagare|specialkost|recept|matsedel|inkop|leveranser)$/);
  await page.getByRole("button", { name: "Gå till nästa steg" }).click();
  await expect(page).toHaveURL(new RegExp(`${nextPath}$`));

  for (const [route, firstTitle, secondTitle] of pageTips) {
    await page.goto(route);
    await expectTutorialLayout(page, testInfo.project.name, firstTitle);
    const tipRequests = nonReadRequests(page);
    await page.getByRole("button", { name: "Nästa" }).click();
    await expectTutorialLayout(page, testInfo.project.name, secondTitle);
    await page.getByRole("button", { name: "Avsluta" }).click();
    tipRequests.stop();
    expect(tipRequests.requests, `Tipsen på ${route} får inte skriva till servern`)
      .toEqual([]);

    await page.reload();
    await expect(page.locator("[data-tutorial-ui]")).toHaveCount(0);
  }

  await page.goto("/");
  await expect(page.locator("[data-tutorial-ui]")).toHaveCount(0);
  const resetButton = page.getByRole("button", { name: "Återställ demolägret" });
  await expect(resetButton).toBeEnabled({ timeout: 30_000 });
  page.once("dialog", (dialog) => dialog.accept());
  await resetButton.click();
  await expect(page.getByRole("heading", { name: "Sommarläger 2026" }))
    .toBeVisible({ timeout: 45_000 });
  await expect(page.locator("[data-tutorial-ui]")).toHaveCount(0);

  const storageBeforeReplay = await browserStorageWithoutTutorial(page);
  await page.getByRole("button", { name: "Visa guiden igen" }).click();
  await expect(page.getByRole("dialog", {
    name: "Välkommen till ditt demoläger"
  })).toBeVisible();
  expect(await browserStorageWithoutTutorial(page)).toEqual(storageBeforeReplay);

  await page.getByRole("button", { name: "Hoppa över guiden" }).click();
  await page.goto("/deltagare");
  await expect(page.getByRole("dialog", { name: "Deltagarna är grunden" }))
    .toBeVisible();
  await page.getByRole("button", { name: "Stäng tipset" }).click();
});
