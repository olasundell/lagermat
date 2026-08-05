/* eslint-disable react-refresh/only-export-components */
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  INTRO_TUTORIAL_STEPS,
  PAGE_TUTORIALS,
  PROCUREMENT_MATCHING_TUTORIAL,
  type TutorialStep
} from "./tutorialDefinition";
import { TutorialOverlay } from "./TutorialOverlay";
import {
  clearTutorialProgress,
  initialTutorialProgress,
  readTutorialProgress,
  skippedTutorialProgress,
  writeTutorialProgress,
  type TutorialProgress
} from "./tutorialProgress";

interface OverviewTutorialRegistration {
  ready: boolean;
}

interface ProcurementTutorialRegistration {
  ready: boolean;
  matchingAvailable: boolean;
}

interface TutorialContextValue {
  canReplay: boolean;
  replay: () => void;
  registerOverview: (
    registration: OverviewTutorialRegistration | null
  ) => void;
  registerProcurement: (
    registration: ProcurementTutorialRegistration | null
  ) => void;
}

interface TutorialTargetState {
  stepId: string;
  element: HTMLElement | null;
}

const TutorialContext = createContext<TutorialContextValue>({
  canReplay: false,
  replay: () => undefined,
  registerOverview: () => undefined,
  registerProcurement: () => undefined
});

export function useTutorial(): TutorialContextValue {
  return useContext(TutorialContext);
}

function visibleTutorialAnchor(id: string | null): HTMLElement | null {
  if (!id) return null;
  const element = document.querySelector<HTMLElement>(
    `[data-tutorial-id="${id}"]`
  );
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return element;
}

function targetForStep(step: TutorialStep): HTMLElement | null {
  return visibleTutorialAnchor(step.primaryAnchor)
    ?? visibleTutorialAnchor(step.fallbackAnchor);
}

export function TutorialProvider({
  activeDemo,
  children
}: {
  activeDemo: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  });
  const [progress, setProgress] = useState<TutorialProgress>(() =>
    readTutorialProgress(window.localStorage)
  );
  const [overview, setOverview] =
    useState<OverviewTutorialRegistration | null>(null);
  const [procurement, setProcurement] =
    useState<ProcurementTutorialRegistration | null>(null);
  const [targetState, setTargetState] =
    useState<TutorialTargetState | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const hadActiveStep = useRef(false);

  const routeTutorial = PAGE_TUTORIALS.find(
    (tutorial) => tutorial.route === pathname
  );
  const routeStepIndex = routeTutorial
    ? progress.pageSteps[routeTutorial.id] ?? 0
    : 0;
  const introVisible = activeDemo
    && pathname === "/"
    && overview?.ready === true
    && (
      progress.introStatus === "not-started"
      || progress.introStatus === "in-progress"
    );
  const routeTutorialVisible = activeDemo
    && (
      progress.introStatus === "completed"
      || progress.introStatus === "skipped"
    )
    && Boolean(routeTutorial)
    && Boolean(routeTutorial && routeStepIndex < routeTutorial.steps.length);
  const matchingStepIndex =
    progress.pageSteps[PROCUREMENT_MATCHING_TUTORIAL.id] ?? 0;
  const matchingTutorialVisible = activeDemo
    && (
      progress.introStatus === "completed"
      || progress.introStatus === "skipped"
    )
    && pathname === PROCUREMENT_MATCHING_TUTORIAL.route
    && routeTutorial?.id === "procurement"
    && routeStepIndex >= routeTutorial.steps.length
    && procurement?.ready === true
    && procurement.matchingAvailable
    && matchingStepIndex < PROCUREMENT_MATCHING_TUTORIAL.steps.length;
  const pageTutorial = routeTutorialVisible
    ? routeTutorial ?? null
    : matchingTutorialVisible
      ? PROCUREMENT_MATCHING_TUTORIAL
      : null;
  const pageStepIndex = pageTutorial
    ? progress.pageSteps[pageTutorial.id] ?? 0
    : 0;
  const pageVisible = pageTutorial !== null;
  const introIndex = Math.min(
    progress.introStep,
    INTRO_TUTORIAL_STEPS.length - 1
  );
  const activeStep = introVisible
    ? INTRO_TUTORIAL_STEPS[introIndex] ?? null
    : pageVisible && pageTutorial
      ? pageTutorial.steps[pageStepIndex] ?? null
      : null;
  const target = activeStep && targetState?.stepId === activeStep.id
    ? targetState.element
    : null;
  const targetRequired = Boolean(
    activeStep?.primaryAnchor || activeStep?.fallbackAnchor
  );
  const overlayReady = Boolean(activeStep) && (!targetRequired || target !== null);

  const persist = useCallback((next: TutorialProgress) => {
    writeTutorialProgress(window.localStorage, next);
    setProgress(next);
  }, []);

  const replay = useCallback(() => {
    clearTutorialProgress(window.localStorage);
    setProgress(initialTutorialProgress());
    void navigate({ to: "/" });
  }, [navigate]);

  const registerOverview = useCallback(
    (registration: OverviewTutorialRegistration | null) => {
      setOverview(registration);
    },
    []
  );

  const registerProcurement = useCallback(
    (registration: ProcurementTutorialRegistration | null) => {
      setProcurement(registration);
    },
    []
  );

  useLayoutEffect(() => {
    if (!activeStep) return;

    let frame = 0;
    const updateTarget = () => {
      frame = 0;
      const nextTarget = targetForStep(activeStep);
      setTargetState((current) =>
        current?.stepId === activeStep.id && current.element === nextTarget
          ? current
          : { stepId: activeStep.id, element: nextTarget }
      );
    };
    const scheduleUpdate = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateTarget);
    };
    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "style", "data-tutorial-id"]
    });
    scheduleUpdate();

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [activeStep, pathname]);

  useEffect(() => {
    if (activeStep && !hadActiveStep.current) {
      previousFocus.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      hadActiveStep.current = true;
      return;
    }
    if (!activeStep && hadActiveStep.current) {
      hadActiveStep.current = false;
      previousFocus.current?.focus();
      previousFocus.current = null;
    }
  }, [activeStep]);

  const finishIntro = useCallback(() => {
    persist({
      ...progress,
      introStatus: "completed",
      introStep: INTRO_TUTORIAL_STEPS.length - 1
    });
  }, [persist, progress]);

  const finishPage = useCallback(() => {
    if (!pageTutorial) return;
    persist({
      ...progress,
      pageSteps: {
        ...progress.pageSteps,
        [pageTutorial.id]: pageTutorial.steps.length
      }
    });
  }, [pageTutorial, persist, progress]);

  const close = useCallback(() => {
    if (introVisible) finishIntro();
    else finishPage();
  }, [finishIntro, finishPage, introVisible]);

  const next = useCallback(() => {
    if (introVisible) {
      persist({
        ...progress,
        introStatus: "in-progress",
        introStep: Math.min(
          introIndex + 1,
          INTRO_TUTORIAL_STEPS.length - 1
        )
      });
      return;
    }
    if (!pageTutorial) return;
    persist({
      ...progress,
      pageSteps: {
        ...progress.pageSteps,
        [pageTutorial.id]: Math.min(
          pageStepIndex + 1,
          pageTutorial.steps.length
        )
      }
    });
  }, [introIndex, introVisible, pageStepIndex, pageTutorial, persist, progress]);

  const continuePage = useCallback(() => {
    if (!pageTutorial?.continuation) return;
    const nextTutorial = PAGE_TUTORIALS.find(
      ({ route }) => route === pageTutorial.continuation?.route
    );
    persist({
      ...progress,
      pageSteps: {
        ...progress.pageSteps,
        [pageTutorial.id]: pageTutorial.steps.length,
        ...(nextTutorial ? { [nextTutorial.id]: 0 } : {})
      }
    });
    void navigate({ to: pageTutorial.continuation.route });
  }, [navigate, pageTutorial, persist, progress]);

  const back = useCallback(() => {
    if (introVisible) {
      persist({
        ...progress,
        introStatus: "in-progress",
        introStep: Math.max(0, introIndex - 1)
      });
      return;
    }
    if (!pageTutorial) return;
    persist({
      ...progress,
      pageSteps: {
        ...progress.pageSteps,
        [pageTutorial.id]: Math.max(0, pageStepIndex - 1)
      }
    });
  }, [introIndex, introVisible, pageStepIndex, pageTutorial, persist, progress]);

  const skip = useCallback(() => {
    persist(skippedTutorialProgress());
  }, [persist]);

  const startPageGuide = useCallback(() => {
    finishIntro();
    void navigate({ to: "/deltagare" });
  }, [finishIntro, navigate]);

  const value = useMemo<TutorialContextValue>(() => ({
    canReplay: activeDemo,
    replay,
    registerOverview,
    registerProcurement
  }), [activeDemo, registerOverview, registerProcurement, replay]);

  return (
    <TutorialContext.Provider value={value}>
      {children}
      {activeStep && overlayReady ? (
        <TutorialOverlay
          key={`${activeStep.id}:${introVisible ? introIndex : pageStepIndex}`}
          step={activeStep}
          stepIndex={introVisible ? introIndex : pageStepIndex}
          stepCount={introVisible
            ? INTRO_TUTORIAL_STEPS.length
            : pageTutorial?.steps.length ?? 0}
          continuationLabel={pageTutorial?.continuation?.label}
          target={target}
          kind={introVisible ? "intro" : "page"}
          onBack={back}
          onNext={next}
          onClose={close}
          onSkip={skip}
          onStartPageGuide={startPageGuide}
          onContinuePage={continuePage}
        />
      ) : null}
    </TutorialContext.Provider>
  );
}
