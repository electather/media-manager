// fallow-ignore-file unresolved-import
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Plugin } from "vite-plus";
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";

const DIST_DIR = "dist";
const SOURCEMAP_DIR = "dist-sourcemaps";

/** Collects the absolute paths of every `.map` file under `root` (recursively). */
function findSourcemaps(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".map"))
    .map((entry) => join(entry.parentPath, entry.name));
}

// Move emitted .map files from dist/ to dist-sourcemaps/ after build. sourcemap: "hidden"
// only strips the sourceMappingURL comment; files still exist next to bundles. Without
// relocating, maps would be served (defeating "private diagnostics input" design).
function extractSourcemaps(): Plugin {
  return {
    name: "extract-hidden-sourcemaps",
    apply: "build",
    closeBundle() {
      const distRoot = join(process.cwd(), DIST_DIR);
      if (!existsSync(distRoot)) return;
      for (const mapPath of findSourcemaps(distRoot)) {
        const target = join(process.cwd(), SOURCEMAP_DIR, relative(distRoot, mapPath));
        mkdirSync(dirname(target), { recursive: true });
        renameSync(mapPath, target);
      }
    },
  };
}

export default defineConfig({
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
    extractSourcemaps(),
  ],
  envDir: "../../",
  build: {
    // Emit .map files without a sourceMappingURL comment so browsers never fetch
    // them, then `extractSourcemaps` moves them out of the served `dist/` tree
    // into `dist-sourcemaps/`. The maps are uploaded privately to the server
    // diagnostics store and used to resolve minified stack traces; they must
    // never be reachable from the public asset directory.
    sourcemap: "hidden",
  },
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
