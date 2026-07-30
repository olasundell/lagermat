import tailwindcss from "@tailwindcss/vite";
import netlify from "@netlify/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const NETLIFY_LOCAL_ENVIRONMENT = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
] as const;

export default defineConfig(({ mode }) => {
  // Vite loads these values for browser code, while the Netlify emulator reads
  // its function environment from the process. Copy only the public Supabase
  // values needed by the local function runtime.
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
