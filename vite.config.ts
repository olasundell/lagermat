import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
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
    port: 5173,
    strictPort: true
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true
  }
});
