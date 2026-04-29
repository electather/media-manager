import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  envDir: "../../",
  resolve: {
    alias: {
      "@/app": new URL("./src/app", import.meta.url).pathname,
      "@/features": new URL("./src/features", import.meta.url).pathname,
      "@/shared": new URL("./src/shared", import.meta.url).pathname,
      "@/routes": new URL("./src/routes", import.meta.url).pathname,
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  server: {
    allowedHosts: ["example-businesses-rated-stayed.trycloudflare.com"],
    proxy: {
      "/api": "http://localhost:3000",
      "/mcp": "http://localhost:3000",
      "/.well-known": "http://localhost:3000",
    },
  },
});
