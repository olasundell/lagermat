import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as XLSXNamespace from "xlsx";

const XLSX = XLSXNamespace.default ?? XLSXNamespace;
const workbookPath = resolve("Lägermat att dela 2024 - 2.0.xlsx");
const developmentOutputPath = resolve("supabase/seed/demo_recipes.sql");
const hostedOutputPath = resolve("supabase/migrations/20260720230000_recipe_template_catalogue.sql");
const sheetName = "0.1 Recept";
const organizationId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const userId = "11111111-1111-1111-1111-111111111111";
const expectedWorkbookDigest = "86d95a271a20f7c224563e6bbae8abf06853fd9c50097491bb283b3f52ebc892";
const expectedRecipeCount = 25;
const expectedIngredientCount = 245;

const recipeNameOverrides = new Map([
  ["Pasta Carbonara", "Pasta carbonara"],
  ["Chili sin Carne med Ris", "Chili sin carne med ris"],
  ["Thaigryta med Kyckling och kokosmjölk", "Thaigryta med kyckling och kokosmjölk"],
  ["Pörkölt Galuska", "Pörkölt med galuska"],
  ["Bräckt Skinka med Potatis och tomatsås", "Bräckt skinka med potatis och tomatsås"],
  ["Snabb Kycklinggryta", "Snabb kycklinggryta"],
  ["Klimatsmart Bolognese", "Klimatsmart bolognese"],
  ["Ostbricka (Endast Ledarna)", "Ostbricka (endast ledare)"],
  ["Pasta med broccloli och kassler", "Pasta med broccoli och kassler"]
]);

const ingredientNameOverrides = new Map([
  ["grönskaksbuljong", "Grönsaksbuljong"],
  ["grönsaksbuljong", "Grönsaksbuljong"],
  ["Ost 1", "Brie"],
  ["Ost 2", "Lagrad hårdost"],
  ["Kex 1", "Salta kex"],
  ["Kex 2", "Havrekex"],
  ["Allmän Ostbricka", "Extra ostbricka"],
  ["Bregott", "Matfett"],
  ["Veganskt Smör", "Mjölkfritt matfett"],
  ["Oatly Varm choklad", "Mjölkfri varm chokladdryck"],
  ["Vegan Bacon", "Vegobacon"],
  ["Vegansk Ost", "Mjölkfri ost"],
  ["Marmelad /squizy", "Marmelad"],
  ["Kycklingfile", "Kycklingfilé"],
  ["Mjölkfri creme fraiche", "Mjölkfri crème fraiche"],
  ["Ris (långkorningt)", "Långkornigt ris"],
  ["Mjölkfri matlagningsgräde", "Mjölkfri matlagningsgrädde"]
]);

function stableUuid(kind, value) {
  const hex = createHash("sha256")
    .update(`lagermat-demo-recipes:v1:${kind}:${value}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function catalogueUuid(kind, value) {
  const hex = createHash("sha256")
    .update(`lagermat-hosted-recipes:v1:${kind}:${value}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function templateKey(value) {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("sv-SE")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

function sql(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isTrue(value) {
  return value === true || value === 1 || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Arbetsboken saknar bladet ${sheetName}.`);

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const recipes = new Map();

  rows.slice(1).forEach((row, zeroBasedIndex) => {
    const sourceRow = zeroBasedIndex + 2;
    const sourceRecipeName = text(row[0]);
    const sourceIngredientName = text(row[1]);
    const sourceUnit = text(row[2]);
    const perPortion = number(row[4]);
    const fixedAmount = number(row[5]);
    const comment = text(row[7]);
    const excludeTag = text(row[8]);
    const onlyTag = text(row[9]);

    if (!sourceRecipeName || !sourceIngredientName || !sourceUnit || (perPortion === null && fixedAmount === null)) return;
    if (excludeTag && onlyTag) throw new Error(`Källrad ${sourceRow} har både exclude och only.`);

    const dietaryRule = onlyTag ? "only" : excludeTag ? "exclude" : "standard";
    const dietaryTagLabel = onlyTag ?? excludeTag;
    const ingredientName = ingredientNameOverrides.get(sourceIngredientName) ?? sourceIngredientName;
    const unit = sourceUnit.toLocaleLowerCase("sv-SE");
    const recipe = recipes.get(sourceRecipeName) ?? {
      sourceName: sourceRecipeName,
      name: recipeNameOverrides.get(sourceRecipeName) ?? sourceRecipeName,
      ingredients: []
    };

    if (perPortion !== null) {
      recipe.ingredients.push({
        name: ingredientName,
        unit,
        amount: perPortion,
        mode: isTrue(row[6]) ? "head" : "weighted_portion",
        dietaryRule,
        dietaryTagLabel,
        comment,
        sourceRow,
        component: "portion"
      });
    }

    if (fixedAmount !== null) {
      recipe.ingredients.push({
        name: ingredientName,
        unit,
        amount: fixedAmount,
        mode: "fixed_once_per_camp",
        dietaryRule,
        dietaryTagLabel,
        comment,
        sourceRow,
        component: "fixed"
      });
    }

    recipes.set(sourceRecipeName, recipe);
  });

  return [...recipes.values()];
}

function renderSql(recipes, workbookDigest) {
  const recipeValues = [];
  const versionValues = [];
  const ingredientValues = [];

  for (const recipe of recipes) {
    const recipeId = stableUuid("recipe", recipe.sourceName);
    const versionId = stableUuid("recipe-version", `${recipe.sourceName}:1`);
    const content = {
      name: recipe.name,
      version: 1,
      ingredients: recipe.ingredients.map((ingredient) => ({
        name: ingredient.name,
        unit: ingredient.unit,
        amount: ingredient.amount,
        mode: ingredient.mode,
        dietaryRule: ingredient.dietaryRule,
        dietaryTagLabel: ingredient.dietaryTagLabel,
        comment: ingredient.comment,
        sourceRow: ingredient.sourceRow
      }))
    };
    const contentDigest = createHash("sha256").update(JSON.stringify(content)).digest("hex");

    recipeValues.push(`  (${sql(recipeId)}, ${sql(organizationId)}, ${sql(recipe.name)}, ${sql(userId)})`);
    versionValues.push(
      `  (${sql(versionId)}, ${sql(organizationId)}, ${sql(recipeId)}, 1, 'published', ${sql(`Importerad från ${sheetName}.`)}, ${sql(contentDigest)}, ${sql(userId)}, now())`
    );

    recipe.ingredients.forEach((ingredient, index) => {
      const ingredientId = stableUuid(
        "recipe-ingredient",
        `${recipe.sourceName}:${ingredient.sourceRow}:${ingredient.component}`
      );
      ingredientValues.push(
        `  (${sql(ingredientId)}, ${sql(organizationId)}, ${sql(versionId)}, ${sql(ingredient.name)}, ${sql(ingredient.unit)}, ${ingredient.amount}, '${ingredient.mode}', '${ingredient.dietaryRule}', ${sql(ingredient.dietaryTagLabel)}, ${sql(ingredient.comment)}, ${ingredient.sourceRow}, ${index})`
      );
    });
  }

  const ingredientCount = recipes.reduce((total, recipe) => total + recipe.ingredients.length, 0);
  return `-- Generated by scripts/extract-demo-recipes.mjs. Do not edit by hand.
-- Source: Lägermat att dela 2024 - 2.0.xlsx / ${sheetName}
-- Source SHA-256: ${workbookDigest}
-- ${recipes.length} recipes, ${ingredientCount} explicit ingredient components.

insert into public.recipes (id, organization_id, name, created_by) values
${recipeValues.join(",\n")};

insert into public.recipe_versions (
  id, organization_id, recipe_id, version_number, status, instructions,
  content_digest, created_by, published_at
) values
${versionValues.join(",\n")};

insert into public.recipe_ingredients (
  id, organization_id, recipe_version_id, name, unit, amount, mode,
  dietary_rule, dietary_tag_label, comment, source_row, sort_order
) values
${ingredientValues.join(",\n")};
`;
}

function renderHostedCatalogueSql(recipes) {
  const templateValues = [];
  const ingredientValues = [];
  const digestRows = [];
  const keys = new Set();

  recipes.forEach((recipe, recipeIndex) => {
    const key = templateKey(recipe.name);
    if (!key || keys.has(key)) throw new Error(`Receptnamnet ${recipe.name} ger en ogiltig eller duplicerad mallnyckel.`);
    keys.add(key);

    const templateId = catalogueUuid("recipe-template", key);
    const digestContent = {
      name: recipe.name,
      ingredients: recipe.ingredients.map((ingredient) => ({
        name: ingredient.name,
        unit: ingredient.unit,
        amount: ingredient.amount,
        mode: ingredient.mode,
        dietaryRule: ingredient.dietaryRule,
        dietaryTagLabel: ingredient.dietaryTagLabel,
        comment: ingredient.comment
      }))
    };
    const contentDigest = createHash("sha256").update(JSON.stringify(digestContent)).digest("hex");
    digestRows.push(`${key}:${contentDigest}`);

    templateValues.push(
      `  (${sql(templateId)}, ${sql(key)}, ${sql(recipe.name)}, null, null, ${sql(contentDigest)}, ${(recipeIndex + 1) * 10})`
    );

    recipe.ingredients.forEach((ingredient, ingredientIndex) => {
      const ingredientId = catalogueUuid("recipe-ingredient-template", `${key}:${ingredientIndex}`);
      ingredientValues.push(
        `  (${sql(ingredientId)}, ${sql(templateId)}, ${sql(ingredient.name)}, ${sql(ingredient.unit)}, ${ingredient.amount}, '${ingredient.mode}', '${ingredient.dietaryRule}', ${sql(ingredient.dietaryTagLabel)}, ${sql(ingredient.comment)}, null, ${(ingredientIndex + 1) * 10})`
      );
    });
  });

  const ingredientCount = recipes.reduce((total, recipe) => total + recipe.ingredients.length, 0);
  const catalogueDigest = createHash("sha256").update(digestRows.join("\n")).digest("hex");
  return `-- Generated by scripts/extract-demo-recipes.mjs. Do not edit by hand.
-- Sanitised hosted catalogue: no brands, tenant, user or source-workbook identifiers.
-- ${recipes.length} recipes, ${ingredientCount} explicit ingredient components.
-- Catalogue digest: ${catalogueDigest}

do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('lagermat:first-organization', 0));
  if exists (select 1 from public.organizations) then
    raise exception 'The hosted recipe catalogue must be installed before first-organization bootstrap'
      using errcode = '55000';
  end if;
end;
$$;

delete from app_private.recipe_templates;

insert into app_private.recipe_templates (
  id, template_key, name, instructions, portion_size, content_digest, sort_order
) values
${templateValues.join(",\n")};

insert into app_private.recipe_ingredient_templates (
  id, recipe_template_id, name, unit, amount, mode,
  dietary_rule, dietary_tag_label, comment, source_row, sort_order
) values
${ingredientValues.join(",\n")};
`;
}

const workbookBuffer = await readFile(workbookPath);
const recipes = parseWorkbook(workbookBuffer);
const workbookDigest = createHash("sha256").update(workbookBuffer).digest("hex");
const ingredientCount = recipes.reduce((total, recipe) => total + recipe.ingredients.length, 0);
if (workbookDigest !== expectedWorkbookDigest
  || recipes.length !== expectedRecipeCount
  || ingredientCount !== expectedIngredientCount) {
  throw new Error("Arbetsbokens hash eller receptantal matchar inte den granskade källversionen.");
}
const generatedDevelopmentSql = renderSql(recipes, workbookDigest);
const generatedHostedSql = renderHostedCatalogueSql(recipes);

if (process.argv.includes("--check")) {
  const [currentDevelopmentSql, currentHostedSql] = await Promise.all([
    readFile(developmentOutputPath, "utf8").catch(() => ""),
    readFile(hostedOutputPath, "utf8").catch(() => "")
  ]);
  if (currentDevelopmentSql !== generatedDevelopmentSql || currentHostedSql !== generatedHostedSql) {
    console.error("Receptseed eller produktionskatalog är inte synkad med arbetsboken.");
    process.exitCode = 1;
  } else {
    console.log(`Receptseed och produktionskatalog är synkade: ${recipes.length} recept.`);
  }
} else {
  await Promise.all([
    writeFile(developmentOutputPath, generatedDevelopmentSql, "utf8"),
    writeFile(hostedOutputPath, generatedHostedSql, "utf8")
  ]);
  console.log(`Skrev ${recipes.length} recept till utvecklingsseed och produktionskatalog.`);
}
