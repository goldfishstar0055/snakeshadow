import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/snakeshadow/",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname === "docs.google.com" ||
              url.hostname === "api.open-meteo.com" ||
              url.hostname.endsWith("arcgis.com"),
            handler: "NetworkOnly",
          },
        ],
      },
      manifest: {
        name: "ヘビ日陰マップ",
        short_name: "ヘビ日陰マップ",
        description: "ヘビの出ない日陰で過ごすための3Dマップ",
        theme_color: "#2563eb",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/snakeshadow/",
        scope: "/snakeshadow/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
    }),
  ],
});
