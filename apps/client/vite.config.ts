import { readFileSync } from "node:fs";
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";

const clientPkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};
const sharedPkg = JSON.parse(
  readFileSync(new URL("../../packages/shared/package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(clientPkg.version),
    "import.meta.env.VITE_SHARED_VERSION": JSON.stringify(sharedPkg.version),
  },
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      strategy: ["localStorage", "preferredLanguage", "baseLocale"],
      emitTsDeclarations: true,
    }),
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
