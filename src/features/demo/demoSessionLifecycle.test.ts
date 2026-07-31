import { describe, expect, it, vi } from "vitest";
import {
  recoverExpiredDemoSession,
  type DemoRecoveryDependencies
} from "./demoSessionLifecycle";

function dependencies(
  events: string[]
): DemoRecoveryDependencies<{ organizationId: string; campId: string }> {
  return {
    clearOfflineDataForUser: vi.fn(async (userId: string) => {
      events.push(`clear-offline:${userId}`);
    }),
    clearWorkspaceSelectionsForUser: vi.fn((userId: string) => {
      events.push(`clear-selections:${userId}`);
    }),
    signOutLocal: vi.fn(async () => {
      events.push("sign-out-old");
    }),
    signInAnonymously: vi.fn(async () => {
      events.push("sign-in-new");
      return { userId: "new-user" };
    }),
    provisionCurrentSession: vi.fn(async () => {
      events.push("provision-new");
      return { organizationId: "new-org", campId: "new-camp" };
    }),
    abandonNewSession: vi.fn(async () => {
      events.push("abandon-new");
    })
  };
}

describe("recoverExpiredDemoSession", () => {
  it("rensar den gamla användaren innan en ny anonym kopia skapas", async () => {
    const events: string[] = [];
    const result = await recoverExpiredDemoSession("expired-user", dependencies(events));

    expect(result).toEqual({
      userId: "new-user",
      instance: { organizationId: "new-org", campId: "new-camp" }
    });
    expect(events).toEqual([
      "clear-offline:expired-user",
      "clear-selections:expired-user",
      "sign-out-old",
      "sign-in-new",
      "provision-new"
    ]);
  });

  it("överger den nya lokala sessionen om provisioneringen misslyckas", async () => {
    const events: string[] = [];
    const testDependencies = dependencies(events);
    const failure = new Error("Provisioneringen misslyckades");
    testDependencies.provisionCurrentSession = vi.fn(async () => {
      events.push("provision-new");
      throw failure;
    });

    await expect(
      recoverExpiredDemoSession("expired-user", testDependencies)
    ).rejects.toBe(failure);
    expect(events.at(-1)).toBe("abandon-new");
  });

  it("vägrar återanvända den utgångna identiteten", async () => {
    const events: string[] = [];
    const testDependencies = dependencies(events);
    testDependencies.signInAnonymously = vi.fn(async () => {
      events.push("sign-in-new");
      return { userId: "expired-user" };
    });

    await expect(
      recoverExpiredDemoSession("expired-user", testDependencies)
    ).rejects.toThrow("En ny anonym demoidentitet kunde inte skapas.");
    expect(events).toContain("abandon-new");
    expect(events).not.toContain("provision-new");
  });

  it("skapar ingen ny session om den användarspecifika cacherensningen misslyckas", async () => {
    const events: string[] = [];
    const testDependencies = dependencies(events);
    testDependencies.clearOfflineDataForUser = vi.fn(async () => {
      events.push("clear-offline:expired-user");
      throw new Error("IndexedDB kunde inte rensas");
    });

    await expect(
      recoverExpiredDemoSession("expired-user", testDependencies)
    ).rejects.toThrow("IndexedDB kunde inte rensas");
    expect(events).toEqual(["clear-offline:expired-user"]);
  });
});
