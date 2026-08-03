import tailwindcss from "@tailwindcss/vite";
import netlify from "@netlify/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const NETLIFY_LOCAL_ENVIRONMENT = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
  // Copied only into the local Netlify function process. Vite exposes browser
  // variables exclusively through the VITE_ prefix, so this remains server-only.
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "LOCAL_ICA_CATALOGUE_FIXTURE",
] as const;

export default defineConfig(({ mode }) => {
  // Vite loads these values from local env files, while the Netlify emulator
  // reads its function environment from the process. Non-VITE_ secrets copied
  // here remain server-only; Vite never exposes them to browser modules. The
  // ICA fixture flag is an explicit local opt-in, and the handler rejects it
  // against a hosted Supabase URL.
  const loadedEnvironment = loadEnv(mode, process.cwd(), "");
  for (const variableName of NETLIFY_LOCAL_ENVIRONMENT) {
    const value = loadedEnvironment[variableName];
    if (value && !process.env[variableName]) {
      process.env[variableName] = value;
    }
  }

  return {
    plugins: [
      netlify(),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "prompt",
        includeAssets: [
          "lagermat-mark.svg",
          "lagermat-icon-192.png",
          "lagermat-icon-512.png",
          "lagermat-icon-maskable-512.png",
          "apple-touch-icon.png"
        ],
        manifest: {
          name: "Lägermat",
          short_name: "Lägermat",
          description: "Säker lägermatplanering för scoutkårer.",
          lang: "sv",
          start_url: "/",
          display: "standalone",
          background_color: "#ffffff",
          theme_color: "#003660",
          icons: [
            { src: "/lagermat-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/lagermat-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/lagermat-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
          ]
        },
        workbox: {
          cleanupOutdatedCaches: true,
          globPatterns: ["**/*.{js,css,html,woff,woff2,svg,png}"],
          navigateFallback: "/index.html",
          runtimeCaching: []
        },
        devOptions: {
          enabled: true,
          type: "module"
        }
      })
    ],
    server: {
      host: "127.0.0.1",
      port: 5179,
      strictPort: true
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true
    }
  };
});
