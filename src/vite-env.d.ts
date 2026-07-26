/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Development-only compatibility with the local Supabase CLI key name. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Enables seeded-user sign-in only for the explicit local no-login mode. */
  readonly VITE_DEV_AUTO_LOGIN?: string;
  readonly VITE_DEV_AUTO_LOGIN_EMAIL?: string;
  readonly VITE_DEV_AUTO_LOGIN_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
