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
      expect(() => parseUserConfig("{not valid json")).not.toThrow();
      expect(parseUserConfig("{not valid json")).toBeNull();
      // The corrupt row must be logged so operators can locate it.
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
