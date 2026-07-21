import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  announcePwaUpdate,
  dismissPwaUpdate,
  getPwaUpdateState,
  subscribeToPwaUpdate
} from "./pwaUpdate";

describe("PWA update state", () => {
  beforeEach(() => dismissPwaUpdate());

  it("announces an activatable update and notifies subscribers", async () => {
    const listener = vi.fn();
    const activate = vi.fn(async () => undefined);
    const unsubscribe = subscribeToPwaUpdate(listener);

    announcePwaUpdate(activate);

    expect(listener).toHaveBeenCalledOnce();
    expect(getPwaUpdateState().available).toBe(true);
    await getPwaUpdateState().activate?.();
    expect(activate).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("can be dismissed without activating the waiting worker", () => {
    const activate = vi.fn(async () => undefined);
    announcePwaUpdate(activate);

    dismissPwaUpdate();

    expect(getPwaUpdateState()).toEqual({ available: false, activate: null });
    expect(activate).not.toHaveBeenCalled();
  });
});
