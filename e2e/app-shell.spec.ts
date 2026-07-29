import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { utils, write } from "xlsx";
import { enrolLocalAdminMfa, localMessageIds, loginWithLocalMagicLink, waitForLocalAuthLink } from "./localAuth";

test.describe.configure({ mode: "serial" });

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
    const rows = values.flat();
    return {
      current: rows.filter((row) => row.userId === "44444444-4444-4444-4444-444444444444").length,
      other: rows.filter((row) => row.userId === "99999999-9999-9999-9999-999999999999").length
    };
  });
}

test("desktop app shell exposes all seven main areas", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only assertion");
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  await expect(page.getByRole("heading", { name: "Sommarläger 2026" })).toBeVisible();
  await expect(page.getByText(/55 deltagare/)).toBeVisible();

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

  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("inte synkroniserats");
    await confirmation.dismiss();
  });
  await page.getByRole("button", { name: "Öppna användarmenyn" }).click();
  await page.getByRole("menuitem", { name: "Logga ut" }).click();
  await expect(page.getByRole("heading", { name: "Sommarläger 2026" })).toBeVisible();
  await expect.poll(() => signOutAcceptanceCounts(page)).toEqual(beforeSignOut);

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
  await expect(page.getByLabel("Receptöversikt")).toContainText("26 recept");
  await expect(page.getByLabel("Receptöversikt")).toContainText("9 valda för lägret");
  await expect(page.getByLabel("Receptöversikt")).not.toContainText("mängdlägen");
  await page.getByPlaceholder("Sök bland recept").fill("Frukost");
  await page.getByRole("button", { name: "Visa Frukost" }).click();
  await expect(page.getByText("Per portion", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("En gång för hela lägret", { exact: true }).first()).toBeVisible();

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

test("the complete camp schedule keeps meal actions inside the clicked cell", async ({ page, request }, testInfo) => {
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  await page.goto("/matsedel");

  await expect(page.locator(".warning-banner, .schedule-ready-banner")).toBeVisible();
  const confirmPlan = page.getByRole("button", { name: "Bekräfta standardplan" });
  await expect(confirmPlan).toHaveCount(0);
  await expect(page.getByRole("columnheader")).toHaveCount(5);
  await expect(page.getByText(/12\/12 tillfällen planerade/)).toBeVisible();
  await expect(page.getByText(/måltidstillfällen är oplanerade/)).toHaveCount(0);
  const mealDetail = page.locator(".meal-detail");
  const chiliMeal = page.getByRole("button", { name: /^Chili sin carne,/ });
  const chiliMealCard = page.locator(".meal-cell").filter({ has: chiliMeal });
  await chiliMeal.click();
  await expect(chiliMeal).toHaveAttribute("aria-expanded", "true");
  await expect(chiliMealCard.getByRole("button", { name: "Redigera Chili sin carne" })).toBeVisible();
  await expect(chiliMealCard.getByRole("button", { name: "Skippa Chili sin carne" })).toBeVisible();
  await expect(mealDetail.getByRole("heading", { name: "Chili sin carne" })).toBeVisible();

  if (testInfo.project.name.includes("desktop")) {
    await chiliMealCard.getByRole("button", { name: "Skippa Chili sin carne" }).click();
    const skipDialog = page.getByRole("alertdialog", { name: "Skippa Chili sin carne?" });
    await expect(skipDialog).toBeVisible();
    await expect(skipDialog.getByText(/Måltidsuppgifterna bevaras/)).toBeVisible();
    await skipDialog.getByRole("button", { name: "Bekräfta och skippa" }).click();

    await expect(page.getByText(/Chili sin carne skippades/)).toBeVisible();
    const skippedMeal = page.getByRole("button", { name: /^Ingen servering, Chili sin carne bevarad,/ });
    const skippedMealCard = page.locator(".meal-slot--none").filter({ has: skippedMeal });
    await expect(skippedMeal).toBeVisible();
    await expect(skippedMeal).toHaveAttribute("aria-expanded", "true");
    await expect(mealDetail.getByRole("heading", { name: "Ingen servering" })).toBeVisible();
    await expect(mealDetail.getByText("Chili sin carne är bevarad")).toBeVisible();
    await skippedMealCard.getByRole("button", { name: /^Återställ måltiden,/ }).click();
    await expect(page.getByText(/Chili sin carne återställdes/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Chili sin carne,/ })).toBeVisible();
  } else {
    await expect(chiliMealCard.getByRole("button", { name: "Skippa Chili sin carne" })).toBeVisible();
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
  expect(csv).toContain('"Beräknat behov"');
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
