import { describe, expect, it } from "vite-plus/test";

import { HOST_ERROR_CODES, severityFor } from "@ent-mcp/shared/errors";

describe("severityFor", () => {
  it("returns the registered severity for known codes", () => {
    expect(severityFor("plugin.input_invalid")).toBe("info");
    expect(severityFor("plugin.bad_credentials")).toBe("info");
    expect(severityFor("plugin.output_invalid")).toBe("warning");
    expect(severityFor("plugin.upstream_error")).toBe("error");
    expect(severityFor("http.internal_error")).toBe("error");
  });

  it("defaults unknown codes to error", () => {
    // Plugin-namespaced codes (`plugin.<id>.<code>`) and typos alike fall
    // through to the error default, so we over-capture rather than silently
    // drop an unexpected throw.
    expect(severityFor("plugin.trakt.some_custom_code")).toBe("error");
    expect(severityFor("definitely.not.a.code")).toBe("error");
    expect(severityFor("")).toBe("error");
  });
});

describe("HOST_ERROR_CODES", () => {
  it("assigns a severity to every registered code", () => {
    for (const [code, spec] of Object.entries(HOST_ERROR_CODES) as Array<
      [string, { severity: string }]
    >) {
      expect(["error", "warning", "info"]).toContain(spec.severity);
      expect(code).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
    }
  });
});
