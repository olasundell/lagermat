import { describe, expect, it } from "vitest";
import { PAGE_TUTORIAL_IDS } from "./tutorialDefinition";
import {
  TUTORIAL_PROGRESS_KEY,
  TUTORIAL_PROGRESS_VERSION,
  clearTutorialProgress,
  initialTutorialProgress,
  parseTutorialProgress,
  readTutorialProgress,
  skippedTutorialProgress,
  writeTutorialProgress,
  type TutorialStorage
} from "./tutorialProgress";

class MemoryStorage implements TutorialStorage {
  values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("tutorialProgress", () => {
  it("använder en enda versionsbunden och enhetslokal nyckel", () => {
    expect(TUTORIAL_PROGRESS_KEY).toContain(`v${TUTORIAL_PROGRESS_VERSION}`);
    expect(TUTORIAL_PROGRESS_KEY).not.toMatch(/user|camp|organisation|session/i);
    expect(initialTutorialProgress()).toEqual({
      version: 1,
      introStatus: "not-started",
      introStep: 0,
      pageSteps: {}
    });
  });

  it("återhämtar sig från korrupt eller felversionerad lagring", () => {
    expect(parseTutorialProgress("inte json")).toEqual(initialTutorialProgress());
    expect(parseTutorialProgress(JSON.stringify({
      version: 999,
      introStatus: "completed",
      introStep: 5,
      pageSteps: {}
    }))).toEqual(initialTutorialProgress());
  });

  it("bevarar ett pågående steg över omladdning och rensar okända sidvärden", () => {
    const storage = new MemoryStorage();
    writeTutorialProgress(storage, {
      version: 1,
      introStatus: "in-progress",
      introStep: 3,
      pageSteps: { participants: 1, unknown: 2, recipes: 9 }
    });

    expect(readTutorialProgress(storage)).toEqual({
      version: 1,
      introStatus: "in-progress",
      introStep: 3,
      pageSteps: { participants: 1 }
    });
  });

  it("hoppar över introduktionen men lämnar sidtipsen tillgängliga", () => {
    const progress = skippedTutorialProgress();
    expect(progress.introStatus).toBe("skipped");
    for (const id of PAGE_TUTORIAL_IDS) {
      expect(progress.pageSteps[id]).toBeUndefined();
    }
  });

  it("rensar bara guideprogress", () => {
    const storage = new MemoryStorage();
    storage.setItem("lagermat:workspace", "behåll");
    writeTutorialProgress(storage, {
      ...initialTutorialProgress(),
      introStatus: "completed"
    });

    clearTutorialProgress(storage);

    expect(storage.getItem(TUTORIAL_PROGRESS_KEY)).toBeNull();
    expect(storage.getItem("lagermat:workspace")).toBe("behåll");
  });
});
