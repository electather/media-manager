import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["dist/**", "**/*.gen.{ts,tsx}"],
    options: { typeAware: true, typeCheck: true },
  },
  lint: { ignorePatterns: ["dist/**"], options: { typeAware: true, typeCheck: true } },
  // The client uses an "@/" path alias defined in packages/client/vite.config.ts.
  // When tests are run from the repo root the per-package config is not picked
  // up, so re-declare the alias here so client tests can import "@/..." paths.
  resolve: {
    alias: {
      "@": new URL("./packages/client/src", import.meta.url).pathname,
    },
  },
});
