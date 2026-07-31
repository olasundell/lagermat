import type {
  ScoutnetReconciliationChangeField
} from "./scoutnetApi";

function readableAttendanceDateTime(
  value: string,
  timeZone: string
): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone
  }).format(parsed);
}

function humanAttendanceValue(value: string, timeZone: string): string {
  return value.split("|").map((interval) => {
    const separator = interval.indexOf("/");
    if (separator < 1 || separator === interval.length - 1) return interval;
    const start = interval.slice(0, separator);
    const end = interval.slice(separator + 1);
    return `${readableAttendanceDateTime(start, timeZone)} – ${
      readableAttendanceDateTime(end, timeZone)
    }`;
  }).join("; ");
}

export function humanChangeValue(
  field: ScoutnetReconciliationChangeField,
  value: string | null,
  timeZone = "Europe/Stockholm"
): string {
  if (!value) return "Saknas";
  if (field === "attendance") return humanAttendanceValue(value, timeZone);
  return value.replace(/\s+\[scoutnet:v1:[A-Za-z0-9_-]{43}\]$/u, "");
}
