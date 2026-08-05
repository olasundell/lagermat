import { X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties
} from "react";
import {
  Button,
  Dialog,
  Modal,
  ModalOverlay,
  Popover
} from "react-aria-components";
import type { TutorialStep } from "./tutorialDefinition";

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const TUTORIAL_EDGE_GAP = 4;
const TUTORIAL_TARGET_PADDING = 5;
const MIN_VERTICAL_POPOVER_SPACE = 320;
const MIN_HORIZONTAL_POPOVER_SPACE = 452;

export interface TutorialOverlayProps {
  step: TutorialStep;
  stepIndex: number;
  stepCount: number;
  target: HTMLElement | null;
  kind: "intro" | "page";
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
  onSkip: () => void;
  onDynamicHandoff: () => void;
}

function useMobileTutorial(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined"
      && window.matchMedia("(max-width: 700px)").matches
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return mobile;
}

function useTargetRect(target: HTMLElement | null): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null);

  useLayoutEffect(() => {
    if (!target) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    target.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: reducedMotion ? "auto" : "smooth"
    });

    const update = () => {
      const next = target.getBoundingClientRect();
      let top = next.top;
      let left = next.left;
      let right = next.right;
      let bottom = next.bottom;

      for (
        let ancestor = target.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        const style = window.getComputedStyle(ancestor);
        const clipsX = /(auto|scroll|hidden|clip)/.test(style.overflowX);
        const clipsY = /(auto|scroll|hidden|clip)/.test(style.overflowY);
        if (!clipsX && !clipsY) continue;

        const ancestorRect = ancestor.getBoundingClientRect();
        if (clipsX) {
          left = Math.max(left, ancestorRect.left);
          right = Math.min(right, ancestorRect.right);
        }
        if (clipsY) {
          top = Math.max(top, ancestorRect.top);
          bottom = Math.min(bottom, ancestorRect.bottom);
        }
      }

      setRect({
        top,
        left,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
      });
    };
    update();
    const animationFrame = window.requestAnimationFrame(update);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(update);
    resizeObserver?.observe(target);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [target]);

  return target ? rect : null;
}

function hasPopoverRoom(
  rect: TargetRect,
  placement: TutorialStep["placement"]
): boolean {
  if (placement === "top" || placement === "bottom") {
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - (rect.top + rect.height);
    return Math.max(spaceAbove, spaceBelow) >= MIN_VERTICAL_POPOVER_SPACE;
  }

  const spaceLeft = rect.left;
  const spaceRight = window.innerWidth - (rect.left + rect.width);
  return Math.max(spaceLeft, spaceRight) >= Math.min(
    MIN_HORIZONTAL_POPOVER_SPACE,
    window.innerWidth - 32
  );
}

function targetHighlightStyle(rect: TargetRect | null): CSSProperties | undefined {
  if (!rect) return undefined;

  const top = Math.max(TUTORIAL_EDGE_GAP, rect.top - TUTORIAL_TARGET_PADDING);
  const left = Math.max(TUTORIAL_EDGE_GAP, rect.left - TUTORIAL_TARGET_PADDING);
  const right = Math.min(
    window.innerWidth - TUTORIAL_EDGE_GAP,
    rect.left + rect.width + TUTORIAL_TARGET_PADDING
  );
  const bottom = Math.min(
    window.innerHeight - TUTORIAL_EDGE_GAP,
    rect.top + rect.height + TUTORIAL_TARGET_PADDING
  );
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width === 0 || height === 0) return undefined;

  return {
    "--tutorial-target-top": `${top}px`,
    "--tutorial-target-left": `${left}px`,
    "--tutorial-target-width": `${width}px`,
    "--tutorial-target-height": `${height}px`
  } as CSSProperties;
}

function TutorialCard({
  step,
  stepIndex,
  stepCount,
  kind,
  onBack,
  onNext,
  onClose,
  onSkip,
  onDynamicHandoff
}: Omit<TutorialOverlayProps, "target">) {
  const welcome = kind === "intro" && stepIndex === 0;
  const finalIntro = kind === "intro" && stepIndex === stepCount - 1;
  const finalPageTip = kind === "page" && stepIndex === stepCount - 1;
  const titleId = `tutorial-title-${step.id}`;

  return (
    <div className="tutorial-card" data-tutorial-step={step.id}>
      <div className="tutorial-card__topline">
        <span aria-live="polite" aria-atomic="true">
          Steg {stepIndex + 1} av {stepCount}
        </span>
        <Button
          className="tutorial-card__close"
          aria-label="Stäng tipset"
          onPress={onClose}
        >
          <X aria-hidden="true" size={20} />
        </Button>
      </div>
      <h2 id={titleId}>{step.title}</h2>
      <div className="tutorial-card__body">
        {step.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </div>
      <div className="tutorial-card__actions">
        {welcome ? (
          <>
            <Button className="button-link" onPress={onSkip}>
              Hoppa över guiden
            </Button>
            <Button autoFocus className="primary-button" onPress={onNext}>
              Visa mig runt
            </Button>
          </>
        ) : finalIntro ? (
          <>
            <Button className="button-link" onPress={onBack}>Tillbaka</Button>
            <Button className="secondary-button" onPress={onClose}>
              Stanna här
            </Button>
            <Button autoFocus className="primary-button" onPress={onDynamicHandoff}>
              Gå till nästa steg
            </Button>
          </>
        ) : (
          <>
            {stepIndex > 0 ? (
              <Button className="button-link" onPress={onBack}>Tillbaka</Button>
            ) : null}
            <Button autoFocus className="primary-button" onPress={finalPageTip ? onClose : onNext}>
              {finalPageTip ? "Avsluta" : "Nästa"}
            </Button>
            {!finalPageTip ? (
              <Button className="button-link" onPress={onClose}>Avsluta</Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function TutorialOverlay(props: TutorialOverlayProps) {
  const mobile = useMobileTutorial();
  const targetRect = useTargetRect(props.target);
  const { onClose } = props;
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [onClose]);
  const targetRef = useMemo(
    () => ({ current: props.target as Element | null }),
    [props.target]
  );
  const targetCoverage = targetRect
    ? (targetRect.width * targetRect.height)
      / (window.innerWidth * window.innerHeight)
    : 0;
  const highlightStyle = targetCoverage > 0.45
    ? undefined
    : targetHighlightStyle(targetRect);
  const anchored = !mobile
    && props.target !== null
    && props.step.primaryAnchor !== null
    && targetRect !== null
    && hasPopoverRoom(targetRect, props.step.placement);
  const mobileSheetEdge = mobile
    && targetRect
    && targetRect.top > window.innerHeight / 2
    ? "top"
    : "bottom";
  const card = <TutorialCard {...props} />;

  if (!anchored) {
    return (
      <ModalOverlay
        className="tutorial-modal-overlay"
        data-tutorial-ui="true"
        data-tutorial-layout={mobile ? "sheet" : props.target ? "dialog" : "unanchored"}
        data-tutorial-sheet-edge={mobile ? mobileSheetEdge : undefined}
        isOpen
        isDismissable={false}
      >
        {highlightStyle ? (
          <div
            className="tutorial-target-highlight"
            data-tutorial-active="true"
            style={highlightStyle}
            aria-hidden="true"
          />
        ) : null}
        <Modal className={mobile ? "tutorial-modal tutorial-modal--mobile" : "tutorial-modal"}>
          <Dialog
            className="tutorial-dialog"
            aria-labelledby={`tutorial-title-${props.step.id}`}
          >
            {card}
          </Dialog>
        </Modal>
      </ModalOverlay>
    );
  }

  return (
    <>
      <div
        className="tutorial-scrim"
        data-tutorial-ui="true"
        aria-hidden="true"
      />
      {highlightStyle ? (
        <div
          className="tutorial-target-highlight"
          data-tutorial-active="true"
          style={highlightStyle}
          aria-hidden="true"
        />
      ) : null}
      <Popover
        className="tutorial-popover"
        data-tutorial-ui="true"
        data-tutorial-layout="popover"
        trigger="Tutorial"
        triggerRef={targetRef}
        placement={props.step.placement}
        offset={14}
        isOpen
      >
        <Dialog
          className="tutorial-dialog"
          aria-labelledby={`tutorial-title-${props.step.id}`}
        >
          {card}
        </Dialog>
      </Popover>
    </>
  );
}
