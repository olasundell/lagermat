export function userFacingError(error: unknown, fallback: string): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
      ? error.message
      : "";

  if (/failed to fetch|networkerror|load failed|fetch failed|connection refused/i.test(message)) {
    return "Databasen svarar inte. Kontrollera anslutningen och försök igen.";
  }
  if (/conflict|row version|has changed|version mismatch/i.test(message)) {
    return "Uppgiften har ändrats sedan sidan öppnades. Ladda om sidan och försök igen.";
  }
  if (/not configured|saknar.*konfiguration/i.test(message)) {
    return "Databasen är inte konfigurerad.";
  }
  if (/current calculation revision is required/i.test(message)) {
    return "Räkna ut mängderna i Matsedel innan du skapar inköpslistor.";
  }
  if (/camp readiness must be complete before final status/i.test(message)) {
    return "Lägret kan inte slutmarkeras ännu. Lös problemen som visas i Matsedel och försök igen.";
  }

  return fallback;
}
