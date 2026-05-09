import { describe, it, expect } from "vite-plus/test";
import { isSdkCompatible, SDK_VERSION } from "@ent-mcp/plugin-sdk";

describe("SDK_VERSION", () => {
  it("is a semver string", () => {
    // Guards the build-time `__SDK_VERSION__` substitution: any value that
    // isn't a real semver here is a regression in the bundle step or in the
    // dev-mode literal.
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });
});

describe("isSdkCompatible", () => {
  it("accepts a non-empty range string (current pre-1.0 behaviour)", () => {
    expect(isSdkCompatible("^1.0.0")).toBe(true);
  });

  it("accepts an arbitrary non-empty string", () => {
    expect(isSdkCompatible("anything")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isSdkCompatible("")).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    expect(isSdkCompatible("   ")).toBe(false);
    expect(isSdkCompatible("\t\n")).toBe(false);
  });

  it("rejects non-string inputs", () => {
    // Plugins authored in plain JS could call this with whatever — the gate
    // is a `typeof === "string"` check, not a TypeScript-only guarantee.
    expect(isSdkCompatible(undefined as unknown as string)).toBe(false);
    expect(isSdkCompatible(null as unknown as string)).toBe(false);
    expect(isSdkCompatible(123 as unknown as string)).toBe(false);
  });
});
