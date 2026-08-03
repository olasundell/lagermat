import {
  formatCountedAmount,
  practicalSupplyAmount,
  type PracticalSupplyAmount,
  type SupplyItemRow,
  type SupplyListKind,
  type SupplyListRow,
} from "./supplyModel";

export interface SupplyExportReadiness {
  canFinalize: boolean;
  problems: string[];
}

export interface SupplyExportDocument {
  kind: SupplyListKind;
  fileStem: string;
  title: string;
  perspective: string;
  organizationName: string;
  campName: string;
  revisionNumber: number | null;
  deliveryDate: string | null | undefined;
  generatedAt: string;
  timeZone: string;
  draft: boolean;
  problems: string[];
  items: SupplyItemRow[];
  practicalAmounts?: ReadonlyMap<string, PracticalSupplyAmount>;
}

export interface SupplyExportInput {
  list: SupplyListRow;
  organizationName: string;
  campName: string;
  timeZone: string;
  readiness: SupplyExportReadiness;
  generatedAt?: Date;
  practicalAmounts?: ReadonlyMap<string, PracticalSupplyAmount>;
  syntheticSupplierCanonicalKeys?: ReadonlySet<string>;
}

const csvColumns = [
  "Perspektiv",
  "Lista",
  "Organisation",
  "Läger",
  "Beräkning",
  "Skapad",
  "Status",
  "Att kontrollera",
  "Kategori",
  "Vara",
  "Praktiskt behov",
  "Praktisk enhet",
  "Exakt beräkning",
  "Beräkningens enhet",
  "Beställt antal",
  "Beställd enhet",
  "Förpackning för listan",
  "Beställningsförpackning för hela lägret",
  "Kommentar",
  "Klar"
] as const;

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("sv-SE")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
}

function perspectiveLabel(list: SupplyListRow): string {
  if (list.kind === "purchase") return "Hela lägret";
  if (list.kind === "distribution") return "Måltid och matlag";
  return "Leverans";
}

function rawDecimal(value: number | string | null): string {
  return value === null ? "" : String(value);
}

function csvCell(value: string | number | boolean | null): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function escapeHtml(value: string | number | null): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function groupedItems(items: SupplyItemRow[]): Array<{ category: string; items: SupplyItemRow[] }> {
  const groups = new Map<string, SupplyItemRow[]>();
  for (const item of items) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
  return [...groups.entries()].map(([category, categoryItems]) => ({ category, items: categoryItems }));
}

function packageDescription(item: SupplyItemRow): string {
  const descriptions = item.package_note ? [`Denna lista: ${item.package_note}`] : [];
  if (item.order_package_note) descriptions.push(`Hela lägret: ${item.order_package_note}`);
  return descriptions.join(" · ");
}

export function createSupplyExportDocument(input: SupplyExportInput): SupplyExportDocument {
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const items = input.list.supply_list_items
    .filter((item) => item.source_present)
    .sort((left, right) => left.category.localeCompare(right.category, "sv") || left.item_name.localeCompare(right.item_name, "sv"));
  const syntheticSupplierItemCount = items.filter((item) =>
    item.supplier_order_synthetic_fixture === true
    || input.syntheticSupplierCanonicalKeys?.has(item.canonical_key)
  ).length;
  const syntheticProblem = syntheticSupplierItemCount
    ? `${syntheticSupplierItemCount} ${syntheticSupplierItemCount === 1 ? "rad bygger" : "rader bygger"} på lokala syntetiska testartiklar och får inte användas som beställningsunderlag`
    : null;
  const problems = syntheticProblem
    ? [...input.readiness.problems, syntheticProblem]
    : input.readiness.problems;
  return {
    kind: input.list.kind,
    fileStem: `lagermat-${slug(input.campName)}-${slug(input.list.title)}`,
    title: input.list.title,
    perspective: perspectiveLabel(input.list),
    organizationName: input.organizationName,
    campName: input.campName,
    revisionNumber: input.list.calculation_revisions?.revision_number ?? null,
    deliveryDate: input.list.kind === "delivery" ? input.list.range_start : undefined,
    generatedAt,
    timeZone: input.timeZone,
    draft: !input.readiness.canFinalize || syntheticSupplierItemCount > 0,
    problems,
    items,
    practicalAmounts: input.practicalAmounts,
  };
}

export function createSupplyCsv(document: SupplyExportDocument): string {
  const problemText = document.problems.join(" | ");
  const rows = document.items.map((item) => {
    const required = document.practicalAmounts?.get(item.id)
      ?? practicalSupplyAmount(item.required_amount, item.required_unit);
    return [
      document.perspective,
      document.title,
      document.organizationName,
      document.campName,
      document.revisionNumber ?? "",
      document.generatedAt,
      document.draft ? "UNDERLAG MED VARNINGAR" : "KONTROLLERAT UNDERLAG",
      problemText,
      item.category,
      item.item_name,
      required.amount,
      required.unit,
      rawDecimal(item.required_amount),
      item.required_unit,
      rawDecimal(item.ordered_amount),
      item.ordered_unit ?? "",
      item.package_note ?? "",
      item.order_package_note ?? "",
      item.comment ?? "",
      item.completed ? "ja" : "nej",
    ];
  });
  return `\uFEFF${[csvColumns, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

export function createPrintableSupplyHtml(document: SupplyExportDocument): string {
  const generatedLabel = new Intl.DateTimeFormat("sv-SE", {
    timeZone: document.timeZone,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(document.generatedAt));
  const deliveryDateLabel = document.deliveryDate === undefined
    ? null
    : document.deliveryDate === null
      ? "Leveransdatum saknas"
      : `Leveransdatum: ${new Intl.DateTimeFormat("sv-SE", { timeZone: document.timeZone, dateStyle: "long" }).format(new Date(document.deliveryDate))}`;
  const problems = document.problems.length > 0
    ? `<ul>${document.problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join("")}</ul>`
    : "<p>Inga återstående problem hittades.</p>";
  const practicalAmountNote = document.kind === "distribution"
    ? "<p>Varje matlag får en praktiskt avrundad mängd som går att använda. Förpackningar räknas globalt först när en ICA-artikel väljs och räknas om om varan byts.</p>"
    : document.kind === "delivery"
      ? "<p>Behoven är praktiskt avrundade för varje leverans. Faktiska ICA-förpackningar fördelas globalt utan dubbel avrundning.</p>"
      : "<p>Mängderna är praktiskt avrundade för inköp. Den exakta beräkningen finns kvar separat för spårbarhet och beräkning av valda artiklar.</p>";
  const groups = groupedItems(document.items).map(({ category, items }) => `
    <tbody>
      <tr class="category-row"><th colspan="6">${escapeHtml(category)}</th></tr>
      ${items.map((item) => `
        <tr>
          <td class="check">${item.completed ? "✓" : "□"}</td>
          <td><strong>${escapeHtml(item.item_name)}</strong></td>
          <td>${(() => {
            const required = document.practicalAmounts?.get(item.id)
              ?? practicalSupplyAmount(item.required_amount, item.required_unit);
            return escapeHtml(required.display);
          })()}</td>
          <td>${item.ordered_amount === null ? "-" : escapeHtml(formatCountedAmount(item.ordered_amount, item.ordered_unit ?? ""))}</td>
          <td>${escapeHtml(packageDescription(item)) || "-"}</td>
          <td>${escapeHtml(item.comment) || "-"}</td>
        </tr>`).join("")}
    </tbody>`).join("");

  return `<!doctype html>
<html lang="sv">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(document.title)} - ${escapeHtml(document.campName)}</title>
  <style>
    @page { size: A4 portrait; margin: 17mm 11mm 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #202428; background: #fff; font: 9.5pt/1.35 Arial, sans-serif; }
    .toolbar { position: sticky; top: 0; display: flex; justify-content: flex-end; padding: 10px; background: #eef3f5; border-bottom: 1px solid #ccd4d8; }
    .toolbar button { min-height: 42px; padding: 0 18px; color: #fff; background: #003660; border: 0; border-radius: 4px; font-weight: 700; cursor: pointer; }
    main { max-width: 188mm; margin: 0 auto; padding: 12mm 7mm; }
    header { display: grid; grid-template-columns: 1fr auto; gap: 10mm; align-items: end; margin-bottom: 6mm; padding-bottom: 4mm; border-bottom: 2px solid #003660; }
    .brand { color: #003660; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
    h1 { margin: 2mm 0 0; color: #003660; font-size: 22pt; line-height: 1.05; }
    .meta { margin: 0; text-align: right; font-size: 8.5pt; }
    .meta strong { display: block; }
    .status { margin: 0 0 5mm; padding: 3.5mm 4mm; border: 1px solid #7da76d; background: #eef8ea; }
    .status--draft { border-color: #d89349; background: #fff1df; }
    .status h2 { margin: 0 0 1mm; font-size: 11pt; }
    .status p, .status ul { margin: 1mm 0 0; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th, td { padding: 2.1mm 1.8mm; vertical-align: top; border-bottom: .25mm solid #ccd2d5; overflow-wrap: anywhere; }
    thead th { color: #fff; background: #003660; text-align: left; font-size: 8pt; }
    .category-row th { padding-top: 3mm; color: #003660; background: #edf2f4; border-top: .4mm solid #9aaab2; font-size: 10pt; text-align: left; }
    .check { width: 12mm; color: #27651b; font-size: 13pt; text-align: center; }
    th:nth-child(1) { width: 12mm; }
    th:nth-child(2) { width: 36mm; }
    th:nth-child(3), th:nth-child(4) { width: 27mm; }
    th:nth-child(5) { width: 34mm; }
    footer { margin-top: 5mm; padding-top: 3mm; color: #586167; border-top: .25mm solid #aeb7bb; font-size: 8pt; }
    @media print {
      .toolbar { display: none; }
      main { max-width: none; margin: 0; padding: 0; }
      a { color: inherit; text-decoration: none; }
    }
  </style>
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">Skriv ut / spara som PDF</button></div>
  <main>
    <header>
      <div><div class="brand">Lägermat</div><h1>${escapeHtml(document.title)}</h1></div>
      <p class="meta"><strong>${escapeHtml(document.organizationName)}</strong>${escapeHtml(document.campName)}<br>Perspektiv: ${escapeHtml(document.perspective)}${deliveryDateLabel ? `<br>${escapeHtml(deliveryDateLabel)}` : ""}<br>Skapad: ${escapeHtml(generatedLabel)}</p>
    </header>
    <section class="status${document.draft ? " status--draft" : ""}">
      <h2>${document.draft ? "UNDERLAG MED VARNINGAR – kontrollera före användning" : "Kontrollerat planeringsunderlag"}</h2>
      ${problems}
      ${practicalAmountNote}
    </section>
    <table>
      <thead><tr><th scope="col">Klar</th><th scope="col">Vara</th><th scope="col">Beräknat behov</th><th scope="col">Beställt</th><th scope="col">Förpackning</th><th scope="col">Kommentar</th></tr></thead>
      ${groups}
    </table>
    <footer>Skapat lokalt av Lägermat. Kontrollera varningar och beställda mängder före användning.</footer>
  </main>
</body>
</html>`;
}
