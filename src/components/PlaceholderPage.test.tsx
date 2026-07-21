import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PlaceholderPage } from "./PlaceholderPage";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>
}));

describe("PlaceholderPage", () => {
  it("uses one clear 404 heading and updates the document title", () => {
    document.title = "Föregående sida";

    render(<PlaceholderPage title="Sidan finns inte" description="Gå tillbaka till översikten." />);

    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Sidan finns inte" })).toBeInTheDocument();
    expect(screen.queryByText("Sidan kunde inte visas")).not.toBeInTheDocument();
    expect(document.title).toBe("Sidan finns inte | Lägermat");
  });
});
