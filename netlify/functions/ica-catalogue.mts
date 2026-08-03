import type { Config, Context } from "@netlify/functions";
import {
  createIcaCatalogueHandler,
  type IcaCatalogueEnvironment,
} from "../../server/icaCatalogueHandler.ts";

declare const Netlify: {
  env: {
    get(variableName: string): string | undefined;
  };
};

let handler: ReturnType<typeof createIcaCatalogueHandler> | undefined;

function environment(): IcaCatalogueEnvironment {
  return {
    supabaseUrl:
      Netlify.env.get("SUPABASE_URL")
      ?? Netlify.env.get("VITE_SUPABASE_URL"),
    supabasePublishableKey:
      Netlify.env.get("SUPABASE_PUBLISHABLE_KEY")
      ?? Netlify.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")
      ?? Netlify.env.get("SUPABASE_ANON_KEY")
      ?? Netlify.env.get("VITE_SUPABASE_ANON_KEY"),
    supabaseServiceRoleKey:
      Netlify.env.get("SUPABASE_SECRET_KEY")
      ?? Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    localIcaFixture: Netlify.env.get("LOCAL_ICA_CATALOGUE_FIXTURE"),
  };
}

function catalogueHandler(): ReturnType<typeof createIcaCatalogueHandler> {
  handler ??= createIcaCatalogueHandler({ getEnvironment: environment });
  return handler;
}

export default async (
  request: Request,
  _context: Context,
): Promise<Response> => {
  void _context;
  return catalogueHandler()(request);
};

export const config: Config = {
  path: "/api/ica-catalogue",
};
