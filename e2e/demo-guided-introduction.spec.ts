import { expect, test, type Page, type Request } from "@playwright/test";
import { TUTORIAL_PROGRESS_KEY } from "../src/features/tutorial/tutorialProgress";

test.describe.configure({ mode: "serial" });
test.skip(
  process.env.PLAYWRIGHT_DEMO_MODE !== "true",
  "Körs endast mot den separata lokala demoprofilen."
);

const pageTips = [
  [
    "/deltagare",
    "Deltagarna är grunden",
    "Spara bara det köket behöver",
    "Gå vidare till specialkost",
    "/specialkost"
  ],
  [
    "/specialkost",
    "Granska uppgifterna",
    "Du fattar beslutet",
    "Gå vidare till recept",
    "/recept"
  ],
  [
    "/recept",
    "Välj recept",
    "Lägg till i lägret",
    "Gå vidare till matsedel",
    "/matsedel"
  ]
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

const readOnlyPostRpcPaths = new Set([
  "/rest/v1/rpc/get_camp_readiness",
  "/rest/v1/rpc/get_demo_session_status",
  "/rest/v1/rpc/get_zero_attendance_meals"
]);

function stateChangingRequests(page: Page) {
  const requests: string[] = [];
  const listener = (request: Request) => {
    const url = new URL(request.url());
    const readOnlyPost = request.method() === "POST"
      && readOnlyPostRpcPaths.has(url.pathname);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
      && !readOnlyPost
    ) {
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

  if (projectName.includes("mobile")) {
    await expect(overlay).toHaveAttribute("data-tutorial-layout", "sheet");
  } else {
    await expect(overlay).toHaveAttribute(
      "data-tutorial-layout",
      /^(?:popover|dialog)$/
    );
  }

  const layout = await overlay.getAttribute("data-tutorial-layout");
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

async function expectTutorialTargetUnobscured(
  page: Page,
  tutorialIds: string | readonly string[]
) {
  const candidates = typeof tutorialIds === "string"
    ? [tutorialIds]
    : tutorialIds;
  let tutorialId = candidates[0];
  for (const candidate of candidates) {
    if (await page.locator(`[data-tutorial-id='${candidate}']`).count()) {
      tutorialId = candidate;
      break;
    }
  }
  const target = page.locator(`[data-tutorial-id='${tutorialId}']`);
  await expect(target).toBeVisible();

  await expect.poll(async () => {
    const viewport = page.viewportSize();
    const targetBox = await target.boundingBox();
    const dialogBox = await page.getByRole("dialog").boundingBox();
    if (!viewport || !targetBox || !dialogBox) return false;

    const insideViewport = targetBox.x >= 0
      && targetBox.y >= 0
      && targetBox.x + targetBox.width <= viewport.width
      && targetBox.y + targetBox.height <= viewport.height;
    const horizontalOverlap = Math.max(
      0,
      Math.min(targetBox.x + targetBox.width, dialogBox.x + dialogBox.width)
        - Math.max(targetBox.x, dialogBox.x)
    );
    const verticalOverlap = Math.max(
      0,
      Math.min(targetBox.y + targetBox.height, dialogBox.y + dialogBox.height)
        - Math.max(targetBox.y, dialogBox.y)
    );

    return insideViewport && horizontalOverlap * verticalOverlap === 0;
  }, {
    message: `Guidens mål ${tutorialId} ska vara synligt och inte täckas av dialogen`
  }).toBe(true);
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

  const introRequests = stateChangingRequests(page);
  for (const title of [
    "Appens delar",
    "Planera i rätt ordning",
    "Börja med deltagarna"
  ]) {
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
  await expect(page.getByRole("dialog", { name: "Börja med deltagarna" }))
    .not.toContainText("Granska specialkost");
  await expect(page.locator("[data-tutorial-id='overview-participants-step']"))
    .toBeVisible();
  const nextPath = await page.locator("[data-tutorial-id='overview-next-action']")
    .getAttribute("data-tutorial-next-path");
  expect(nextPath).toMatch(/^\/(?:deltagare|specialkost|recept|matsedel|inkop|leveranser)$/);
  await page.getByRole("button", { name: "Gå vidare till deltagare" }).click();
  await expect(page).toHaveURL(/\/deltagare$/);

  for (const [route, firstTitle, secondTitle, continuation, nextRoute] of pageTips) {
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await expectTutorialLayout(page, testInfo.project.name, firstTitle);
    const tipRequests = stateChangingRequests(page);
    await page.getByRole("button", { name: "Nästa" }).click();
    await expectTutorialLayout(page, testInfo.project.name, secondTitle);
    await page.getByRole("button", { name: continuation }).click();
    await expect(page).toHaveURL(new RegExp(`${nextRoute}$`));
    tipRequests.stop();
    expect(tipRequests.requests, `Tipsen på ${route} får inte skriva till servern`)
      .toEqual([]);
  }

  const finishingRequests = stateChangingRequests(page);
  for (const [title, step, tutorialId] of [
    ["Så läser du matsedeln", "Steg 1 av 4", "schedule-heading"],
    ["Öppna och ändra en servering", "Steg 2 av 4", "schedule-meal-example"],
    ["Följ vad som återstår", "Steg 3 av 4", "schedule-status"],
    ["Räkna ut mängderna", "Steg 4 av 4", "schedule-calculate"]
  ] as const) {
    await expectTutorialLayout(page, testInfo.project.name, title);
    await expect(page.getByText(step)).toBeVisible();
    await expectTutorialTargetUnobscured(page, tutorialId);
    if (title === "Öppna och ändra en servering") {
      await expect(page.locator("[data-tutorial-layout]")).toHaveAttribute(
        "data-tutorial-layout",
        testInfo.project.name.includes("mobile") ? "sheet" : "popover"
      );
    }
    if (title !== "Räkna ut mängderna") {
      await page.getByRole("button", { name: "Nästa" }).click();
    }
  }
  const mealExample = page.locator("[data-tutorial-id='schedule-meal-example']");
  await expect(mealExample).toBeVisible();
  await expect(mealExample.getByRole("button")).toContainText("Ändra måltid");
  await expect(page.locator("[data-tutorial-id='schedule-calculate']"))
    .toHaveRole("button");
  await expect(page.locator("[data-tutorial-id='schedule-calculate']"))
    .toHaveAccessibleName("Räkna ut mängder");
  await page.getByRole("button", { name: "Gå vidare till inköp" }).click();
  await expect(page).toHaveURL(/\/inkop$/);
  await expectTutorialLayout(
    page,
    testInfo.project.name,
    "Skapa inköpsunderlaget"
  );
  await expectTutorialTargetUnobscured(page, "procurement-create");
  await page.getByRole("button", { name: "Nästa" }).click();
  await expectTutorialLayout(
    page,
    testInfo.project.name,
    "Granska underlaget"
  );
  await expect(page.getByRole("dialog", { name: "Granska underlaget" }))
    .toContainText("När det finns faktiska matchningsresultat visas en separat genomgång");
  await expectTutorialTargetUnobscured(page, "procurement-review");
  await page.getByRole("button", {
    name: "Gå vidare till leveranser"
  }).click();
  await expect(page).toHaveURL(/\/leveranser$/);
  await expectTutorialLayout(
    page,
    testInfo.project.name,
    "Skapa eller fördela leveransen"
  );
  await expectTutorialTargetUnobscured(
    page,
    ["deliveries-list", "deliveries-distribute"]
  );
  await page.getByRole("button", { name: "Nästa" }).click();
  await expectTutorialLayout(
    page,
    testInfo.project.name,
    "Följ leveransen till klar"
  );
  await expectTutorialTargetUnobscured(
    page,
    ["deliveries-complete", "deliveries-distribute"]
  );
  await page.getByRole("button", { name: "Avsluta" }).click();
  finishingRequests.stop();
  expect(
    finishingRequests.requests,
    "Matsedel–inköp–leveranser-guiden får inte skriva till servern"
  ).toEqual([]);

  for (const route of ["/matsedel", "/inkop", "/leveranser"] as const) {
    await page.goto(route);
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
