import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["dist/**", "**/*.gen.{ts,tsx}", ".claude/**"],
    options: { typeAware: true, typeCheck: true },
  },
  lint: {
    ignorePatterns: ["dist/**", ".claude/**"],
    options: { typeAware: true, typeCheck: true },
  },
  // The client uses an "@/" path alias defined in apps/client/vite.config.ts.
  // When tests are run from the repo root the per-package config is not picked
  // up, so re-declare the alias here so client tests can import "@/..." paths.
  resolve: {
    alias: {
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
