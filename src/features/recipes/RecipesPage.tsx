import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  CircleAlert,
  LoaderCircle,
  PackageOpen,
  Search,
  ShieldCheck,
  TentTree,
  UsersRound,
  Weight
} from "lucide-react";
import { useState } from "react";
import { Button } from "react-aria-components";
import { supabase } from "../../lib/supabase";
import { userFacingError } from "../../lib/userFacingError";
import { useWorkspace } from "../workspace/WorkspaceContext";
import {
  dietaryRuleLabel,
  formatIngredientAmount,
  ingredientModeLabels,
  type DietaryRule,
  type IngredientMode
} from "./recipeModel";

interface RecipeIngredientRow {
  id: string;
  name: string;
  unit: string;
  amount: number;
  mode: IngredientMode;
  dietary_rule: DietaryRule;
  dietary_tag_label: string | null;
  comment: string | null;
  source_row: number | null;
  sort_order: number;
}

interface RecipeVersionRow {
  id: string;
  version_number: number;
  status: "draft" | "published" | "retired";
  instructions: string | null;
  recipe_ingredients: RecipeIngredientRow[];
}

interface RecipeRow {
  id: string;
  name: string;
  recipe_versions: RecipeVersionRow[];
}

interface CampCopyRow {
  id: string;
  name: string;
  source_recipe_version_id: string;
  version_key: string;
  created_at: string;
}

const modeIcons: Record<IngredientMode, typeof Weight> = {
  weighted_portion: Weight,
  head: UsersRound,
  fixed_once_per_camp: PackageOpen
};

function latestVersion(recipe: RecipeRow): RecipeVersionRow | undefined {
  return [...recipe.recipe_versions].sort((left, right) => right.version_number - left.version_number)[0];
}

function RecipeIngredient({ ingredient }: { ingredient: RecipeIngredientRow }) {
  const ModeIcon = modeIcons[ingredient.mode];
  return (
    <li className="recipe-ingredient">
      <span className="recipe-ingredient__amount">
        <strong>{formatIngredientAmount(ingredient.amount)}</strong> {ingredient.unit}
      </span>
      <span className="recipe-ingredient__name">
        <strong>{ingredient.name}</strong>
        {ingredient.comment ? <small>{ingredient.comment}</small> : null}
      </span>
      <span className="recipe-ingredient__mode">
        <ModeIcon aria-hidden="true" size={16} /> {ingredientModeLabels[ingredient.mode]}
      </span>
      <span className={`recipe-diet-rule recipe-diet-rule--${ingredient.dietary_rule}`}>
        {dietaryRuleLabel(ingredient.dietary_rule, ingredient.dietary_tag_label)}
      </span>
    </li>
  );
}

function RecipeDetailEmpty({
  icon: Icon,
  title,
  description
}: {
  icon: typeof BookOpen;
  title: string;
  description: string;
}) {
  return (
    <div className="recipe-detail__empty">
      <Icon aria-hidden="true" size={30} />
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export function RecipesPage() {
  const queryClient = useQueryClient();
  const { activeCamp, activeMembership } = useWorkspace();
  const [search, setSearch] = useState("");
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [freezingVersionId, setFreezingVersionId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const scope = activeMembership && activeCamp
    ? { organizationId: activeMembership.organizationId, campId: activeCamp.id }
    : null;

  const recipeQuery = useQuery({
    queryKey: ["recipe-library", scope?.organizationId, scope?.campId],
    enabled: Boolean(scope && supabase),
    queryFn: async () => {
      if (!scope || !supabase) return { recipes: [], copies: [] };
      const [recipeResult, copyResult] = await Promise.all([
        supabase
          .from("recipes")
          .select("id, name, recipe_versions(id, version_number, status, instructions, recipe_ingredients(id, name, unit, amount, mode, dietary_rule, dietary_tag_label, comment, source_row, sort_order))")
          .eq("organization_id", scope.organizationId)
          .order("name"),
        supabase
          .from("camp_recipe_copies")
          .select("id, name, source_recipe_version_id, version_key, created_at")
          .eq("organization_id", scope.organizationId)
          .eq("camp_id", scope.campId)
          .order("created_at", { ascending: false })
      ]);
      const error = recipeResult.error ?? copyResult.error;
      if (error) throw error;
      return {
        recipes: (recipeResult.data ?? []) as RecipeRow[],
        copies: (copyResult.data ?? []) as CampCopyRow[]
      };
    }
  });

  const recipes = recipeQuery.data?.recipes ?? [];
  const copies = recipeQuery.data?.copies ?? [];
  const normalizedSearch = search.trim().toLocaleLowerCase("sv-SE");
  const filteredRecipes = normalizedSearch
    ? recipes.filter((recipe) => recipe.name.toLocaleLowerCase("sv-SE").includes(normalizedSearch))
    : recipes;
  const selectedRecipe = filteredRecipes.find((recipe) => recipe.id === selectedRecipeId)
    ?? filteredRecipes[0];
  const selectedVersion = selectedRecipe ? latestVersion(selectedRecipe) : undefined;
  const selectedCopy = selectedVersion
    ? copies.find((copy) => copy.source_recipe_version_id === selectedVersion.id)
    : undefined;
  const allIngredients = recipes.flatMap((recipe) => recipe.recipe_versions.flatMap((version) => version.recipe_ingredients));
  const dietaryVariantCount = allIngredients.filter((ingredient) => ingredient.dietary_rule !== "standard").length;

  async function freezeVersion(version: RecipeVersionRow) {
    if (!supabase || !scope || !selectedRecipe) return;
    setFreezingVersionId(version.id);
    setMessage(null);
    const alreadyFrozen = copies.some((copy) => copy.source_recipe_version_id === version.id);
    const { error } = await supabase.rpc("freeze_recipe_version", {
      p_camp_id: scope.campId,
      p_recipe_version_id: version.id
    });
    if (error) {
      setMessage({ kind: "error", text: userFacingError(error, "Receptet kunde inte läggas till i lägret.") });
      setFreezingVersionId(null);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["recipe-library"] }),
      queryClient.invalidateQueries({ queryKey: ["camp-overview"] })
    ]);
    setMessage({
      kind: "success",
      text: alreadyFrozen
        ? `${selectedRecipe.name}, version ${version.version_number}, finns redan i ${activeCamp?.name}.`
        : `${selectedRecipe.name}, version ${version.version_number}, lades till i ${activeCamp?.name}.`
    });
    setFreezingVersionId(null);
  }

  if (!scope || !activeCamp || !activeMembership) {
    return <section className="page page--narrow"><p className="form-error">Välj organisation och läger först.</p></section>;
  }

  return (
    <section className="page recipes-page" data-tutorial-id="recipes-page">
      <header
        className="page-heading page-heading--split"
        data-tutorial-id="recipes-heading"
      >
        <div>
          <p className="page-heading__eyebrow">Organisationsbibliotek</p>
          <h1>Recept</h1>
          <p>{activeMembership.organizationName} · välj vilka recept som ska användas på {activeCamp.name}.</p>
        </div>
        <div className="recipe-summary" aria-label="Receptöversikt">
          <span><strong>{recipes.length}</strong> recept</span>
          <span><strong>{copies.length}</strong> valda för lägret</span>
          <span><strong>{dietaryVariantCount}</strong> specialkostanpassningar</span>
        </div>
      </header>

      {message ? (
        <p className={message.kind === "error" ? "form-error" : "form-success"} role="status">
          {message.kind === "success" ? <Check aria-hidden="true" size={18} /> : <CircleAlert aria-hidden="true" size={18} />}
          {message.text}
        </p>
      ) : null}

      {recipeQuery.isLoading ? <LoaderCircle className="spin" aria-label="Läser recept" size={30} /> : recipeQuery.error ? (
        <p className="form-error">{userFacingError(recipeQuery.error, "Recepten kunde inte läsas.")}</p>
      ) : (
        <div className="recipe-layout">
          <section
            className="recipe-browser"
            aria-labelledby="recipe-library-heading"
            data-tutorial-id="recipes-library"
          >
            <div className="section-heading" data-tutorial-id="recipes-library-heading">
              <BookOpen aria-hidden="true" size={24} />
              <div><h2 id="recipe-library-heading">Bibliotek</h2><p>Granskade receptmallar för lägerplanering</p></div>
            </div>
            <label className="recipe-search">
              <Search aria-hidden="true" size={19} />
              <span className="sr-only">Sök recept</span>
              <input name="recipe-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Sök bland recept" />
            </label>
            <div className="recipe-list" role="list">
              {filteredRecipes.map((recipe) => {
                const latestRecipeVersion = latestVersion(recipe);
                const isSelected = recipe.id === selectedRecipe?.id;
                const isFrozen = latestRecipeVersion && copies.some((copy) => copy.source_recipe_version_id === latestRecipeVersion.id);
                return (
                  <Button
                    key={recipe.id}
                    className={`recipe-list__item${isSelected ? " is-selected" : ""}`}
                    onPress={() => setSelectedRecipeId(recipe.id)}
                    aria-label={`Visa ${recipe.name}`}
                  >
                    <span><strong>{recipe.name}</strong><small>{latestRecipeVersion?.recipe_ingredients.length ?? 0} ingredienser · version {latestRecipeVersion?.version_number ?? "–"}</small></span>
                    {isFrozen ? <Check aria-label="Tillagt i lägret" size={18} /> : null}
                  </Button>
                );
              })}
              {recipes.length === 0 ? (
                <p className="muted-copy">Receptbiblioteket är tomt.</p>
              ) : filteredRecipes.length === 0 ? (
                <p className="muted-copy">Inga recept matchar sökningen.</p>
              ) : null}
            </div>
          </section>

          <section
            className="recipe-detail"
            aria-live="polite"
            data-tutorial-id="recipes-camp-copy"
          >
            {selectedRecipe && selectedVersion ? (
              <>
                <div className="recipe-detail__heading" data-tutorial-id="recipes-copy-heading">
                  <div>
                    <p>Publicerad version {selectedVersion.version_number}</p>
                    <h2>{selectedRecipe.name}</h2>
                  </div>
                  <Button
                    className="primary-button"
                    isDisabled={freezingVersionId === selectedVersion.id}
                    onPress={() => freezeVersion(selectedVersion)}
                    aria-label={`Lägg till ${selectedRecipe.name} version ${selectedVersion.version_number} i lägret`}
                  >
                    {freezingVersionId === selectedVersion.id ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : selectedCopy ? <Check aria-hidden="true" size={18} /> : <TentTree aria-hidden="true" size={18} />}
                    {selectedCopy ? "Tillagt i lägret" : "Lägg till i lägret"}
                  </Button>
                </div>
                <div className="frozen-copy-note">
                  <ShieldCheck aria-hidden="true" size={21} />
                  <span><strong>Lägret får en egen kopia av receptet.</strong><small>Den ändras inte om originalreceptet uppdateras senare.</small></span>
                </div>
                <ul className="recipe-ingredients">
                  {[...selectedVersion.recipe_ingredients]
                    .sort((left, right) => left.sort_order - right.sort_order)
                    .map((ingredient) => <RecipeIngredient key={ingredient.id} ingredient={ingredient} />)}
                </ul>
              </>
            ) : recipes.length === 0 ? (
              <RecipeDetailEmpty
                icon={BookOpen}
                title="Inga recept ännu"
                description="Lägg till recept i biblioteket för att kunna planera lägrets måltider."
              />
            ) : filteredRecipes.length === 0 ? (
              <RecipeDetailEmpty
                icon={Search}
                title="Ingen sökträff"
                description="Ändra sökningen för att visa ett recept."
              />
            ) : (
              <RecipeDetailEmpty
                icon={BookOpen}
                title="Välj ett recept"
                description="Välj ett recept i biblioteket för att visa ingredienser och lägga till det i lägret."
              />
            )}
          </section>
        </div>
      )}
    </section>
  );
}
