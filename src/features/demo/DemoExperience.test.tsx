import { forwardRef, useImperativeHandle } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoBanner } from "./DemoBanner";
import { DemoStartPanel } from "./DemoStartPanel";
import type { DemoInstance } from "./demoSessionCoordinator";

vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: forwardRef(function MockTurnstile(
    props: {
      options?: { action?: string };
      onSuccess?: (token: string) => void;
    },
    ref
  ) {
    useImperativeHandle(ref, () => ({ reset: vi.fn() }));
    const action = props.options?.action ?? "unknown";
    return (
      <button
        type="button"
        onClick={() => props.onSuccess?.(`token-${action}`)}
      >
        Lös {action}
      </button>
    );
  })
}));

const instance: DemoInstance = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  campId: "20000000-0000-4000-8000-000000000002",
  expiresAt: "2026-08-01T12:30:00.000Z",
  templateVersion: 1,
  reused: false
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DemoStartPanel", () => {
  it("startar först när två skilda engångstoken finns", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn(async () => undefined);
    render(
      <DemoStartPanel
        siteKey="public-site-key"
        busy={false}
        error={null}
        onStart={onStart}
      />
    );

    const startButton = screen.getByRole("button", { name: "Prova demot" });
    expect(startButton).toBeDisabled();
    await user.click(screen.getByRole("button", {
      name: "Lös anonymous-sign-in"
    }));
    expect(startButton).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Lös start-demo" }));
    expect(startButton).toBeEnabled();

    await user.click(startButton);
    expect(onStart).toHaveBeenCalledWith({
      authCaptchaToken: "token-anonymous-sign-in",
      provisionCaptchaToken: "token-start-demo"
    });
    expect(startButton).toBeDisabled();
  });

  it("visar vänteläge och ett begripligt fel", () => {
    render(
      <DemoStartPanel
        siteKey="public-site-key"
        busy
        error="Demot är tillfälligt upptaget."
        onStart={vi.fn()}
      />
    );

    expect(screen.getByRole("button", {
      name: "Förbereder ditt demoläger…"
    })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Demot är tillfälligt upptaget."
    );
  });
});

describe("DemoBanner", () => {
  it("förklarar syntetiska data och kräver bekräftelse före återställning", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn(async () => undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <DemoBanner
        instance={instance}
        siteKey="public-site-key"
        resetting={false}
        error={null}
        onReset={onReset}
      />
    );

    expect(screen.getByText(/bara syntetiska uppgifter/i)).toBeVisible();
    const resetButton = screen.getByRole("button", {
      name: "Återställ mitt demo"
    });
    expect(resetButton).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Lös start-demo" }));
    expect(resetButton).toBeEnabled();
    await user.click(resetButton);

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledWith("token-start-demo");
    expect(resetButton).toBeDisabled();
  });

  it("behåller kopian när användaren avbryter", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn(async () => undefined);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <DemoBanner
        instance={instance}
        siteKey="public-site-key"
        resetting={false}
        error={null}
        onReset={onReset}
      />
    );

    await user.click(screen.getByRole("button", { name: "Lös start-demo" }));
    await user.click(screen.getByRole("button", {
      name: "Återställ mitt demo"
    }));
    expect(onReset).not.toHaveBeenCalled();
  });
});
