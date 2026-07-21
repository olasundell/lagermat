import { render, screen } from "@testing-library/react";
import { BrandMark } from "./BrandMark";

describe("BrandMark", () => {
  it("uses the independent Lägermat name", () => {
    render(<BrandMark />);
    expect(screen.getByLabelText("Lägermat")).toBeInTheDocument();
    expect(screen.getByText("Lägermat")).toBeVisible();
  });
});
