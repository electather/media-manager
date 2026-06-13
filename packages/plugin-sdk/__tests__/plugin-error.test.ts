import { describe, it, expect } from "vite-plus/test";
import { pluginError, toErrorMessage } from "@nama/plugin-sdk";

describe("pluginError", () => {
  it("returns an Error instance", () => {
    const err = pluginError("plugin.bad_credentials", "test message");
    expect(err).toBeInstanceOf(Error);
  });

  it("sets the error name to PluginError", () => {
    const err = pluginError("plugin.rate_limited", "msg");
    expect(err.name).toBe("PluginError");
  });

  it("sets the error message", () => {
    const err = pluginError("plugin.item_not_found", "not found");
    expect(err.message).toBe("not found");
  });

  it("attaches the host error code", () => {
    const err = pluginError("plugin.upstream_error", "server down") as Error & {
      code: string;
    };
    expect(err.code).toBe("plugin.upstream_error");
  });

  it("preserves distinct codes on different errors", () => {
    const a = pluginError("plugin.bad_credentials", "a") as Error & { code: string };
    const b = pluginError("plugin.token_expired", "b") as Error & { code: string };
    expect(a.code).toBe("plugin.bad_credentials");
    expect(b.code).toBe("plugin.token_expired");
  });
});

describe("toErrorMessage", () => {
  it("returns the message property for Error instances", () => {
    const err = new Error("something went wrong");
    expect(toErrorMessage(err)).toBe("something went wrong");
  });

  it("stringifies non-Error values", () => {
    expect(toErrorMessage("raw string")).toBe("raw string");
    expect(toErrorMessage(42)).toBe("42");
    expect(toErrorMessage(null)).toBe("null");
    expect(toErrorMessage(undefined)).toBe("undefined");
  });

  it("handles objects by calling toString", () => {
    expect(toErrorMessage({ toString: () => "obj" })).toBe("obj");
  });
});
