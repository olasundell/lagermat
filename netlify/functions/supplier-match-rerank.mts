import type { Config, Context } from "@netlify/functions";
import {
  createSupplierMatchRerankHandler,
  type SupplierMatchRerankEnvironment,
} from "../../server/supplierMatchRerankHandler.ts";

declare const Netlify: {
  env: {
    get(variableName: string): string | undefined;
  };
};

let handler: ReturnType<typeof createSupplierMatchRerankHandler> | undefined;

function environment(): SupplierMatchRerankEnvironment {
  return {
    supabaseUrl:
      Netlify.env.get("SUPABASE_URL")
      ?? Netlify.env.get("VITE_SUPABASE_URL"),
    supabasePublishableKey:
      Netlify.env.get("SUPABASE_PUBLISHABLE_KEY")
      ?? Netlify.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")
      ?? Netlify.env.get("SUPABASE_ANON_KEY")
      ?? Netlify.env.get("VITE_SUPABASE_ANON_KEY"),
    openAiBaseUrl: Netlify.env.get("OPENAI_BASE_URL"),
    openAiApiKey: Netlify.env.get("OPENAI_API_KEY"),
  };
}

function rerankHandler(): ReturnType<typeof createSupplierMatchRerankHandler> {
  handler ??= createSupplierMatchRerankHandler({
    getEnvironment: environment,
  });
  return handler;
}

export default async (
  request: Request,
  _context: Context,
): Promise<Response> => {
  void _context;
  return rerankHandler()(request);
};

export const config: Config = {
  path: "/api/supplier-match-rerank",
  method: "POST",
};
