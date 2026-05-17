// fallow-ignore-file unresolved-import
import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
    "apps/server/src/{artwork,auth,catalog,home,media,notifications,preferences,plugin-runtime}/**/*.ts":
      "bun tools/check-file-sizes.ts",
    "apps/server/src/{db/schema,artwork,auth,catalog,home,media,notifications,preferences,plugin-runtime}/**/*.ts":
      "bun tools/check-table-ownership.ts",
  },
  fmt: {
    ignorePatterns: [
      "dist/**",
      "**/*.gen.{ts,tsx}",
      ".claude/**",
      ".agents/**",
      "SPEC.md",
      "docs/**",
      "plan/**",
    ],
    options: { typeAware: true, typeCheck: true },
  },
  lint: {
    // tools/ scripts run via bun and have no tsconfig context — vp staged
    // invokes vp check on individual staged files where oxc-resolver loses
    // node-types resolution. Whole-project lint still catches real issues.
    ignorePatterns: ["dist/**", "docs/**", "plan/**", ".claude/**", ".agents/**", "tools/**"],
    options: { typeAware: true, typeCheck: true },
  },
  // The client uses an "@/" path alias defined in apps/client/vite.config.ts.
  // When tests are run from the repo root the per-package config is not picked
  // up, so re-declare the alias here so client tests can import "@/..." paths.
  resolve: {
    alias: {
      "@/app": new URL("./apps/client/src/app", import.meta.url).pathname,
      "@/features": new URL("./apps/client/src/features", import.meta.url).pathname,
      "@/shared": new URL("./apps/client/src/shared", import.meta.url).pathname,
      "@/routes": new URL("./apps/client/src/routes", import.meta.url).pathname,
      "@": new URL("./apps/client/src", import.meta.url).pathname,
    },
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Stale agent worktrees mirror the source tree but with branch-local
      // copies; vitest must not pick them up when running from the root.
      ".claude/worktrees/**",
    ],
  },
});
