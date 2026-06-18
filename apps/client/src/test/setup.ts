// fallow-ignore-file unused-file
// Extend Vitest's expect with jest-dom matchers (e.g. toBeInTheDocument).
// Import matchers directly and extend via vite-plus/test to avoid the
// `@testing-library/jest-dom/vitest` entry's hard dependency on the "vitest"
// package name, which is re-exported as "vite-plus/test" in this project.
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vite-plus/test";

expect.extend(matchers);
