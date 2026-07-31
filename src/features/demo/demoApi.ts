import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import type {
  DemoInstance,
  DemoRemoteStatus
} from "./demoSessionCoordinator";

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 64
    && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

export function parseDemoInstance(value: unknown): DemoInstance {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Demot gav ett ogiltigt svar.");
  }
  const row = value as Record<string, unknown>;
  if (
    !isUuid(row.organizationId)
    || !isUuid(row.campId)
    || !isIsoTimestamp(row.expiresAt)
    || !Number.isInteger(row.templateVersion)
    || Number(row.templateVersion) <= 0
    || typeof row.reused !== "boolean"
  ) {
    throw new Error("Demot gav ett ogiltigt svar.");
  }

  return {
    organizationId: row.organizationId,
    campId: row.campId,
    expiresAt: row.expiresAt,
    templateVersion: Number(row.templateVersion),
    reused: row.reused
  };
}

interface DemoStatusRow {
  state: string;
  expires_at: string | null;
  organization_id: string | null;
  camp_id: string | null;
}

export function parseDemoRemoteStatus(value: unknown): DemoRemoteStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Demosessionens status kunde inte läsas.");
  }
  const row = value as DemoStatusRow;

  if (row.state === "active") {
    if (
      !isUuid(row.organization_id)
      || !isUuid(row.camp_id)
      || !isIsoTimestamp(row.expires_at)
    ) {
      throw new Error("Demosessionens aktiva status är ofullständig.");
    }
    return {
      state: "active",
      instance: {
        organizationId: row.organization_id,
        campId: row.camp_id,
        expiresAt: row.expires_at,
        templateVersion: null,
        reused: true
      }
    };
  }
  if (row.state === "expired") {
    if (!isIsoTimestamp(row.expires_at)) {
      throw new Error("Demosessionens utgångstid saknas.");
    }
    return { state: "expired", expiresAt: row.expires_at };
  }
  if (row.state === "missing" || row.state === "not_demo") {
    return { state: row.state };
  }
  throw new Error("Demosessionens status är okänd.");
}

export async function readDemoSessionStatus(
  client: SupabaseClient<Database>
): Promise<DemoRemoteStatus> {
  const { data, error } = await client
    .rpc("get_demo_session_status")
    .maybeSingle();
  if (error) throw new Error("Demosessionens status kunde inte läsas.");
  return parseDemoRemoteStatus(data);
}

export async function provisionDemoInstance(
  client: SupabaseClient<Database>,
  action: "start" | "reset",
  turnstileToken: string
): Promise<DemoInstance> {
  const { data, error } = await client.functions.invoke("start-demo", {
    body: { action, turnstileToken }
  });
  if (error) {
    throw new Error(
      action === "reset"
        ? "Demot kunde inte återställas just nu."
        : "Demot kunde inte förberedas just nu."
    );
  }
  return parseDemoInstance(data);
}
