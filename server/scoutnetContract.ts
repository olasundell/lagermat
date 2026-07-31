import type { operations } from "@scouterna/scoutnet";

export const SCOUTNET_CLIENT_VERSION = "0.3.26";
export const SCOUTNET_OPENAPI_VERSION = "0.4.1";
export const SCOUTNET_API_ORIGIN = "https://scoutnet.se";
export const SCOUTNET_API_BASE_URL = `${SCOUTNET_API_ORIGIN}/api`;
export const SCOUTNET_PARTICIPANTS_PATH = "/project/get/participants";
export const SCOUTNET_QUESTIONS_PATH = "/project/get/questions";

export type ScoutnetParticipantsResponse =
  operations["getProjectParticipants"]["responses"][200]["content"]["application/json"];
export type ScoutnetQuestionsResponse =
  operations["getProjectFormts"]["responses"][200]["content"]["application/json"];

export class ScoutnetContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoutnetContractError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Scoutnet serialises empty PHP maps inconsistently. The official client
 * documents that an empty object can arrive as an empty array, and the
 * participants schema additionally permits null. Treat only those empty
 * representations as equivalent; a populated array is a contract violation.
 */
export function normaliseScoutnetMap(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (Array.isArray(value)) {
    if (value.length === 0) return {};
    throw new ScoutnetContractError(
      `${field} must be an object, an empty array or null`,
    );
  }
  if (!isRecord(value)) {
    throw new ScoutnetContractError(
      `${field} must be an object, an empty array or null`,
    );
  }
  return value;
}

export function readRequiredScoutnetMap(
  body: unknown,
  field: string,
): Record<string, unknown> {
  if (!isRecord(body) || !Object.hasOwn(body, field)) {
    throw new ScoutnetContractError(
      `Scoutnet response is missing the required ${field} field`,
    );
  }
  return normaliseScoutnetMap(body[field], field);
}

export function parseScoutnetJson(rawBody: string): unknown {
  if (!rawBody.trim()) {
    throw new ScoutnetContractError("Scoutnet returned an empty response body");
  }
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new ScoutnetContractError("Scoutnet returned malformed JSON");
  }
}
