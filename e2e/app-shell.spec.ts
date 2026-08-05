import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { utils, write } from "xlsx";
import { enrolLocalAdminMfa, localMessageIds, loginWithLocalMagicLink, waitForLocalAuthLink } from "./localAuth";

test.describe.configure({ mode: "serial" });

const localSupabaseUrl = process.env.PLAYWRIGHT_SUPABASE_URL
  ?? "http://127.0.0.1:54321";
const localAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYXNlLWRlbW8iLCJyb2xlIjoiYW5vbiIsImV4cCI6MTk4MzgxMjk5Nn0.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const currentUserOfflineRecords = [
  "signout-current-mutation",
  "signout-current-supply",
  "signout-current-workspace"
];
const otherUserOfflineRecords = [
  "signout-other-mutation",
  "signout-other-supply",
  "signout-other-workspace"
];

function syntheticScoutnetWorkbook() {
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet([
    ["Syntetisk Scoutnet-export för automatiserade tester"],
    ["Namn", "Anmäld", "Personnummer", "Generellt - Avdelning", "Generellt - Patrull", "Generellt - Dagar"],
    ["Person 1", "Nej", "20100101-0000", "Spårarna", "Räven", "2026-08-02"]
  ]);
  utils.book_append_sheet(workbook, sheet, "A. IMPORT_HERE");

  return {
    name: "scoutnet-safe.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer
  };
}

async function seedSignOutAcceptanceData(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("lagermat-local-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        ["mutations", "supplySnapshots", "workspaceSnapshots"],
        "readwrite"
      );
      transaction.objectStore("mutations").put({
        id: "signout-current-mutation",
        userId: "44444444-4444-4444-4444-444444444444"
      });
      transaction.objectStore("mutations").put({
        id: "signout-other-mutation",
        userId: "99999999-9999-9999-9999-999999999999"
      });
      transaction.objectStore("supplySnapshots").put({
        id: "signout-current-supply",
        userId: "44444444-4444-4444-4444-444444444444"
      });
      transaction.objectStore("supplySnapshots").put({
        id: "signout-other-supply",
        userId: "99999999-9999-9999-9999-999999999999"
      });
      transaction.objectStore("workspaceSnapshots").put({
        id: "signout-current-workspace",
        userId: "44444444-4444-4444-4444-444444444444"
      });
      transaction.objectStore("workspaceSnapshots").put({
        id: "signout-other-workspace",
        userId: "99999999-9999-9999-9999-999999999999"
      });
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  });
}

async function signOutAcceptanceCounts(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("lagermat-local-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const values = await Promise.all(
      ["mutations", "supplySnapshots", "workspaceSnapshots"].map((storeName) =>
        new Promise<Array<{ userId?: string }>>((resolve, reject) => {
          const request = database.transaction(storeName).objectStore(storeName).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        })
      )
    );
    database.close();
    const rows = values.flat() as Array<{ id?: string; userId?: string }>;
    return {
      current: rows.filter((row) => row.userId === "44444444-4444-4444-4444-444444444444").length,
      other: rows.filter((row) => row.userId === "99999999-9999-9999-9999-999999999999").length,
      ids: rows.flatMap((row) => typeof row.id === "string" ? [row.id] : [])
    };
  });
}

async function createScheduleWarningFixture(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  marker: string
) {
  const displayName = `Varningskontroll ${marker}`;
  const accessToken = await page.evaluate(() => {
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
  const response = await request.post(`${localSupabaseUrl}/rest/v1/rpc/create_participant`, {
    headers: {
      apikey: localAnonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    data: {
      p_organization_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
      p_camp_id: "caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
      p_display_name: displayName,
      p_division: "",
      p_patrol: "",
      p_meal_group: "",
      p_food_factor: 1,
      p_attendance_start: "2026-08-02T00:00:00+02:00",
      p_attendance_end: "2026-08-06T00:00:00+02:00",
      p_dietary_note: "Syntetisk uppgift för varningskontroll"
    }
  });
  if (!response.ok()) {
    throw new Error(`Kunde inte skapa varningsfixture: ${response.status()} ${await response.text()}`);
  }
  return displayName;
}

test("desktop app shell exposes all seven main areas", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only assertion");
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  await expect(page.getByRole("heading", { name: "Sommarläger 2026" })).toBeVisible();
  await expect(page.getByText(/55 deltagare/)).toBeVisible();
  await expect(page.locator("[data-tutorial-ui]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Visa guiden igen" })).toHaveCount(0);

  for (const label of ["Översikt", "Deltagare", "Specialkost", "Recept", "Matsedel", "Inköp", "Leveranser"]) {
    await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
  }

  await page.goto("/deltagare");
  await expect(page.getByText("55 personer", { exact: true })).toBeVisible();
  await expect(page.getByText("Alva Andersson", { exact: true })).toBeVisible();
  await expect(page.getByText("Joel Wester", { exact: true })).toBeVisible();
  await expect(page.getByText("Elin Åberg", { exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Ledare", exact: true })).toBeAttached();
  await expect(page.getByText(/Demo Scout|Testanvändare/)).toHaveCount(0);
});

test("mobile app shell exposes navigation, workspace and user actions from the menu", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only shell assertion");
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  await expect(page.locator("[data-tutorial-ui]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Visa guiden igen" })).toHaveCount(0);

  const menuButton = page.getByRole("button", { name: "Öppna huvudmenyn" });
  await menuButton.focus();
  await menuButton.press("Enter");

  const menu = page.getByRole("dialog", { name: "Huvudmeny" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: /Organisation/ })).toBeVisible();
  await expect(menu.getByRole("button", { name: /Läger/ })).toBeVisible();
  for (const label of ["Översikt", "Deltagare", "Specialkost", "Recept", "Matsedel", "Inköp", "Leveranser"]) {
    await expect(menu.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(menu.getByRole("link", { name: "Användare och behörigheter" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Logga ut" })).toBeVisible();
  await expect(menu.locator(":focus")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(menuButton).toBeFocused();

  await menuButton.click();
  await menu.getByRole("link", { name: "Deltagare", exact: true }).click();
  await expect(page).toHaveURL(/\/deltagare$/);
  await expect(menu).toBeHidden();
});

test("mobile overview does not render a back link to itself", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only shell assertion");
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Sommarläger 2026" })).toBeVisible();
  await expect(page.locator('a[aria-label="Tillbaka till översikten"]')).toHaveCount(0);
  await page.goto("/deltagare");
  await expect(page.getByRole("link", { name: "Tillbaka till översikten" })).toBeVisible();
});

test("sign-out warns, honours cancellation and only clears the current user's offline data", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only offline privacy assertion");
  await loginWithLocalMagicLink(page, request, "mobil@bjorkstad.test");
  await seedSignOutAcceptanceData(page);
  const beforeSignOut = await signOutAcceptanceCounts(page);
  expect(beforeSignOut.current).toBeGreaterThanOrEqual(3);
  expect(beforeSignOut.other).toBe(3);
  expect(beforeSignOut.ids).toEqual(expect.arrayContaining([
    ...currentUserOfflineRecords,
    ...otherUserOfflineRecords
  ]));

  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("inte synkroniserats");
    await confirmation.dismiss();
  });
  await page.getByRole("button", { name: "Öppna användarmenyn" }).click();
  await page.getByRole("menuitem", { name: "Logga ut" }).click();
  await expect(page.getByRole("heading", { name: "Sommarläger 2026" })).toBeVisible();
  const afterCancellation = await signOutAcceptanceCounts(page);
  expect(afterCancellation.ids).toEqual(expect.arrayContaining([
    ...currentUserOfflineRecords,
    ...otherUserOfflineRecords
  ]));

  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("inte synkroniserats");
    await confirmation.accept();
  });
  await page.getByRole("button", { name: "Öppna användarmenyn" }).click();
  await page.getByRole("menuitem", { name: "Logga ut" }).click();
  await expect(page.getByRole("heading", { name: "Logga in utan lösenord" })).toBeVisible();

  // lagermat-local-v1 must preserve the other user's offline data.
  const counts = await signOutAcceptanceCounts(page);
  expect(counts.current).toBe(0);
  expect(counts.other, "andra användarens offline-data ska finnas kvar").toBe(3);
  expect(counts.ids).toEqual(expect.arrayContaining(otherUserOfflineRecords));
  for (const id of currentUserOfflineRecords) expect(counts.ids).not.toContain(id);
});

test("delivery page stays tenant-isolated in a mobile viewport", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only assertion");
  await loginWithLocalMagicLink(page, request, "sara@sjovik.test");
  await page.goto("/leveranser");
  await expect(page.getByRole("heading", { name: "Inga leveranser ännu" })).toBeVisible();
  await expect(page.getByText(/föreslår leveransdagar utifrån matsedeln/)).toBeVisible();
  await expect(page.getByText("Aubergine", { exact: true })).toBeHidden();
});

test("Scoutnet CSV and synthetic XLSX are previewed, minimized and imported locally", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only import assertion");
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  await page.goto("/deltagare");
  await page.getByLabel("Välj XLSX eller CSV").setInputFiles("e2e/fixtures/scoutnet-safe.csv");

  await expect(page.getByRole("heading", { name: "Kontrollera hur kolumnerna ska användas" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Namn på rad 2" })).toHaveValue("Ada Testscout");
  await expect(page.getByRole("checkbox", { name: "Ta med rad 3" })).not.toBeChecked();
  await expect(page.getByText("2 deltagare redo")).toBeVisible();

  await page.getByRole("button", { name: "Importera 2 deltagare" }).click();
  await expect(page.getByText("2 deltagare importerades. Källfilens övriga värden sparades inte.")).toBeVisible();
  await expect(page.getByText("Ada Testscout", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Cilla Testledare", { exact: true }).first()).toBeVisible();

  await page.getByLabel("Välj XLSX eller CSV").setInputFiles(syntheticScoutnetWorkbook());
  await expect(page.getByText("scoutnet-safe.xlsx", { exact: true })).toBeVisible();
  await expect(page.getByText(/bladet A\. IMPORT_HERE/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Namn på rad 3", exact: true })).toHaveValue("Person 1");
  await expect(page.getByRole("combobox", { name: "Användning för Anmäld" })).toHaveValue("registered");
  await expect(page.getByRole("combobox", { name: "Användning för Personnummer" })).toHaveValue("ignore");
  await expect(page.getByRole("checkbox", { name: "Ta med rad 3", exact: true })).not.toBeChecked();
});

test("raw dietary text is explicitly reviewed and participant details remain editable", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only planning assertion");
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  await page.goto("/specialkost");

  const glutenReview = page.locator("article").filter({ hasText: "Wilma Pettersson" });
  await expect(glutenReview.getByText("Celiaki – behöver glutenfri kost.", { exact: true })).toBeVisible();
  await expect(glutenReview.getByRole("checkbox", { name: "Glutenfri kost" })).toBeChecked();
  await glutenReview.getByRole("button", { name: "Spara specialkost" }).click();
  const reviewedDiets = page.locator("aside").filter({ has: page.getByRole("heading", { name: "Granskade" }) });
  await expect(glutenReview).toBeHidden();
  const wilmaDiet = reviewedDiets.locator(".resolved-diet-list > div").filter({ hasText: "Wilma Pettersson" });
  await expect(wilmaDiet.getByText("Glutenfri kost", { exact: true })).toBeVisible();

  const importedReview = page.locator("article").filter({ hasText: "Ada Testscout" });
  await expect(importedReview.getByRole("checkbox", { name: "Glutenfri kost" })).toBeChecked();
  await importedReview.getByRole("button", { name: "Spara specialkost" }).click();
  await expect(importedReview).toBeHidden();

  await page.goto("/deltagare");
  await page.getByRole("button", { name: "Redigera Wilma Pettersson" }).click();
  await page.getByRole("textbox", { name: /Portionsstorlek/ }).fill("0.8");
  await page.getByRole("button", { name: "Spara deltagare" }).click();
  await expect(page.getByText("Deltagaren och närvaroperioden uppdaterades.")).toBeVisible();
  await expect(page.getByText("Portionsstorlek 80 %", { exact: true })).toBeVisible();
});

test("a published workbook recipe is frozen locally for the active camp", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only recipe assertion");
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  await page.goto("/recept");

  await expect(page.getByRole("heading", { name: "Recept", exact: true })).toBeVisible();
  await expect(page.getByLabel("Receptöversikt")).toContainText("34 recept");
  await expect(page.getByLabel("Receptöversikt")).toContainText("9 valda för lägret");
  await expect(page.getByLabel("Receptöversikt")).not.toContainText("mängdlägen");
  await page.getByPlaceholder("Sök bland recept").fill("Frukost");
  await page.getByRole("button", { name: "Visa Frukost" }).click();
  await expect(page.getByText("Per portion", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("En gång för hela lägret", { exact: true })).toHaveCount(0);
  await expect(page.locator(".recipe-ingredient__amount").filter({ hasText: "paket" })).toHaveCount(0);

  await page.getByRole("button", { name: "Lägg till Frukost version 1 i lägret" }).click();
  await expect(page.getByText("Frukost, version 1, finns redan i Sommarläger 2026.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lägg till Frukost version 1 i lägret" })).toContainText("Tillagt i lägret");
});

test("procurement sends the user to calculate when no current revision exists", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only prerequisite assertion");
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  await page.goto("/inkop");

  await expect(page.getByRole("heading", { name: "Inköp och utdelning" })).toBeVisible();
  await expect(page.getByText("Det finns ingen aktuell mängdberäkning.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Uppdatera från beräkning|Skapa listor/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Räkna ut mängder" }).click();
  await expect(page).toHaveURL(/\/matsedel$/);
  await expect(page.getByRole("heading", { name: "Matsedel" })).toBeVisible();
});

test("the schedule warning explains the next fix and opens it", async ({ page, request }, testInfo) => {
  let fixtureParticipantName: string | null = null;
  if (process.env.PLAYWRIGHT_DEMO_MODE !== "true") {
    await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
    fixtureParticipantName = await createScheduleWarningFixture(
      page,
      request,
      `${testInfo.project.name}-${Date.now()}`
    );
  }
  await page.goto("/matsedel");

  const warning = page.getByRole("link", { name: /[1-9]\d* specialkostuppgift(?:er)? behöver granskas.*Granska specialkost/ });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("Kontrollera uppgiften från anmälan");
  await expect(page.getByText("Underlag med varningar", { exact: true })).toHaveCount(0);

  await warning.click();
  await expect(page).toHaveURL(/\/specialkost$/);
  await expect(page.getByRole("heading", { name: "Specialkost", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Att granska" })).toBeVisible();
  if (fixtureParticipantName) {
    const fixtureCard = page.locator("article").filter({ hasText: fixtureParticipantName });
    await fixtureCard.getByRole("button", { name: "Påverkar inte maten" }).click();
    await expect(fixtureCard).toBeHidden();
  }
});

test("the calculation confirmation is a short-lived overlay", async ({ page, request }) => {
  if (process.env.PLAYWRIGHT_DEMO_MODE !== "true") {
    await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  }
  await page.goto("/matsedel");

  const scheduleLayout = page.locator(".schedule-layout");
  const calculateButton = page.getByRole("button", { name: "Räkna ut mängder" });
  const notification = page.locator(".schedule-toast");
  await expect(scheduleLayout).toBeVisible();
  await calculateButton.click();
  await expect(notification).toContainText(/Mängderna räknades om/);
  await page.getByRole("button", { name: "Stäng meddelandet" }).click();
  await expect(notification).toBeHidden();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const layoutBefore = await scheduleLayout.boundingBox();
  expect(layoutBefore).not.toBeNull();

  await calculateButton.click();
  await expect(notification).toContainText(/Mängderna räknades om/);
  await expect(notification).toHaveCSS("position", "fixed");
  await expect(page.locator(".schedule-page > .form-success")).toHaveCount(0);

  const layoutAfter = await scheduleLayout.boundingBox();
  expect(layoutAfter?.y).toBe(layoutBefore?.y);
  await expect(notification).toBeHidden({ timeout: 5_000 });
});

test("the complete camp schedule keeps meal actions inside the clicked cell", async ({ page, request }, testInfo) => {
  if (process.env.PLAYWRIGHT_DEMO_MODE !== "true") {
    await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  }
  await page.goto("/matsedel");

  await expect(page.locator(".warning-banner, .schedule-ready-banner")).toBeVisible();
  const confirmPlan = page.getByRole("button", { name: "Bekräfta standardplan" });
  await expect(confirmPlan).toHaveCount(0);
  await expect(page.getByRole("columnheader")).toHaveCount(5);
  await expect(page.getByText(/12\/12 tillfällen planerade/)).toBeVisible();
  await expect(page.getByText(/måltidstillfällen är oplanerade/)).toHaveCount(0);
  const mealDetail = page.locator(".meal-detail");
  const chiliMeal = page.getByRole("button", { name: /^(?:Chili sin carne|Chili lunch uppdaterad),/ });
  const chiliMealCard = page.locator(".meal-cell").filter({ has: chiliMeal });
  const lunchRow = page.locator(".schedule-table tbody tr").filter({
    has: page.getByRole("rowheader", { name: "Lunch", exact: true })
  });
  const dinnerRow = page.locator(".schedule-table tbody tr").filter({
    has: page.getByRole("rowheader", { name: "Middag", exact: true })
  });
  const pastaMeal = page.getByRole("button", { name: /^Pasta carbonara,/ });

  await expect(chiliMeal).toBeVisible();
  const chiliMealName = await chiliMeal.locator("strong").innerText();
  await chiliMeal.scrollIntoViewIfNeeded();
  await expect(chiliMeal).toContainText("Ändra måltid");
  const [cardBefore, rowBefore, nextRowBefore, scrollBefore] = await Promise.all([
    chiliMealCard.boundingBox(),
    lunchRow.boundingBox(),
    dinnerRow.boundingBox(),
    page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
  ]);
  expect(cardBefore).not.toBeNull();
  expect(rowBefore).not.toBeNull();
  expect(nextRowBefore).not.toBeNull();

  await chiliMeal.click();
  await expect(chiliMeal).toHaveAttribute("aria-expanded", "true");
  const editMeal = chiliMealCard.getByRole("button", { name: `Redigera ${chiliMealName}` });
  const markNoService = chiliMealCard.getByRole("button", { name: `Markera ${chiliMealName} som ingen servering` });
  await expect(editMeal).toBeVisible();
  await expect(editMeal).toBeFocused();
  await expect(markNoService).toContainText("Ingen servering");
  await expect(mealDetail.getByRole("heading", { name: chiliMealName })).toBeVisible();

  const [cardAfter, rowAfter, nextRowAfter, scrollAfter] = await Promise.all([
    chiliMealCard.boundingBox(),
    lunchRow.boundingBox(),
    dinnerRow.boundingBox(),
    page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
  ]);
  expect(cardAfter?.width).toBe(cardBefore?.width);
  expect(cardAfter?.height).toBe(cardBefore?.height);
  expect((cardAfter?.x ?? 0) - (rowAfter?.x ?? 0)).toBeCloseTo((cardBefore?.x ?? 0) - (rowBefore?.x ?? 0), 5);
  expect((cardAfter?.y ?? 0) + scrollAfter.y).toBeCloseTo((cardBefore?.y ?? 0) + scrollBefore.y, 5);
  expect(rowAfter?.width).toBe(rowBefore?.width);
  expect(rowAfter?.height).toBe(rowBefore?.height);
  expect((rowAfter?.y ?? 0) + scrollAfter.y).toBeCloseTo((rowBefore?.y ?? 0) + scrollBefore.y, 5);
  expect(nextRowAfter?.width).toBe(nextRowBefore?.width);
  expect(nextRowAfter?.height).toBe(nextRowBefore?.height);
  expect((nextRowAfter?.y ?? 0) + scrollAfter.y).toBeCloseTo((nextRowBefore?.y ?? 0) + scrollBefore.y, 5);

  await page.keyboard.press("Escape");
  await expect(chiliMeal).toHaveAttribute("aria-expanded", "false");
  await expect(chiliMeal).toBeFocused();
  await expect(mealDetail.getByRole("heading", { name: chiliMealName })).toBeVisible();

  await chiliMeal.click();
  await chiliMealCard.getByRole("button", { name: "Stäng måltidsval" }).click();
  await expect(chiliMeal).toHaveAttribute("aria-expanded", "false");
  await expect(chiliMeal).toBeFocused();

  await chiliMeal.click();
  await pastaMeal.click();
  await expect(chiliMeal).toHaveAttribute("aria-expanded", "false");
  await expect(pastaMeal).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".meal-card__actions")).toHaveCount(1);
  const pastaMealCard = page.locator(".meal-cell").filter({ has: pastaMeal });
  await pastaMealCard.getByRole("button", { name: "Stäng måltidsval" }).click();
  await chiliMeal.click();

  if (testInfo.project.name.includes("desktop")) {
    await markNoService.click();
    const noServiceDialog = page.getByRole("alertdialog", { name: `Markera ${chiliMealName} som ingen servering?` });
    await expect(noServiceDialog).toBeVisible();
    await expect(noServiceDialog.getByText(/Måltidsuppgifterna bevaras/)).toBeVisible();
    await noServiceDialog.getByRole("button", { name: "Markera som ingen servering" }).click();

    await expect(page.getByText(`${chiliMealName} markerades som ingen servering. Måltidsuppgifterna är bevarade och kan återställas.`)).toBeVisible();
    const noServiceMeal = page.getByRole("button", { name: new RegExp(`^Ingen servering, ${chiliMealName} bevarad,`) });
    const noServiceMealCard = page.locator(".meal-slot--none").filter({ has: noServiceMeal });
    await expect(noServiceMeal).toBeVisible();
    await expect(noServiceMeal).toHaveAttribute("aria-expanded", "true");
    await expect(mealDetail.getByRole("heading", { name: "Ingen servering" })).toBeVisible();
    await expect(mealDetail.getByText("Måltidstillfälle")).toBeVisible();
    await expect(mealDetail.getByText(`${chiliMealName} är bevarad`)).toBeVisible();
    const restoreMeal = noServiceMealCard.getByRole("button", { name: /^Återställ måltid,/ });
    await restoreMeal.click();
    await expect(page.getByText(`${chiliMealName} återställdes`)).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(`^${chiliMealName},`) })).toBeVisible();
    await page.getByRole("button", { name: "Räkna ut mängder" }).click();
    await expect(page.getByText(/Mängderna räknades om/)).toBeVisible();
  } else {
    await expect(markNoService).toContainText("Ingen servering");
  }
});

test("a meal is edited and recalculated into a traceable local revision", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only calculation assertion");
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  await page.goto("/matsedel");

  await expect(page.getByRole("heading", { name: "Matsedel" })).toBeVisible();
  const chiliMeal = page.getByRole("button", { name: /^Chili sin carne,/ });
  const chiliMealCard = page.locator(".meal-cell").filter({ has: chiliMeal });
  await chiliMeal.click();
  await chiliMealCard.getByRole("button", { name: "Redigera Chili sin carne" }).click();
  const mealEditor = page.getByRole("dialog", { name: "Måltidsunderlag" });
  await mealEditor.getByLabel("Titel").fill("Chili lunch uppdaterad");
  await mealEditor.getByRole("button", { name: "Lägg till", exact: true }).click();
  await page.getByLabel("Antal").fill("2");
  await mealEditor.getByRole("button", { name: "Lägg till", exact: true }).click();
  await page.getByLabel("Typ av specialkost").last().fill("Gluten");
  await page.getByLabel("Antal").last().fill("1");
  await page.getByRole("button", { name: "Spara måltid" }).click();
  await expect(page.getByText("Måltiden sparades. Beräkningen behöver köras om.")).toBeVisible();

  await page.getByRole("button", { name: "Räkna ut mängder" }).click();
  await expect(page.getByText(/Mängderna räknades om/)).toBeVisible();
  await expect(page.getByText(/mängderna är uträknade/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Beräknade mängder" })).toBeVisible();
  await expect(page.getByText("Krossade tomater", { exact: true })).toBeVisible();
  await expect(page.getByText(/kg$/, { exact: false }).first()).toBeVisible();
  await page.getByText("Så räknades mängden ut", { exact: true }).first().click();
  await expect(page.getByText(/×/).first()).toBeVisible();
});

test("exact needs become editable purchase, distribution and delivery lists", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only supply assertion");
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  await page.goto("/matsedel");
  await page.getByRole("button", { name: "Räkna ut mängder" }).click();
  await expect(page.getByText(/Mängderna räknades om/)).toBeVisible();
  await page.goto("/inkop");

  await expect(page.getByRole("heading", { name: "Inköp och utdelning" })).toBeVisible();
  await page.getByRole("button", { name: /Uppdatera från beräkning|Skapa listor/ }).click();
  await expect(page.getByText(/Listorna uppdaterades från matsedeln/)).toBeVisible();
  await expect(page.getByText("Bygger på den senaste beräkningen")).toBeVisible();

  const firstOrderedAmount = page.getByLabel(/Beställt antal för/).first();
  const firstOrderedUnit = page.getByLabel(/Beställd enhet för/).first();
  await firstOrderedAmount.fill("1,5");
  await firstOrderedUnit.fill("lådor");
  await expect(page.getByText(/Behovet anges i .* men beställningen i lådor/).first()).toBeVisible();
  await page.getByRole("button", { name: "Spara beställning" }).first().click();

  await expect(page.getByRole("button", { name: "Ladda ned CSV" })).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Ladda ned CSV" }).click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^lagermat-.*\.csv$/);
  const csvPath = await download.path();
  expect(csvPath).toBeTruthy();
  const csv = await readFile(csvPath!, "utf8");
  expect(csv).toContain('"Praktiskt behov"');
  expect(csv).toContain('"Exakt beräkning"');
  expect(csv).toMatch(/"(?:UNDERLAG MED VARNINGAR|KONTROLLERAT UNDERLAG)"/);

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Förhandsgranska och skriv ut" }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole("heading", { name: "Hela lägret" })).toBeVisible();
  await expect(popup.getByText(/Revision/)).toHaveCount(0);
  await popup.close();

  await page.getByRole("button", { name: "Per måltid och matlag" }).click();
  await expect(page.getByLabel("Måltid och matlag")).toBeVisible();
  await expect(page.getByLabel(/Exportera/)).toBeVisible();

  await page.goto("/leveranser");
  await expect(page.getByRole("heading", { name: /^Leverans 1/ })).toBeVisible();
  await expect(page.getByLabel(/^Exportera Leverans 1/)).toBeVisible();
  const firstDeliveryItem = page.getByRole("checkbox").first();
  await firstDeliveryItem.focus();
  await firstDeliveryItem.press("Space");
  await expect(firstDeliveryItem).toBeChecked();
});

test("new and existing local users accept one-time invitations with their assigned roles", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only invitation assertion");

  async function signOut() {
    await page.getByRole("button", { name: "Öppna användarmenyn" }).click();
    await page.getByRole("menuitem", { name: "Logga ut" }).click();
    await expect(page.getByRole("heading", { name: "Logga in utan lösenord" })).toBeVisible();
  }

  async function invite(email: string, role: "planner" | "admin") {
    const previousIds = await localMessageIds(request);
    await page.getByRole("textbox", { name: "E-postadress" }).fill(email);
    if (role === "admin") {
      await page.locator(".team-role-select__button").click();
      await page.locator(".team-role-select__option").filter({ hasText: "Administratör" }).click();
    }
    await page.getByRole("button", { name: "Skicka inbjudan" }).click();
    await expect(page.getByText(`Inbjudan har skickats till ${email}.`)).toBeVisible();
    return waitForLocalAuthLink(request, email, previousIds);
  }

  const newEmail = `ny-${Date.now()}@lokal.test`;
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  await enrolLocalAdminMfa(page);
  const newPlannerLink = await invite(newEmail, "planner");
  const existingAdminLink = await invite("befintlig@lokal.test", "admin");
  await signOut();

  await page.goto(newPlannerLink);
  await expect(page.getByRole("heading", { name: "Du är med" })).toBeVisible();
  await page.getByRole("link", { name: "Öppna organisationen" }).click();
  await expect(page.getByRole("heading", { name: "Sommarläger 2026" })).toBeVisible();
  await page.goto("/team");
  await expect(page.getByRole("heading", { name: "Administratör krävs" })).toBeVisible();
  await signOut();

  await page.goto(existingAdminLink);
  await expect(page.getByRole("heading", { name: "Du är med" })).toBeVisible();
  await page.getByRole("link", { name: "Öppna organisationen" }).click();
  await expect(page.getByRole("heading", { name: "Sommarläger 2026" })).toBeVisible();
  await page.getByRole("button", { name: "Öppna användarmenyn" }).click();
  await expect(page.getByRole("menuitem", { name: "Användare och behörigheter" })).toBeVisible();
});

test("a delivery edit queues offline and syncs exactly once on reconnect", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only offline assertion");
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  const signedInStorage = await page.evaluate(() => {
    const browser = globalThis as unknown as { localStorage: Record<string, string> };
    return Object.entries(browser.localStorage);
  });
  await page.goto("/");
  await page.evaluate((entries) => {
    const browser = globalThis as unknown as { localStorage: { setItem: (key: string, value: string) => void } };
    for (const [key, value] of entries) browser.localStorage.setItem(key, value);
  }, signedInStorage);
  await page.reload();
  await page.goto("/leveranser");
  if (await page.getByRole("heading", { name: "Inga leveranser ännu" }).isVisible()) {
    await page.getByRole("button", { name: "Skapa leveranser" }).click();
  }
  await expect(page.getByRole("heading", { name: /^Leverans 1/ })).toBeVisible();

  const onlineCheckbox = page.getByRole("checkbox").first();
  const initialChecked = await onlineCheckbox.isChecked();
  await page.context().setOffline(true);

  await expect(page.getByRole("heading", { name: /^Leverans 1/ })).toBeVisible();
  await expect(page.getByText("Offline – visar senast sparade uppgifter", { exact: true })).toBeVisible();
  const offlineCheckbox = page.getByRole("checkbox").first();
  await expect(offlineCheckbox).toBeChecked({ checked: initialChecked });
  await offlineCheckbox.focus();
  await offlineCheckbox.press("Space");
  await expect(offlineCheckbox).toBeChecked({ checked: !initialChecked });
  await expect(page.getByText(/1 ändring väntar/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Markera leverans klar/ })).toBeDisabled();

  await page.context().setOffline(false);
  await expect(page.getByText(/ändring(?:ar)? väntar/)).toBeHidden();
  await page.reload();
  await expect(page.getByRole("checkbox").first()).toBeChecked({ checked: !initialChecked });
});
