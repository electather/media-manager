// Augment the vite-plus/test Assertion interface with jest-dom matchers so
// that TypeScript accepts .toBeInTheDocument() and related assertions.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vite-plus/test" {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
