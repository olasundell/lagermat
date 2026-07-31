import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  announcePwaUpdate,
  dismissPwaUpdate,
  getPwaUpdateState,
  resetPwaUpdateForTests,
  subscribeToPwaUpdate
} from "./pwaUpdate";

describe("PWA update state", () => {
  beforeEach(() => resetPwaUpdateForTests());

  it("announces an activatable update and notifies subscribers", async () => {
    const listener = vi.fn();
    const activate = vi.fn(async () => undefined);
    const unsubscribe = subscribeToPwaUpdate(listener);

    announcePwaUpdate(activate);

    expect(listener).toHaveBeenCalledOnce();
    expect(getPwaUpdateState().available).toBe(true);
    await getPwaUpdateState().activate?.();
    expect(activate).toHaveBeenCalledOnce();
    expect(getPwaUpdateState()).toEqual({
      available: false,
      applying: true,
      activate: null,
    });
    unsubscribe();
  });

  it("can be dismissed without activating the waiting worker", () => {
    const activate = vi.fn(async () => undefined);
    announcePwaUpdate(activate);

    dismissPwaUpdate();

    expect(getPwaUpdateState()).toEqual({
      available: false,
      applying: false,
      activate: null,
    });
    expect(activate).not.toHaveBeenCalled();
  });

  it("does not reopen a dismissed update during the same browser session", () => {
    const first = vi.fn(async () => undefined);
    const repeated = vi.fn(async () => undefined);
    announcePwaUpdate(first);
    dismissPwaUpdate();

    announcePwaUpdate(repeated);

    expect(getPwaUpdateState().available).toBe(false);
    expect(first).not.toHaveBeenCalled();
    expect(repeated).not.toHaveBeenCalled();
  });

  it("restores the prompt if applying the update fails", async () => {
    const activate = vi.fn(async () => {
      throw new Error("worker failed");
    });
    announcePwaUpdate(activate);

    await expect(getPwaUpdateState().activate?.()).rejects.toThrow(
      "worker failed",
    );

    expect(getPwaUpdateState().available).toBe(true);
    expect(getPwaUpdateState().applying).toBe(false);
    expect(getPwaUpdateState().activate).toBeTypeOf("function");
  });
});
