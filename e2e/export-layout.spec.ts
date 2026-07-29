import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPrintableSupplyHtml, createSupplyCsv, createSupplyExportDocument } from "../src/features/supplies/exportModel";
import type { SupplyListRow } from "../src/features/supplies/supplyModel";

test("the A4 export keeps a long operational list readable across pages", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only PDF rendering assertion");
  const list: SupplyListRow = {
    id: "visual-list",
    list_key: "delivery:visual",
    kind: "delivery",
    status: "active",
    title: "Leverans 1 · 2026-08-02–2026-08-05",
    range_start: "2026-08-02T00:00:00+02:00",
    range_end: "2026-08-05T23:59:59+02:00",
    version: 1,
    source_present: true,
    calculation_revisions: { revision_number: 12, status: "current" },
    supply_list_items: Array.from({ length: 72 }, (_, index) => ({
      id: `item-${index}`,
      item_key: `item-${index}`,
      canonical_key: `ingredient:item-${index}`,
      category: ["Grönt", "Torrvaror", "Kylvaror"][Math.floor(index / 24)],
      item_name: `Kontrollvara ${String(index + 1).padStart(2, "0")}`,
      required_amount: index === 0 ? 10.86025 : (index + 1) / 10,
      required_unit: index % 2 ? "kg" : "st",
      ordered_amount: index % 3 ? (index + 2) / 10 : null,
      ordered_unit: index % 2 ? "kg" : "lådor",
      package_note: index % 4 ? `${index + 1} förpackningar` : null,
      comment: index % 5 ? "Kontrollera mot följesedel" : null,
      completed: index % 3 === 0,
      row_version: 1,
      source_present: true,
      manually_moved: false
    }))
  };
  const document = createSupplyExportDocument({
    list,
    organizationName: "Björkstad scoutkår",
    campName: "Sommarläger 2026",
    timeZone: "Europe/Stockholm",
    readiness: { canFinalize: false, problems: ["2 specialkostuppgifter återstår", "1 måltid saknar recept"] },
    generatedAt: new Date("2026-07-19T14:30:00Z")
  });
  await page.setContent(createPrintableSupplyHtml(document), { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: list.title })).toBeVisible();
  await expect(page.getByText("UNDERLAG MED VARNINGAR – kontrollera före användning")).toBeVisible();

  const outputDirectory = resolve(process.cwd(), "output/pdf");
  const pdfPath = resolve(outputDirectory, "lagermat-export-verification.pdf");
  await mkdir(outputDirectory, { recursive: true });
  await page.pdf({ path: pdfPath, format: "A4", preferCSSPageSize: true, printBackground: true });
  const pdf = await readFile(pdfPath);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.byteLength).toBeGreaterThan(20_000);

  const csvDirectory = resolve(process.cwd(), "output/csv");
  const csvPath = resolve(csvDirectory, "lagermat-export-verification.csv");
  await mkdir(csvDirectory, { recursive: true });
  await writeFile(csvPath, createSupplyCsv(document), "utf8");
  const csv = await readFile(csvPath, "utf8");
  expect(csv).toContain('"10.86025"');
  expect(csv).toContain('"UNDERLAG MED VARNINGAR"');
});
