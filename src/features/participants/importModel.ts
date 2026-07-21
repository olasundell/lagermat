export type ImportField =
  | "display_name"
  | "division"
  | "patrol"
  | "meal_group"
  | "registered"
  | "attendance_days"
  | "attendance_start"
  | "attendance_end"
  | "food_factor"
  | "diet_flag"
  | "diet_note";

export interface ColumnMapping {
  index: number;
  source: string;
  target: ImportField | "ignore";
}

export interface ImportTable {
  filename: string;
  sourceKind: "xlsx" | "csv";
  sheetName: string;
  headerRowIndex: number;
  headers: string[];
  rows: unknown[][];
  rowNumbers: number[];
}

export interface ImportIssue {
  severity: "error" | "warning";
  message: string;
}

export interface PreviewRow {
  id: string;
  sourceRow: number;
  included: boolean;
  displayName: string;
  division: string;
  patrol: string;
  mealGroup: string;
  foodFactor: string;
  attendanceStart: string;
  attendanceEnd: string;
  dietaryNote: string;
  issues: ImportIssue[];
}

export interface CampPeriod {
  startsOn: string;
  endsOn: string;
}

export interface SanitizedImportRow {
  source_row: number;
  display_name: string;
  division: string | null;
  patrol: string | null;
  meal_group: string | null;
  food_factor: number;
  attendance_start: string;
  attendance_end: string;
  dietary_note: string | null;
}

export const importFieldLabels: Record<ImportField | "ignore", string> = {
  ignore: "Ta inte med",
  display_name: "Namn",
  division: "Avdelning",
  patrol: "Patrull",
  meal_group: "Matlag",
  registered: "Anmäld (ja/nej)",
  attendance_days: "Dagar / närvaro",
  attendance_start: "Ankomst",
  attendance_end: "Avresa",
  food_factor: "Portionsstorlek",
  diet_flag: "Specialkost (ja/nej)",
  diet_note: "Specialkost (text)"
};

const importFields = Object.keys(importFieldLabels) as Array<ImportField | "ignore">;

function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isDiscardedByDesign(header: string): boolean {
  const value = normalized(header);
  return [
    "personnummer",
    "fodelsedatum",
    "halsodeklaration",
    "e-post",
    "email",
    "telefon",
    "adress",
    "postort",
    "postnummer",
    "kon",
    "registerutdrag",
    "trygga moten",
    "betal",
    "skuld",
    "malsman"
  ].some((fragment) => value.includes(fragment));
}

export function suggestField(header: string): ImportField | "ignore" {
  const value = normalized(header);
  if (!value || isDiscardedByDesign(header)) return "ignore";

  if (value === "namn") return "display_name";
  if (value === "anmald") return "registered";
  if (value === "avdelning" || value === "generellt - avdelning") return "division";
  if (["patrull", "patruller", "generellt - patrull"].includes(value)) return "patrol";
  if (["matgrupp", "mat grupp", "maltidsgrupp", "maltids grupp"].includes(value)) return "meal_group";
  if (["matfaktor", "mat faktor", "portionsstorlek", "portionsstorlek i procent"].includes(value)) return "food_factor";
  if (["dagar", "generellt - dagar", "narvaro", "narvarodagar"].includes(value)) return "attendance_days";
  if (value.includes("ankomst") && !value.includes("datum")) return "attendance_start";
  if ((value.includes("avgar") || value.includes("avresa")) && !value.includes("datum")) return "attendance_end";
  if (value.includes("specialkost") && /(har du|ja\/nej|specialkost\?)/.test(value)) return "diet_flag";
  if (value.includes("specialkost") || value === "merge specialkost") return "diet_note";
  return "ignore";
}

function scoreHeaderRow(row: unknown[]): number {
  const targets = new Set(row.map((cell) => suggestField(String(cell ?? ""))).filter((field) => field !== "ignore"));
  const rawScoutnetBonus = row.some((cell) => normalized(cell).startsWith("generellt -")) ? 5 : 0;
  const registrationBonus = targets.has("registered") ? 3 : 0;
  return targets.size + rawScoutnetBonus + registrationBonus;
}

function findHeaderRow(rows: unknown[][]): { index: number; score: number } {
  let best = { index: 0, score: -1 };
  rows.slice(0, 30).forEach((row, index) => {
    const score = scoreHeaderRow(row);
    if (score > best.score) best = { index, score };
  });
  return best;
}

export function detectImportTable(
  filename: string,
  sheets: Array<{ name: string; rows: unknown[][] }>
): ImportTable {
  if (sheets.length === 0) throw new Error("Filen innehåller inga läsbara blad.");

  const candidates = sheets.map((sheet) => {
    const header = findHeaderRow(sheet.rows);
    const sheetBonus = /import|scoutnet/i.test(sheet.name) ? 20 : 0;
    return { sheet, header, total: header.score + sheetBonus };
  });
  candidates.sort((left, right) => right.total - left.total);
  const selected = candidates[0];
  if (!selected || selected.header.score < 2) {
    throw new Error("Hittade ingen rubrikrad med namn och Scoutnet-fält.");
  }

  const headerCells = selected.sheet.rows[selected.header.index] ?? [];
  const headers = headerCells.map((cell, index) => String(cell ?? "").trim() || `Kolumn ${index + 1}`);
  const dataRowsWithNumbers = selected.sheet.rows
    .slice(selected.header.index + 1)
    .map((row, index) => ({ row, rowNumber: selected.header.index + index + 2 }))
    .filter(({ row }) => row.some((cell) => normalized(cell) !== ""))
    .filter(({ row }) => scoreHeaderRow(row) < Math.max(2, selected.header.score * 0.75));

  return {
    filename,
    sourceKind: filename.toLowerCase().endsWith(".csv") ? "csv" : "xlsx",
    sheetName: selected.sheet.name,
    headerRowIndex: selected.header.index,
    headers,
    rows: dataRowsWithNumbers.map(({ row }) => row),
    rowNumbers: dataRowsWithNumbers.map(({ rowNumber }) => rowNumber)
  };
}

export async function readImportFile(file: File): Promise<ImportTable> {
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
    throw new Error("Välj en XLSX-, XLS- eller CSV-fil.");
  }
  const { read, utils } = await import("xlsx");
  const sourceKind = file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
  const fileBytes = await file.arrayBuffer();
  const workbook = sourceKind === "csv"
    ? read(new TextDecoder("utf-8").decode(fileBytes), { type: "string", raw: true })
    : read(fileBytes, { type: "array", raw: false });
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    rows: utils.sheet_to_json<unknown[]>(workbook.Sheets[name]!, {
      header: 1,
      defval: "",
      raw: sourceKind === "csv",
      dateNF: "yyyy-mm-dd"
    })
  }));
  return detectImportTable(file.name, sheets);
}

export function suggestedMapping(table: ImportTable): ColumnMapping[] {
  return table.headers.map((source, index) => ({ index, source, target: suggestField(source) }));
}

function valuesFor(row: unknown[], mapping: ColumnMapping[], field: ImportField): string[] {
  return mapping
    .filter((column) => column.target === field)
    .map((column) => String(row[column.index] ?? "").trim())
    .filter((value) => value !== "" && value !== "-");
}

function firstValue(row: unknown[], mapping: ColumnMapping[], field: ImportField): string {
  return valuesFor(row, mapping, field)[0] ?? "";
}

function addUtcDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString();
}

function parseAttendanceDays(value: string): string[] {
  return [...new Set(value.match(/\d{4}-\d{2}-\d{2}/g) ?? [])].sort();
}

function toIsoDateTime(value: string, fallback: string): string {
  if (!value) return fallback;
  const directDate = value.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  if (directDate) return `${directDate}T00:00:00.000Z`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function registeredByValue(value: string): boolean | null {
  const answer = normalized(value);
  if (!answer) return null;
  if (["nej", "no", "false", "0", "avanmald", "avregistrerad"].includes(answer)) return false;
  if (["ja", "yes", "true", "1", "anmald", "aktiv"].includes(answer)) return true;
  return null;
}

function editableErrors(row: Pick<PreviewRow, "displayName" | "division" | "patrol" | "mealGroup" | "foodFactor" | "attendanceStart" | "attendanceEnd">): ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (!row.displayName) issues.push({ severity: "error", message: "Namn saknas." });
  if (row.displayName.length > 160) issues.push({ severity: "error", message: "Namnet är längre än 160 tecken." });
  for (const [label, value] of [["Avdelning", row.division], ["Patrull", row.patrol], ["Matlag", row.mealGroup]] as const) {
    if (value.length > 120) issues.push({ severity: "error", message: `${label} är längre än 120 tecken.` });
  }
  const factor = Number(row.foodFactor);
  if (!Number.isFinite(factor) || factor <= 0 || factor > 10) {
    issues.push({ severity: "error", message: "Portionsstorleken måste vara större än 0 och högst 10 normalportioner." });
  }
  if (!row.attendanceStart || !row.attendanceEnd || Date.parse(row.attendanceEnd) <= Date.parse(row.attendanceStart)) {
    issues.push({ severity: "error", message: "Närvaroperioden är ogiltig." });
  }
  return issues;
}

export function revalidatePreviewRow(row: PreviewRow): PreviewRow {
  return {
    ...row,
    issues: [
      ...row.issues.filter((issue) => issue.severity === "warning"),
      ...editableErrors(row)
    ]
  };
}

export function buildPreviewRows(
  table: ImportTable,
  mapping: ColumnMapping[],
  camp: CampPeriod
): PreviewRow[] {
  const defaultStart = `${camp.startsOn}T00:00:00.000Z`;
  const defaultEnd = addUtcDays(camp.endsOn, 1);

  return table.rows.map((row, rowIndex) => {
    const sourceRow = table.rowNumbers[rowIndex] ?? table.headerRowIndex + rowIndex + 2;
    const displayName = firstValue(row, mapping, "display_name");
    const days = parseAttendanceDays(valuesFor(row, mapping, "attendance_days").join(", "));
    const attendanceStart = toIsoDateTime(
      firstValue(row, mapping, "attendance_start"),
      days[0] ? `${days[0]}T00:00:00.000Z` : defaultStart
    );
    const attendanceEnd = toIsoDateTime(
      firstValue(row, mapping, "attendance_end"),
      days.length > 0 ? addUtcDays(days.at(-1)!, 1) : defaultEnd
    );
    const foodFactor = firstValue(row, mapping, "food_factor").replace(",", ".") || "1";
    const registered = registeredByValue(firstValue(row, mapping, "registered"));
    const dietRequested = registeredByValue(firstValue(row, mapping, "diet_flag"));
    const dietaryParts = [...new Set(valuesFor(row, mapping, "diet_note"))];
    const dietaryNote = dietaryParts.join(" · ");
    const issues: ImportIssue[] = [];

    if (registered === false) issues.push({ severity: "warning", message: "Raden är inte anmäld och är därför bortvald." });
    if (dietRequested === true && !dietaryNote) {
      issues.push({ severity: "warning", message: "Specialkost är markerad men en beskrivning saknas." });
    }

    const previewRow: PreviewRow = {
      id: `source-row-${sourceRow}`,
      sourceRow,
      included: registered !== false && Boolean(displayName),
      displayName,
      division: firstValue(row, mapping, "division"),
      patrol: firstValue(row, mapping, "patrol"),
      mealGroup: firstValue(row, mapping, "meal_group"),
      foodFactor,
      attendanceStart,
      attendanceEnd,
      dietaryNote,
      issues
    };
    return revalidatePreviewRow(previewRow);
  });
}

export function sanitizedRows(rows: PreviewRow[]): SanitizedImportRow[] {
  return rows
    .filter((row) => row.included && !row.issues.some((issue) => issue.severity === "error"))
    .map((row) => ({
      source_row: row.sourceRow,
      display_name: row.displayName.trim(),
      division: row.division.trim() || null,
      patrol: row.patrol.trim() || null,
      meal_group: row.mealGroup.trim() || null,
      food_factor: Number(row.foodFactor),
      attendance_start: row.attendanceStart,
      attendance_end: row.attendanceEnd,
      dietary_note: row.dietaryNote.trim() || null
    }));
}

export function isImportField(value: string): value is ImportField | "ignore" {
  return importFields.includes(value as ImportField | "ignore");
}

export function discardedColumns(mapping: ColumnMapping[]): string[] {
  return mapping.filter((column) => column.target === "ignore").map((column) => column.source);
}
