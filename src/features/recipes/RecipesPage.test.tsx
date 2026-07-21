import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecipesPage } from "./RecipesPage";

const recipeQueryData = vi.hoisted(() => ({
  current: { recipes: [] as Array<Record<string, unknown>>, copies: [] as Array<Record<string, unknown>> }
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: recipeQueryData.current, error: null, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() })
}));

vi.mock("../../lib/supabase", () => ({ supabase: {} }));

vi.mock("../workspace/WorkspaceContext", () => ({
  useWorkspace: () => ({
    activeMembership: {
      organizationId: "organization-1",
      organizationName: "Björkstad scoutkår"
    },
    activeCamp: {
      id: "camp-1",
      name: "Sommarläger 2026"
    }
  })
}));

const aubergineRecipe = {
  id: "recipe-1",
  name: "Auberginegryta",
  recipe_versions: [
    {
      id: "version-1",
      version_number: 1,
      status: "published",
      instructions: null,
      recipe_ingredients: []
    }
  ]
};

describe("RecipesPage empty states", () => {
  beforeEach(() => {
    recipeQueryData.current = { recipes: [aubergineRecipe], copies: [] };
  });

  it("removes the stale recipe detail and action when a search has no matches", async () => {
    const user = userEvent.setup();
    render(<RecipesPage />);

    expect(screen.getByRole("heading", { name: "Auberginegryta" })).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Sök recept" }), "zzzz");

    expect(screen.getByText("Inga recept matchar sökningen.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Auberginegryta" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lägg till Auberginegryta/ })).not.toBeInTheDocument();
  });

  it("describes an actually empty recipe library without calling it a failed search", () => {
    recipeQueryData.current = { recipes: [], copies: [] };

    render(<RecipesPage />);

    expect(screen.getByText("Receptbiblioteket är tomt.")).toBeInTheDocument();
    expect(screen.queryByText("Inga recept matchar sökningen.")).not.toBeInTheDocument();
  });
});
