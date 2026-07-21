import { expect, test, type Locator } from "@playwright/test";
import { loginWithLocalMagicLink } from "./localAuth";

function channel(value: number): number {
  const normalised = value / 255;
  return normalised <= 0.04045
    ? normalised / 12.92
    : ((normalised + 0.055) / 1.055) ** 2.4;
}

function luminance(cssColour: string): number {
  const components = cssColour.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!components || components.length !== 3) throw new Error(`Kan inte läsa färgen ${cssColour}`);
  return 0.2126 * channel(components[0]!)
    + 0.7152 * channel(components[1]!)
    + 0.0722 * channel(components[2]!);
}

function contrast(first: string, second: string): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

async function expectMinimumTarget(locator: Locator, minimum = 44): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, "Kontrollen ska vara synlig och ha en träffyta").not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(minimum);
  expect(box!.height).toBeGreaterThanOrEqual(minimum);
}

test("delivery workflow has names, keyboard focus and sufficient core contrast", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only accessibility assertion");
  await loginWithLocalMagicLink(page, request, "mobil@bjorkstad.test");
  await page.goto("/leveranser");
  await expect(page.getByRole("heading", { name: /^Leverans 1/ })).toBeVisible();

  const unnamedControls = await page.locator("button, a[href], input, select").evaluateAll((elements) =>
    elements.flatMap((element) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return [];

      const labelledBy = html.getAttribute("aria-labelledby");
      const labelledText = labelledBy
        ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ")
        : "";
      const inputLabels = html instanceof HTMLInputElement || html instanceof HTMLSelectElement
        ? Array.from(html.labels ?? []).map((label) => label.textContent ?? "").join(" ")
        : "";
      const name = html.getAttribute("aria-label")
        || labelledText
        || inputLabels
        || html.textContent
        || "";
      return name.trim() ? [] : [`${html.tagName.toLowerCase()}.${html.className}`];
    }),
  );
  expect(unnamedControls).toEqual([]);

  const checkbox = page.getByRole("checkbox", { name: /Markera som/ }).first();
  await checkbox.focus();
  await expect(checkbox).toBeFocused();
  const focusStyle = await checkbox.locator("xpath=following-sibling::span[1]").evaluate((element) => {
    const style = getComputedStyle(element);
    return { colour: style.outlineColor, style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focusStyle.style).toBe("solid");
  expect(Number.parseFloat(focusStyle.width)).toBeGreaterThanOrEqual(3);

  const wasChecked = await checkbox.isChecked();
  await checkbox.press("Space");
  await expect(checkbox).toBeChecked({ checked: !wasChecked });

  const colours = await page.locator(".topbar").evaluate((element) => {
    const style = getComputedStyle(element);
    const focusColour = getComputedStyle(document.documentElement).getPropertyValue("--focus").trim();
    const probe = document.createElement("span");
    probe.style.color = focusColour;
    document.body.append(probe);
    const resolvedFocus = getComputedStyle(probe).color;
    probe.remove();
    return { background: style.backgroundColor, foreground: style.color, focus: resolvedFocus };
  });
  expect(contrast(colours.foreground, colours.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colours.focus, "rgb(255, 255, 255)")).toBeGreaterThanOrEqual(3);
  expect(contrast(colours.focus, colours.background)).toBeGreaterThanOrEqual(3);
});

test("mobile delivery controls expose 44 pixel touch targets", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only touch-target assertion");
  await loginWithLocalMagicLink(page, request, "oskar@bjorkstad.test");
  await page.goto("/leveranser");
  await expect(page.getByRole("heading", { name: /^Leverans 1/ })).toBeVisible();

  await expectMinimumTarget(page.getByRole("link", { name: "Tillbaka till översikten" }));
  await expectMinimumTarget(page.getByRole("button", { name: "Öppna huvudmenyn" }));
  await expectMinimumTarget(page.getByRole("button", { name: /^Alla / }));
  await expectMinimumTarget(page.locator(".delivery-check").first());
  await expectMinimumTarget(page.getByRole("button", { name: /Visa detaljer för/ }).first());
  await expectMinimumTarget(page.locator(".delivery-search"));
});
