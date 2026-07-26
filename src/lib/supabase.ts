import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

export interface SupabaseConfiguration {
  configured: boolean;
  error: string | null;
  isLocal: boolean;
  url: string | null;
}

function parseSupabaseUrl(value: string): { valid: boolean; isLocal: boolean } {
  try {
    const url = new URL(value);
    const isLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    return {
      valid: (isLocal && url.protocol === "http:") || (!isLocal && url.protocol === "https:"),
      isLocal
    };
  } catch {
    return { valid: false, isLocal: false };
  }
}

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const legacyLocalKey = import.meta.env.DEV ? import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() : undefined;
const browserKey = publishableKey || legacyLocalKey;
const parsedUrl = url ? parseSupabaseUrl(url) : { valid: false, isLocal: false };

export const supabaseConfiguration: SupabaseConfiguration = !url && !browserKey
  ? { configured: false, error: null, isLocal: false, url: null }
  : !url || !browserKey
    ? {
        configured: false,
        error: "Både VITE_SUPABASE_URL och VITE_SUPABASE_PUBLISHABLE_KEY måste anges.",
        isLocal: parsedUrl.isLocal,
        url: url ?? null
      }
    : !parsedUrl.valid
      ? {
          configured: false,
          error: "Supabase-adressen måste använda HTTPS, eller HTTP vid lokal utveckling.",
          isLocal: parsedUrl.isLocal,
          url
        }
      : { configured: true, error: null, isLocal: parsedUrl.isLocal, url };

export const supabase: SupabaseClient<Database> | null = supabaseConfiguration.configured && url && browserKey
  ? createClient<Database>(url, browserKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export const supabaseConfigured = supabase !== null;
