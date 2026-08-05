import { forwardRef, useImperativeHandle } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoBanner } from "./DemoBanner";
import { DemoStartPanel } from "./DemoStartPanel";
import type { DemoInstance } from "./demoSessionCoordinator";
import {
  TURNSTILE_ALWAYS_PASS_SITE_KEY,
  TURNSTILE_DUMMY_TOKEN
} from "./demoTurnstileTestMode";

vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: forwardRef(function MockTurnstile(
    props: {
      siteKey?: string;
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
        onClick={() => props.onSuccess?.(
          props.siteKey === TURNSTILE_ALWAYS_PASS_SITE_KEY
            ? TURNSTILE_DUMMY_TOKEN
            : `token-${action}`
        )}
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

    const startButton = screen.getByRole("button", { name: "Öppna demolägret" });
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
        error="Demolägret är tillfälligt upptaget."
        onStart={vi.fn()}
      />
    );

    expect(screen.getByRole("button", {
      name: "Förbereder demolägret…"
    })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Demolägret är tillfälligt upptaget."
    );
  });

  it("kan använda Cloudflares fasta testtoken på loopback", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn(async () => undefined);
    render(
      <DemoStartPanel
        siteKey={TURNSTILE_ALWAYS_PASS_SITE_KEY}
        busy={false}
        error={null}
        onStart={onStart}
      />
    );

    await user.click(screen.getByRole("button", {
      name: "Lös anonymous-sign-in"
    }));
    await user.click(screen.getByRole("button", { name: "Lös start-demo" }));

    const startButton = screen.getByRole("button", {
      name: "Öppna demolägret"
    });
    expect(startButton).toBeEnabled();
    await user.click(startButton);
    expect(onStart).toHaveBeenCalledWith({
      authCaptchaToken: TURNSTILE_DUMMY_TOKEN,
      provisionCaptchaToken: TURNSTILE_DUMMY_TOKEN
    });
  });
});

describe("DemoBanner", () => {
  it("förklarar exempeluppgifter och kräver bekräftelse före återställning", async () => {
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

    expect(screen.getByText(/endast exempeluppgifter/i)).toBeVisible();
    const resetButton = screen.getByRole("button", {
      name: "Återställ demolägret"
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
      name: "Återställ demolägret"
    }));
    expect(onReset).not.toHaveBeenCalled();
  });
});
