import { describe, expect, it, vi } from "vitest";
import {
  createStartDemoHandler,
  createTurnstileValidator,
  START_DEMO_TURNSTILE_ACTION,
  TurnstileUnavailableError,
  type AuthenticatedDemoUser,
  type DemoProvisionResult,
  type StartDemoEnvironment,
  type StartDemoHandlerDependencies,
  type TurnstileVerification,
} from "../supabase/functions/start-demo/handler.ts";

const appOrigin = "http://127.0.0.1:5174";
const userId = "d0000000-0000-0000-0000-000000000001";
const organizationId = "4b111111-1111-4111-8111-111111111111";
const campId = "4b222222-2222-4222-8222-222222222222";
const idempotencyKey = "4b333333-3333-4333-8333-333333333333";
const accessToken = "header.payload.signature";

const validUser: AuthenticatedDemoUser = {
  id: userId,
  isAnonymous: true,
};
const validTurnstile: TurnstileVerification = {
  success: true,
  action: START_DEMO_TURNSTILE_ACTION,
  hostname: "127.0.0.1",
  errorCodes: [],
  testingKey: false,
};
const validProvision: DemoProvisionResult = {
  organizationId,
  campId,
  expiresAt: "2026-07-31T18:00:00.000Z",
  templateVersion: 1,
  reused: false,
};

interface RequestOptions {
  method?: string;
  origin?: string | null;
  authorization?: string | null;
  contentType?: string | null;
  body?: unknown;
  rawBody?: string;
  headers?: HeadersInit;
}

function demoRequest(options: RequestOptions = {}): Request {
  const method = options.method ?? "POST";
  const headers = new Headers(options.headers);
  if (options.origin !== null) {
    headers.set("Origin", options.origin ?? appOrigin);
  }
  if (options.authorization !== null) {
    headers.set(
      "Authorization",
      options.authorization ?? `Bearer ${accessToken}`,
    );
  }
  if (options.contentType !== null) {
    headers.set("Content-Type", options.contentType ?? "application/json");
  }

  const mayHaveBody = method !== "GET" && method !== "HEAD";
  const body = mayHaveBody
    ? options.rawBody
      ?? JSON.stringify(options.body ?? {
        action: "start",
        turnstileToken: "turnstile-once",
      })
    : undefined;
  return new Request(`${appOrigin}/functions/v1/start-demo`, {
    method,
    headers,
    body,
  });
}

function subject(
  overrides: Partial<StartDemoHandlerDependencies> & {
    environment?: StartDemoEnvironment;
  } = {},
) {
  const environment = overrides.environment ?? {
    appOrigin,
    demoMode: "true",
    turnstileSecretKey: "turnstile-secret",
  };
  const authenticate = overrides.authenticate
    ?? vi.fn(async () => validUser);
  const verifyTurnstile = overrides.verifyTurnstile
    ?? vi.fn(async () => validTurnstile);
  const provision = overrides.provision
    ?? vi.fn(async () => validProvision);
  const handler = createStartDemoHandler({
    getEnvironment: overrides.getEnvironment ?? (() => environment),
    authenticate,
    verifyTurnstile,
    provision,
    randomUUID: overrides.randomUUID ?? (() => idempotencyKey),
  });
  return { handler, authenticate, verifyTurnstile, provision };
}

async function responseErrorCode(response: Response): Promise<string> {
  const body = await response.json() as { error: { code: string } };
  return body.error.code;
}

describe("start-demo transport boundary", () => {
  it("is unavailable when the server-side environment gate is off", async () => {
    const startDemo = subject({
      environment: {
        appOrigin,
        demoMode: "false",
        turnstileSecretKey: undefined,
      },
    });

    const response = await startDemo.handler(demoRequest());

    expect(response.status).toBe(404);
    await expect(responseErrorCode(response)).resolves.toBe("demo_disabled");
    expect(startDemo.authenticate).not.toHaveBeenCalled();
    expect(startDemo.verifyTurnstile).not.toHaveBeenCalled();
    expect(startDemo.provision).not.toHaveBeenCalled();
  });

  it("fails closed before invoking dependencies when configuration is missing", async () => {
    const startDemo = subject({
      environment: {
        appOrigin,
        demoMode: "true",
        turnstileSecretKey: undefined,
      },
    });

    const response = await startDemo.handler(demoRequest());

    expect(response.status).toBe(500);
    await expect(responseErrorCode(response)).resolves.toBe(
      "server_misconfigured",
    );
    expect(startDemo.authenticate).not.toHaveBeenCalled();
    expect(startDemo.verifyTurnstile).not.toHaveBeenCalled();
    expect(startDemo.provision).not.toHaveBeenCalled();
  });

  it("accepts only the configured raw Origin and never emits a wildcard", async () => {
    const startDemo = subject();

    const missing = await startDemo.handler(demoRequest({ origin: null }));
    const wrong = await startDemo.handler(
      demoRequest({ origin: "https://attacker.invalid" }),
    );

    expect(missing.status).toBe(403);
    expect(wrong.status).toBe(403);
    expect(missing.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(wrong.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(wrong.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    expect(startDemo.authenticate).not.toHaveBeenCalled();
  });

  it("answers an allowed preflight without authenticating", async () => {
    const startDemo = subject();

    const response = await startDemo.handler(
      demoRequest({ method: "OPTIONS", authorization: null, contentType: null }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(appOrigin);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "POST, OPTIONS",
    );
    expect(startDemo.authenticate).not.toHaveBeenCalled();
  });

  it("rejects methods other than POST and OPTIONS", async () => {
    const startDemo = subject();

    const response = await startDemo.handler(demoRequest({ method: "GET" }));

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
    await expect(responseErrorCode(response)).resolves.toBe(
      "method_not_allowed",
    );
  });

  it.each([
    null,
    "Basic credentials",
    "Bearer",
    "Bearer token with spaces",
    `Bearer ${"a".repeat(8_193)}`,
  ])("rejects a missing or malformed bearer credential: %s", async (authorization) => {
    const startDemo = subject();

    const response = await startDemo.handler(demoRequest({ authorization }));

    expect(response.status).toBe(401);
    await expect(responseErrorCode(response)).resolves.toBe(
      "authentication_required",
    );
    expect(startDemo.authenticate).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "non-JSON content type",
      options: { contentType: "text/plain" },
    },
    {
      label: "malformed JSON",
      options: { rawBody: "{" },
    },
    {
      label: "array body",
      options: { body: [] },
    },
    {
      label: "client-selected organization",
      options: {
        body: {
          action: "start",
          turnstileToken: "once",
          organizationId,
        },
      },
    },
    {
      label: "client-selected user",
      options: {
        body: { action: "start", turnstileToken: "once", userId },
      },
    },
    {
      label: "unknown action",
      options: { body: { action: "replace", turnstileToken: "once" } },
    },
    {
      label: "empty token",
      options: { body: { action: "start", turnstileToken: "" } },
    },
    {
      label: "oversized token",
      options: {
        body: { action: "start", turnstileToken: "x".repeat(2_049) },
      },
    },
  ])("rejects $label before authentication or provisioning", async ({ options }) => {
    const startDemo = subject();

    const response = await startDemo.handler(demoRequest(options));

    expect(response.status).toBe(400);
    await expect(responseErrorCode(response)).resolves.toBe("invalid_request");
    expect(startDemo.authenticate).not.toHaveBeenCalled();
    expect(startDemo.provision).not.toHaveBeenCalled();
  });

  it("bounds the streamed request body even without Content-Length", async () => {
    const startDemo = subject();

    const response = await startDemo.handler(
      demoRequest({ rawBody: "x".repeat(4_097) }),
    );

    expect(response.status).toBe(400);
    expect(startDemo.authenticate).not.toHaveBeenCalled();
  });
});

describe("start-demo identity and Turnstile checks", () => {
  it("rejects an unknown persisted Auth user", async () => {
    const startDemo = subject({ authenticate: vi.fn(async () => null) });

    const response = await startDemo.handler(demoRequest());

    expect(response.status).toBe(401);
    expect(startDemo.verifyTurnstile).not.toHaveBeenCalled();
    expect(startDemo.provision).not.toHaveBeenCalled();
  });

  it("reports Auth outages as retryable without claiming the token is invalid", async () => {
    const startDemo = subject({
      authenticate: vi.fn(async () => {
        throw new Error("Auth unavailable");
      }),
    });

    const response = await startDemo.handler(demoRequest());
    const body = await response.json() as {
      error: { code: string; retryable: boolean };
    };

    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      code: "authentication_unavailable",
      message: "Sessionen kunde inte verifieras just nu.",
      retryable: true,
    });
  });

  it("rejects a normal user even if client metadata could claim demo status", async () => {
    const startDemo = subject({
      authenticate: vi.fn(async () => ({ id: userId, isAnonymous: false })),
    });

    const response = await startDemo.handler(demoRequest());

    expect(response.status).toBe(403);
    await expect(responseErrorCode(response)).resolves.toBe(
      "anonymous_session_required",
    );
    expect(startDemo.verifyTurnstile).not.toHaveBeenCalled();
    expect(startDemo.provision).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "failed verification",
      result: { ...validTurnstile, success: false },
    },
    {
      label: "wrong widget action",
      result: { ...validTurnstile, action: "anonymous-sign-in" },
    },
    {
      label: "wrong hostname",
      result: { ...validTurnstile, hostname: "attacker.invalid" },
    },
  ])("rejects Turnstile when $label", async ({ result }) => {
    const startDemo = subject({
      verifyTurnstile: vi.fn(async () => result),
    });

    const response = await startDemo.handler(demoRequest());

    expect(response.status).toBe(403);
    await expect(responseErrorCode(response)).resolves.toBe(
      "turnstile_rejected",
    );
    expect(startDemo.provision).not.toHaveBeenCalled();
  });

  it("accepts Cloudflare's published always-pass response only on loopback", async () => {
    const startDemo = subject({
      environment: {
        appOrigin,
        demoMode: "true",
        turnstileSecretKey: "1x0000000000000000000000000000000AA",
      },
      verifyTurnstile: vi.fn(async () => ({
        success: true,
        action: null,
        hostname: "example.com",
        errorCodes: [],
        testingKey: true,
      })),
    });

    const response = await startDemo.handler(demoRequest());

    expect(response.status).toBe(200);
    expect(startDemo.provision).toHaveBeenCalledOnce();
  });

  it("does not accept the testing-key response for a hosted origin", async () => {
    const hostedOrigin = "https://demo.example.se";
    const startDemo = subject({
      environment: {
        appOrigin: hostedOrigin,
        demoMode: "true",
        turnstileSecretKey: "1x0000000000000000000000000000000AA",
      },
      verifyTurnstile: vi.fn(async () => ({
        success: true,
        action: null,
        hostname: "example.com",
        errorCodes: [],
        testingKey: true,
      })),
    });

    const response = await startDemo.handler(demoRequest({
      origin: hostedOrigin,
    }));

    expect(response.status).toBe(403);
    expect(startDemo.provision).not.toHaveBeenCalled();
  });

  it("reports Turnstile transport failure as retryable", async () => {
    const startDemo = subject({
      verifyTurnstile: vi.fn(async () => {
        throw new TurnstileUnavailableError();
      }),
    });

    const response = await startDemo.handler(demoRequest());
    const body = await response.json() as {
      error: { code: string; retryable: boolean };
    };

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("turnstile_unavailable");
    expect(body.error.retryable).toBe(true);
    expect(startDemo.provision).not.toHaveBeenCalled();
  });
});

describe("start-demo provisioning contract", () => {
  it("derives the user from Auth and provisions an idempotent start", async () => {
    const randomUUID = vi.fn(() => idempotencyKey);
    const startDemo = subject({ randomUUID });

    const response = await startDemo.handler(
      demoRequest({ headers: { "CF-Connecting-IP": "192.0.2.10" } }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(appOrigin);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(validProvision);
    expect(startDemo.authenticate).toHaveBeenCalledWith(accessToken);
    expect(startDemo.verifyTurnstile).toHaveBeenCalledWith({
      token: "turnstile-once",
      remoteIp: "192.0.2.10",
      idempotencyKey,
    });
    expect(startDemo.provision).toHaveBeenCalledWith({
      userId,
      reset: false,
    });
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("maps reset to the same server-derived user without accepting IDs", async () => {
    const startDemo = subject();

    const response = await startDemo.handler(
      demoRequest({
        body: { action: "reset", turnstileToken: "turnstile-once" },
      }),
    );

    expect(response.status).toBe(200);
    expect(startDemo.provision).toHaveBeenCalledWith({
      userId,
      reset: true,
    });
  });

  it("returns only the bounded public contract", async () => {
    const startDemo = subject({
      provision: vi.fn(async () => ({
        ...validProvision,
        reused: true,
        userId: "must-not-leak",
        templateDigest: "must-not-leak",
      } as DemoProvisionResult)),
    });

    const response = await startDemo.handler(demoRequest());

    await expect(response.json()).resolves.toEqual({
      organizationId,
      campId,
      expiresAt: validProvision.expiresAt,
      templateVersion: 1,
      reused: true,
    });
  });

  it("does not expose database errors", async () => {
    const startDemo = subject({
      provision: vi.fn(async () => {
        throw new Error("secret database detail");
      }),
    });

    const response = await startDemo.handler(demoRequest());
    const source = await response.text();

    expect(response.status).toBe(503);
    expect(source).toContain("provisioning_unavailable");
    expect(source).not.toContain("secret database detail");
  });

  it.each([
    { ...validProvision, organizationId: "not-a-uuid" },
    { ...validProvision, expiresAt: "tomorrow" },
    { ...validProvision, templateVersion: 0 },
    { ...validProvision, reused: "false" },
  ])("rejects a malformed service RPC result", async (result) => {
    const startDemo = subject({
      provision: vi.fn(async () => result as DemoProvisionResult),
    });

    const response = await startDemo.handler(demoRequest());

    expect(response.status).toBe(502);
    await expect(responseErrorCode(response)).resolves.toBe(
      "invalid_server_response",
    );
  });
});

describe("Cloudflare Turnstile adapter", () => {
  it("posts the secret, one-time token, remote IP and idempotency key", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(init?.method).toBe("POST");
      expect(form.get("secret")).toBe("server-secret");
      expect(form.get("response")).toBe("single-use-token");
      expect(form.get("remoteip")).toBe("2001:db8::1");
      expect(form.get("idempotency_key")).toBe(idempotencyKey);
      return Response.json({
        success: true,
        action: START_DEMO_TURNSTILE_ACTION,
        hostname: "demo.example",
      });
    });
    const verify = createTurnstileValidator({
      secretKey: "server-secret",
      fetch: fetcher,
      timeoutMs: 100,
    });

    await expect(verify({
      token: "single-use-token",
      remoteIp: "2001:db8::1",
      idempotencyKey,
    })).resolves.toEqual({
      success: true,
      action: START_DEMO_TURNSTILE_ACTION,
      hostname: "demo.example",
      errorCodes: [],
      testingKey: false,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("preserves Cloudflare's testing-key marker", async () => {
    const verify = createTurnstileValidator({
      secretKey: "server-secret",
      fetch: vi.fn(async () => Response.json({
        success: true,
        hostname: "example.com",
        metadata: { result_with_testing_key: true },
      })),
      timeoutMs: 100,
    });

    await expect(verify({
      token: "XXXX.DUMMY.TOKEN.XXXX",
      idempotencyKey,
    })).resolves.toMatchObject({
      success: true,
      action: null,
      hostname: "example.com",
      testingKey: true,
    });
  });

  it("uses the same idempotency key across bounded transport retries", async () => {
    const seenKeys: Array<FormDataEntryValue | null> = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      seenKeys.push(form.get("idempotency_key"));
      if (seenKeys.length < 3) throw new Error("temporary outage");
      return Response.json({
        success: false,
        action: START_DEMO_TURNSTILE_ACTION,
        hostname: "demo.example",
        "error-codes": ["timeout-or-duplicate"],
      });
    });
    const verify = createTurnstileValidator({
      secretKey: "server-secret",
      fetch: fetcher,
      attempts: 3,
      timeoutMs: 100,
    });

    await expect(verify({
      token: "single-use-token",
      idempotencyKey,
    })).resolves.toMatchObject({
      success: false,
      errorCodes: ["timeout-or-duplicate"],
    });
    expect(seenKeys).toEqual([
      idempotencyKey,
      idempotencyKey,
      idempotencyKey,
    ]);
  });

  it("fails closed after bounded malformed upstream responses", async () => {
    const fetcher = vi.fn(async () => new Response("{", { status: 200 }));
    const verify = createTurnstileValidator({
      secretKey: "server-secret",
      fetch: fetcher,
      attempts: 2,
      timeoutMs: 100,
    });

    await expect(verify({
      token: "single-use-token",
      idempotencyKey,
    })).rejects.toBeInstanceOf(TurnstileUnavailableError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("never sends an oversized token upstream", async () => {
    const fetcher = vi.fn();
    const verify = createTurnstileValidator({
      secretKey: "server-secret",
      fetch: fetcher,
      timeoutMs: 100,
    });

    await expect(verify({
      token: "x".repeat(2_049),
      idempotencyKey,
    })).rejects.toBeInstanceOf(TurnstileUnavailableError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
