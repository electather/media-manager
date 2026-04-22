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
});
