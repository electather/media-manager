import { describe, it, expect } from "vite-plus/test";
import { resolveCredential } from "@nama/plugin-sdk";

describe("resolveCredential", () => {
  it("returns the primary value when defined", () => {
    expect(resolveCredential("user-key", "global-key", "missing")).toBe("user-key");
  });

  it("returns the fallback when primary is undefined", () => {
    expect(resolveCredential(undefined, "global-key", "missing")).toBe("global-key");
  });

  it("throws when both primary and fallback are undefined", () => {
    expect(() => resolveCredential(undefined, undefined, "no key found")).toThrow();
  });

  it("throws a PluginError with bad_credentials code", () => {
    try {
      resolveCredential(undefined, undefined, "no key");
    } catch (err) {
      expect((err as Error & { code: string }).code).toBe("plugin.bad_credentials");
      expect((err as Error).name).toBe("PluginError");
    }
  });

  it("includes the error message in the thrown error", () => {
    try {
      resolveCredential(undefined, undefined, "api key required");
    } catch (err) {
      expect((err as Error).message).toBe("api key required");
    }
  });

  it("prefers primary over fallback even when fallback is also defined", () => {
    expect(resolveCredential("personal", "shared", "err")).toBe("personal");
  });
});
