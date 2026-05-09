import { describe, it, expect } from "vite-plus/test";
import { isSdkCompatible, SDK_VERSION } from "@ent-mcp/plugin-sdk";

describe("SDK_VERSION", () => {
  it("is a non-empty string", () => {
    expect(typeof SDK_VERSION).toBe("string");
    expect(SDK_VERSION.length).toBeGreaterThan(0);
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
});
