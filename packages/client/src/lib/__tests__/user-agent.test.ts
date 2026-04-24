import { describe, expect, it } from "vite-plus/test";

import { parseUserAgent } from "../user-agent";

describe("parseUserAgent", () => {
  it("returns 'Unknown device' when the user-agent is null or empty", () => {
    expect(parseUserAgent(null)).toEqual({
      label: "Unknown device",
      browser: null,
      os: null,
      unknown: true,
    });
    expect(parseUserAgent(undefined)).toMatchObject({ label: "Unknown device", unknown: true });
    expect(parseUserAgent("")).toMatchObject({ label: "Unknown device", unknown: true });
  });

  it("formats Chrome on macOS with major version", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    const result = parseUserAgent(ua);
    expect(result.unknown).toBe(false);
    expect(result.browser).toBe("Chrome");
    expect(result.os).toBe("macOS");
    expect(result.label).toBe("Chrome 120 on macOS");
  });

  it("uses the OS alone when no browser is parsed", () => {
    // A Linux container with no browser part still gives us an OS hint.
    const result = parseUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    expect(result.unknown).toBe(false);
    expect(result.os).toBe("Linux");
    expect(result.label).toBe("Linux");
  });

  it("returns 'Unknown device' when neither browser nor os parse out", () => {
    expect(parseUserAgent("not-a-real-user-agent-string-1234")).toMatchObject({
      label: "Unknown device",
      unknown: true,
    });
  });
});
