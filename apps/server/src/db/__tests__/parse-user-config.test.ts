import { describe, it, expect, vi } from "vite-plus/test";
import { consola } from "consola";

// `../queries` pulls in `../client` -> `../env`, which validates real env vars
// on import. Stub them so this pure-function test doesn't require a full env.
vi.mock("../../env", () => ({
  env: {
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost",
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

const { parseUserConfig } = await import("../queries");

// `serviceConnections.userConfig` is read by five production paths: the
// connections list/get, media dispatch, targeted dispatch, plugin jobs, and MCP
// calls. A single corrupt row must NOT throw a SyntaxError that 500s those
// workflows — it must degrade to null (the same value an unset userConfig
// yields) while still surfacing the data-integrity signal to operators.

describe("parseUserConfig", () => {
  it("returns null for missing values so unset configs behave the same as empty", () => {
    expect(parseUserConfig(null)).toBeNull();
    expect(parseUserConfig(undefined)).toBeNull();
    expect(parseUserConfig("")).toBeNull();
  });

  it("parses well-formed JSON into the stored object", () => {
    expect(parseUserConfig('{"libraryId":"abc","enabled":true}')).toEqual({
      libraryId: "abc",
      enabled: true,
    });
  });

  it("degrades a corrupt row to null instead of throwing", () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
    try {
      // Use a distinct blob so the dedupe Set does not suppress this warning.
      expect(() => parseUserConfig("{corrupt:a")).not.toThrow();
      expect(parseUserConfig("{corrupt:a")).toBeNull();
      // The corrupt row must be logged so operators can locate it.
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("logs the owning connection id so operators can locate the corrupt row", () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
    try {
      // Use a distinct blob so the dedupe Set does not suppress this warning.
      parseUserConfig("{corrupt:b", "conn-123");
      expect(warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ connectionId: "conn-123" }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("never logs the raw userConfig content, since x-private fields are plaintext", () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
    try {
      // A plaintext x-private secret embedded in a corrupt blob must not leak.
      // Use a distinct blob so the dedupe Set does not suppress this warning.
      const secret = "super-secret-internal-api-key";
      parseUserConfig(`{${secret}-c`, "conn-123");
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain(secret);
      // A length + content hash is logged instead, enough to tell rows apart.
      expect(warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ fingerprint: expect.stringContaining("sha256=") }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("only warns once per distinct corrupt fingerprint across repeated calls", () => {
    // Hot read paths may hit the same corrupt row on every request. The dedupe
    // guard must suppress subsequent warnings so a busy instance does not flood
    // the operator log with identical entries.
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
    try {
      // Use a distinct blob so earlier tests do not interfere with the count.
      const blob = "{corrupt:dedupe-unique-sentinel";
      parseUserConfig(blob);
      parseUserConfig(blob);
      parseUserConfig(blob);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
