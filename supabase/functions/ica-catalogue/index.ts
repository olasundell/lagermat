import {
  createIcaCatalogueHandler,
  type IcaCatalogueEnvironment,
} from "../../../shared/icaCatalogueHandler.ts";
import { isIcaCatalogueDemoEnabled } from "./environment.ts";

function defaultHostedKey(variableName: string): string | undefined {
  const serialized = Deno.env.get(variableName);
  if (!serialized) return undefined;
  try {
    const keys = JSON.parse(serialized) as Record<string, unknown>;
    return typeof keys.default === "string" ? keys.default : undefined;
  } catch {
    return undefined;
  }
}

function exactOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.href === `${url.origin}/` ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

const appOrigin = exactOrigin(Deno.env.get("APP_ORIGIN"));
const demoModeEnabled = isIcaCatalogueDemoEnabled(Deno.env);

function environment(): IcaCatalogueEnvironment {
  return {
    supabaseUrl: Deno.env.get("SUPABASE_URL"),
    supabasePublishableKey:
      defaultHostedKey("SUPABASE_PUBLISHABLE_KEYS")
      ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
      ?? Deno.env.get("SUPABASE_ANON_KEY"),
    supabaseServiceRoleKey:
      defaultHostedKey("SUPABASE_SECRET_KEYS")
      ?? Deno.env.get("SUPABASE_SECRET_KEY")
      ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    localIcaFixture: Deno.env.get("LOCAL_ICA_FIXTURE"),
  };
}

const handler = appOrigin && demoModeEnabled
  ? createIcaCatalogueHandler({
    getEnvironment: environment,
    allowedOrigin: appOrigin,
  })
  : null;

Deno.serve((request) => {
  if (!handler) {
    return new Response(
      JSON.stringify({ error: "Serverkonfigurationen är ofullständig." }),
      {
        status: 500,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type": "application/json; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
  return handler(request);
});
