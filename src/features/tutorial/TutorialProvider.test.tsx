import { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialProvider, useTutorial } from "./TutorialProvider";
import {
  TUTORIAL_PROGRESS_KEY,
  TUTORIAL_PROGRESS_VERSION
} from "./tutorialProgress";

const router = vi.hoisted(() => ({
  pathname: "/",
  navigate: vi.fn()
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    useNavigate: () => router.navigate,
    useRouterState: ({ select }: {
      select: (state: { location: { pathname: string } }) => unknown;
    }) => select({ location: { pathname: router.pathname } })
  };
});

function OverviewFixture({
  ready = true,
  targetPress = () => undefined
}: {
  ready?: boolean;
  targetPress?: () => void;
}) {
  const { registerOverview } = useTutorial();
  useEffect(() => {
    registerOverview({ ready, nextPath: "/deltagare" });
    return () => registerOverview(null);
  }, [ready, registerOverview]);

  return (
    <>
      <div data-tutorial-id="demo-banner">Banderoll</div>
      <div data-tutorial-id="workspace-context">Kontext</div>
      <nav data-tutorial-id="primary-navigation">Navigation</nav>
      <div data-tutorial-id="overview-flow-heading">Flöde</div>
      <button
        type="button"
        data-tutorial-id="overview-next-action"
        onClick={targetPress}
      >
        Produktens nästa åtgärd
      </button>
    </>
  );
}

function ReplayControl() {
  const { canReplay, replay } = useTutorial();
  return canReplay ? <button onClick={replay}>Visa guiden igen</button> : null;
}

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value)
    } satisfies Storage
  });
  window.localStorage.clear();
  router.pathname = "/";
  router.navigate.mockReset();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn()
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(80, 80, 160, 48)
  });
});

describe("TutorialProvider", () => {
  it("visar inget för privat läge eller innan Översikt är färdig", async () => {
    const { rerender } = render(
      <TutorialProvider activeDemo={false}>
        <OverviewFixture />
        <ReplayControl />
      </TutorialProvider>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Visa guiden igen" })).not.toBeInTheDocument();

    rerender(
      <TutorialProvider activeDemo>
        <OverviewFixture ready={false} />
      </TutorialProvider>
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("går genom sex steg och navigerar utan att aktivera produktkontrollen", async () => {
    const user = userEvent.setup();
    const targetPress = vi.fn();
    render(
      <TutorialProvider activeDemo>
        <OverviewFixture targetPress={targetPress} />
      </TutorialProvider>
    );

    expect(await screen.findByRole("dialog", {
      name: "Välkommen till ditt demoläger"
    })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Visa mig runt" }));

    for (const title of [
      "Du arbetar i demoläget",
      "Organisation och läger",
      "Appens delar",
      "Planera i rätt ordning"
    ]) {
      expect(await screen.findByRole("dialog", { name: title })).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Nästa" }));
    }

    expect(await screen.findByRole("dialog", { name: "Nästa steg" })).toBeVisible();
    expect(screen.getByText("Steg 6 av 6")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Gå till nästa steg" }));

    expect(targetPress).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith({ to: "/deltagare" });
  });

  it("återupptar ett lagrat steg och Escape avslutar utan att fastna", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({
      version: TUTORIAL_PROGRESS_VERSION,
      introStatus: "in-progress",
      introStep: 2,
      pageSteps: {}
    }));
    render(
      <TutorialProvider activeDemo>
        <OverviewFixture />
      </TutorialProvider>
    );

    expect(await screen.findByRole("dialog", {
      name: "Organisation och läger"
    })).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem(TUTORIAL_PROGRESS_KEY) ?? "{}"))
      .toMatchObject({ introStatus: "completed" });
  });

  it("hopp över introduktionen lämnar första sidtipset kvar", async () => {
    router.pathname = "/deltagare";
    window.localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({
      version: TUTORIAL_PROGRESS_VERSION,
      introStatus: "skipped",
      introStep: 0,
      pageSteps: {}
    }));
    render(
      <TutorialProvider activeDemo>
        <div data-tutorial-id="participants-page">Deltagarsida</div>
      </TutorialProvider>
    );

    expect(await screen.findByRole("dialog", {
      name: "Deltagarna är grunden"
    })).toBeVisible();
  });

  it("väntar på sidans mål innan ett förankrat tips visas", async () => {
    router.pathname = "/deltagare";
    window.localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({
      version: TUTORIAL_PROGRESS_VERSION,
      introStatus: "skipped",
      introStep: 0,
      pageSteps: {}
    }));
    const { rerender } = render(
      <TutorialProvider activeDemo>
        <div>Läser deltagare</div>
      </TutorialProvider>
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    rerender(
      <TutorialProvider activeDemo>
        <div data-tutorial-id="participants-page">Deltagarsida</div>
      </TutorialProvider>
    );

    expect(await screen.findByRole("dialog", {
      name: "Deltagarna är grunden"
    })).toBeVisible();
  });

  it("Visa guiden igen rensar bara tutorialnyckeln", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("lagermat:workspace", "behåll");
    window.localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({
      version: TUTORIAL_PROGRESS_VERSION,
      introStatus: "completed",
      introStep: 5,
      pageSteps: { participants: 2 }
    }));
    render(
      <TutorialProvider activeDemo>
        <OverviewFixture />
        <ReplayControl />
      </TutorialProvider>
    );

    await user.click(screen.getByRole("button", { name: "Visa guiden igen" }));

    expect(window.localStorage.getItem("lagermat:workspace")).toBe("behåll");
    expect(window.localStorage.getItem(TUTORIAL_PROGRESS_KEY)).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith({ to: "/" });
    expect(await screen.findByRole("dialog", {
      name: "Välkommen till ditt demoläger"
    })).toBeVisible();
  });
});
