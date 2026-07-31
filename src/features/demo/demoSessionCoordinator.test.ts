import { describe, expect, it, vi } from "vitest";
import {
  enterDemoSession,
  resetDemoSession,
  type DemoIdentity,
  type DemoInstance,
  type DemoRemoteStatus,
  type DemoSessionDependencies
} from "./demoSessionCoordinator";

const tokens = {
  authCaptchaToken: "auth-token",
  provisionCaptchaToken: "provision-token"
};
const activeInstance: DemoInstance = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  campId: "20000000-0000-4000-8000-000000000002",
  expiresAt: "2026-08-01T12:30:00.000Z",
  templateVersion: 1,
  reused: false
};

function dependencies(options: {
  identity?: DemoIdentity | null;
  status?: DemoRemoteStatus;
  events?: string[];
} = {}): DemoSessionDependencies {
  const events = options.events ?? [];
  let identity = options.identity ?? null;
  return {
    currentIdentity: vi.fn(async () => identity),
    readSessionStatus: vi.fn(async (): Promise<DemoRemoteStatus> =>
      options.status ?? { state: "missing" }
    ),
    signInAnonymously: vi.fn(async (captchaToken: string) => {
      events.push(`sign-in:${captchaToken}`);
      identity = { userId: "new-demo-user", isAnonymous: true };
      return identity;
    }),
    provisionCurrentSession: vi.fn(async (action, captchaToken) => {
      events.push(`provision:${action}:${captchaToken}`);
      return activeInstance;
    }),
    clearOfflineDataForUser: vi.fn(async (userId: string) => {
      events.push(`clear-offline:${userId}`);
    }),
    clearWorkspaceSelectionsForUser: vi.fn((userId: string) => {
      events.push(`clear-selections:${userId}`);
    }),
    signOutLocal: vi.fn(async () => {
      events.push("sign-out-local");
      identity = null;
    }),
    abandonSession: vi.fn(async (userId: string) => {
      events.push(`abandon:${userId}`);
      identity = null;
    })
  };
}

describe("enterDemoSession", () => {
  it("skapar en anonym identitet och provisionerar utan klientvalda id:n", async () => {
    const events: string[] = [];
    const testDependencies = dependencies({ events });

    await expect(
      enterDemoSession(tokens, testDependencies)
    ).resolves.toEqual({
      userId: "new-demo-user",
      instance: activeInstance
    });
    expect(events).toEqual([
      "sign-in:auth-token",
      "provision:start:provision-token"
    ]);
  });

  it("återanvänder samma aktiva profil utan ny inloggning eller kopia", async () => {
    const existingInstance = { ...activeInstance, reused: true };
    const testDependencies = dependencies({
      identity: { userId: "existing-user", isAnonymous: true },
      status: { state: "active", instance: existingInstance }
    });

    await expect(
      enterDemoSession(tokens, testDependencies)
    ).resolves.toEqual({
      userId: "existing-user",
      instance: existingInstance
    });
    expect(testDependencies.signInAnonymously).not.toHaveBeenCalled();
    expect(testDependencies.provisionCurrentSession).not.toHaveBeenCalled();
  });

  it("slutför en saknad kopia på den befintliga anonyma profilen", async () => {
    const testDependencies = dependencies({
      identity: { userId: "existing-user", isAnonymous: true },
      status: { state: "missing" }
    });

    await expect(
      enterDemoSession(tokens, testDependencies)
    ).resolves.toMatchObject({ userId: "existing-user" });
    expect(testDependencies.signInAnonymously).not.toHaveBeenCalled();
    expect(testDependencies.provisionCurrentSession)
      .toHaveBeenCalledWith("start", "provision-token");
  });

  it("rensar en utgången identitet innan en ny skapas", async () => {
    const events: string[] = [];
    const testDependencies = dependencies({
      identity: { userId: "expired-user", isAnonymous: true },
      status: {
        state: "expired",
        expiresAt: "2026-07-30T10:00:00.000Z"
      },
      events
    });

    await expect(
      enterDemoSession(tokens, testDependencies)
    ).resolves.toMatchObject({ userId: "new-demo-user" });
    expect(events).toEqual([
      "clear-offline:expired-user",
      "clear-selections:expired-user",
      "sign-out-local",
      "sign-in:auth-token",
      "provision:start:provision-token"
    ]);
  });

  it("överger en ny identitet när provisioneringen misslyckas", async () => {
    const events: string[] = [];
    const testDependencies = dependencies({ events });
    const failure = new Error("provision failed");
    testDependencies.provisionCurrentSession = vi.fn(async () => {
      events.push("provision:start:provision-token");
      throw failure;
    });

    await expect(
      enterDemoSession(tokens, testDependencies)
    ).rejects.toBe(failure);
    expect(events.at(-1)).toBe("abandon:new-demo-user");
  });

  it("vägrar vanliga konton och återanvända Turnstile-token", async () => {
    const normalAccount = dependencies({
      identity: { userId: "normal-user", isAnonymous: false }
    });
    await expect(
      enterDemoSession(tokens, normalAccount)
    ).rejects.toThrow(
      "Logga ut från det vanliga kontot innan du startar demot."
    );

    await expect(
      enterDemoSession({
        authCaptchaToken: "same-token",
        provisionCaptchaToken: "same-token"
      }, dependencies())
    ).rejects.toThrow(
      "Robotkontrollerna måste använda två olika engångstoken."
    );
  });
});

describe("resetDemoSession", () => {
  it("rensar bara den egna klientdatan innan servern återställer kopian", async () => {
    const events: string[] = [];
    const testDependencies = dependencies({ events });

    await expect(
      resetDemoSession(
        { userId: "demo-user", isAnonymous: true },
        "reset-token",
        testDependencies
      )
    ).resolves.toEqual({
      userId: "demo-user",
      instance: activeInstance
    });
    expect(events).toEqual([
      "clear-offline:demo-user",
      "clear-selections:demo-user",
      "provision:reset:reset-token"
    ]);
  });

  it("vägrar återställning från ett vanligt konto", async () => {
    const testDependencies = dependencies();
    await expect(
      resetDemoSession(
        { userId: "normal-user", isAnonymous: false },
        "reset-token",
        testDependencies
      )
    ).rejects.toThrow("Endast den egna demosessionen kan återställas.");
    expect(testDependencies.clearOfflineDataForUser).not.toHaveBeenCalled();
  });
});
