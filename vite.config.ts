import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icons/*.png", "brand/*.png"],
      manifest: {
        name: "Fire Safety Management", short_name: "Fire Safety", lang: "ar", dir: "rtl",
        start_url: "./", scope: "./", display: "standalone", orientation: "any",
        background_color: "#12302B", theme_color: "#12302B",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "index.html",
        // never cache API / auth responses
        runtimeCaching: [{ urlPattern: ({ url }) => url.hostname.endsWith("supabase.co"), handler: "NetworkOnly" }]
      }
    })
  ],
  test: { environment: "node", include: ["src/**/*.test.ts"] }
} as never);
