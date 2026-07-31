import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../types/database";
import {
  parseDemoInstance,
  parseDemoRemoteStatus,
  provisionDemoInstance,
  readDemoSessionStatus
} from "./demoApi";

const organizationId = "10000000-0000-4000-8000-000000000001";
const campId = "20000000-0000-4000-8000-000000000002";
const expiresAt = "2026-08-01T12:30:00.000Z";

function client(value: {
  statusData?: unknown;
  statusError?: unknown;
  functionData?: unknown;
  functionError?: unknown;
}) {
  const maybeSingle = vi.fn(async () => ({
    data: value.statusData ?? null,
    error: value.statusError ?? null
  }));
  const rpc = vi.fn(() => ({ maybeSingle }));
  const invoke = vi.fn(async () => ({
    data: value.functionData ?? null,
    error: value.functionError ?? null
  }));

  return {
    client: {
      rpc,
      functions: { invoke }
    } as unknown as SupabaseClient<Database>,
    invoke,
    maybeSingle,
    rpc
  };
}

describe("demoApi", () => {
  it("accepterar endast ett komplett och typat provisionssvar", () => {
    expect(parseDemoInstance({
      organizationId,
      campId,
      expiresAt,
      templateVersion: 1,
      reused: false
    })).toEqual({
      organizationId,
      campId,
      expiresAt,
      templateVersion: 1,
      reused: false
    });

    expect(() => parseDemoInstance({
      organizationId,
      campId,
      expiresAt,
      templateVersion: 0,
      reused: false
    })).toThrow("Demot gav ett ogiltigt svar.");
  });

  it("tolkar aktiva, utgångna och tomma statussvar", () => {
    expect(parseDemoRemoteStatus({
      state: "active",
      organization_id: organizationId,
      camp_id: campId,
      expires_at: expiresAt
    })).toEqual({
      state: "active",
      instance: {
        organizationId,
        campId,
        expiresAt,
        templateVersion: null,
        reused: true
      }
    });
    expect(parseDemoRemoteStatus({
      state: "expired",
      organization_id: organizationId,
      camp_id: campId,
      expires_at: expiresAt
    })).toEqual({ state: "expired", expiresAt });
    expect(parseDemoRemoteStatus({ state: "missing" })).toEqual({
      state: "missing"
    });
    expect(parseDemoRemoteStatus({ state: "not_demo" })).toEqual({
      state: "not_demo"
    });
    expect(() => parseDemoRemoteStatus({ state: "surprise" }))
      .toThrow("Demosessionens status är okänd.");
  });

  it("läser status genom den avgränsade RPC:n", async () => {
    const testClient = client({
      statusData: {
        state: "active",
        organization_id: organizationId,
        camp_id: campId,
        expires_at: expiresAt
      }
    });

    await expect(readDemoSessionStatus(testClient.client)).resolves.toMatchObject({
      state: "active"
    });
    expect(testClient.rpc).toHaveBeenCalledWith("get_demo_session_status");
    expect(testClient.maybeSingle).toHaveBeenCalledOnce();
  });

  it("skickar bara åtgärd och engångstoken till serverfunktionen", async () => {
    const response = {
      organizationId,
      campId,
      expiresAt,
      templateVersion: 1,
      reused: true
    };
    const testClient = client({ functionData: response });

    await expect(
      provisionDemoInstance(testClient.client, "reset", "single-use-token")
    ).resolves.toEqual(response);
    expect(testClient.invoke).toHaveBeenCalledWith("start-demo", {
      body: {
        action: "reset",
        turnstileToken: "single-use-token"
      }
    });
  });

  it("översätter transportfel utan att läcka serverdetaljer", async () => {
    const testClient = client({
      functionError: new Error("internal provider detail")
    });

    await expect(
      provisionDemoInstance(testClient.client, "start", "single-use-token")
    ).rejects.toThrow("Demot kunde inte förberedas just nu.");
  });
});
