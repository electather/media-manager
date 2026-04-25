import { describe, it, expect } from "vite-plus/test";
import { PluginError } from "@ent-mcp/plugin-sdk";
import { normalizeError, PluginCallError } from "../errors";

describe("normalizeError", () => {
  it("preserves HostErrorCode from PluginError", () => {
    const err = new PluginError("plugin.item_not_found", "nope");
    expect(normalizeError(err)).toEqual({ code: "plugin.item_not_found", devMessage: "nope" });
  });

  it("reports AbortError as plugin.timeout", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(normalizeError(err)).toEqual({ code: "plugin.timeout", devMessage: "aborted" });
  });

  it("falls back to plugin.upstream_error for generic errors", () => {
    expect(normalizeError(new Error("kaboom"))).toEqual({
      code: "plugin.upstream_error",
      devMessage: "kaboom",
    });
  });

  it("coerces non-Error values to a string devMessage", () => {
    expect(normalizeError("oops")).toEqual({ code: "plugin.upstream_error", devMessage: "oops" });
  });
});

describe("PluginCallError", () => {
  it("carries the code, plugin id, and connection id", () => {
    const err = new PluginCallError("plugin.bad_credentials", "nope", "tmdb", "conn-1");
    expect(err.code).toBe("plugin.bad_credentials");
    expect(err.pluginId).toBe("tmdb");
    expect(err.connectionId).toBe("conn-1");
    expect(err.name).toBe("PluginCallError");
    expect(err).toBeInstanceOf(Error);
  });
});
