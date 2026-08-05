import {
  PAGE_TUTORIALS,
  PAGE_TUTORIAL_IDS
} from "./tutorialDefinition";

export const TUTORIAL_PROGRESS_VERSION = 2;
export const TUTORIAL_PROGRESS_KEY =
  `lagermat:tutorial-progress:v${TUTORIAL_PROGRESS_VERSION}`;

export type IntroTutorialStatus =
  | "not-started"
  | "in-progress"
  | "completed"
  | "skipped";

export interface TutorialProgress {
  version: typeof TUTORIAL_PROGRESS_VERSION;
  introStatus: IntroTutorialStatus;
  introStep: number;
  pageSteps: Record<string, number>;
}

export interface TutorialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function initialTutorialProgress(): TutorialProgress {
  return {
    version: TUTORIAL_PROGRESS_VERSION,
    introStatus: "not-started",
    introStep: 0,
    pageSteps: {}
  };
}

function validIntroStatus(value: unknown): value is IntroTutorialStatus {
  return value === "not-started"
    || value === "in-progress"
    || value === "completed"
    || value === "skipped";
}

export function parseTutorialProgress(value: string | null): TutorialProgress {
  if (!value) return initialTutorialProgress();

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      parsed.version !== TUTORIAL_PROGRESS_VERSION
      || !validIntroStatus(parsed.introStatus)
      || !Number.isInteger(parsed.introStep)
      || Number(parsed.introStep) < 0
      || !parsed.pageSteps
      || typeof parsed.pageSteps !== "object"
      || Array.isArray(parsed.pageSteps)
    ) {
      return initialTutorialProgress();
    }

    const pageStepCounts = new Map(
      PAGE_TUTORIALS.map(({ id, steps }) => [id, steps.length])
    );
    const pageSteps = Object.fromEntries(
      Object.entries(parsed.pageSteps as Record<string, unknown>)
        .filter(([id, step]) => {
          const stepCount = pageStepCounts.get(id);
          return PAGE_TUTORIAL_IDS.includes(id)
            && stepCount !== undefined
            && Number.isInteger(step)
            && Number(step) >= 0
            && Number(step) <= stepCount;
        })
        .map(([id, step]) => [id, Number(step)])
    );

    return {
      version: TUTORIAL_PROGRESS_VERSION,
      introStatus: parsed.introStatus,
      introStep: Number(parsed.introStep),
      pageSteps
    };
  } catch {
    return initialTutorialProgress();
  }
}

export function readTutorialProgress(storage: TutorialStorage): TutorialProgress {
  return parseTutorialProgress(storage.getItem(TUTORIAL_PROGRESS_KEY));
}

export function writeTutorialProgress(
  storage: TutorialStorage,
  progress: TutorialProgress
): void {
  storage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify(progress));
}

export function clearTutorialProgress(storage: TutorialStorage): void {
  storage.removeItem(TUTORIAL_PROGRESS_KEY);
}

export function skippedTutorialProgress(): TutorialProgress {
  return {
    ...initialTutorialProgress(),
    introStatus: "skipped"
  };
}
