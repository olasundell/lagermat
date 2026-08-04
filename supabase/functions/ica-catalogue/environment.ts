export interface EdgeEnvironmentReader {
  get(variableName: string): string | undefined;
}

export function isIcaCatalogueDemoEnabled(
  environment: EdgeEnvironmentReader,
): boolean {
  return environment.get("DEMO_MODE") === "true";
}
