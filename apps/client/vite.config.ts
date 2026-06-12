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

/** Moves every emitted `.map` file out of the served `dist/` tree into a
 *  sibling `dist-sourcemaps/` directory after the build completes.
 *
 *  `build.sourcemap: "hidden"` only strips the `sourceMappingURL` comment; the
 *  `.map` files are still written next to each bundle. Both deploy targets serve
 *  `dist/` verbatim — the Hono `serveStatic` root and the Cloudflare `[assets]`
 *  directory — so leaving the maps there would let anyone fetch
 *  `index-<hash>.js.map` and recover the original sources, defeating the
 *  "private diagnostics input" design. Relocating them keeps the maps on disk
 *  for the CI upload step while ensuring they are never served. */
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
