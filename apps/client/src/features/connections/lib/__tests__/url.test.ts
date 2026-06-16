import { describe, expect, it } from "vite-plus/test";

import { isSafeAuthUrl } from "../url";

describe("isSafeAuthUrl", () => {
  it("accepts an https URL", () => {
    expect(isSafeAuthUrl("https://plex.tv/link")).toBe(true);
  });

  it("rejects an http URL to prevent protocol-downgrade attacks", () => {
    // An http URL from a buggy or compromised plugin must not become a
    // navigation — the guard is the only client-side line of defence.
    expect(isSafeAuthUrl("http://plex.tv/link")).toBe(false);
  });

  it("rejects a javascript: URL", () => {
    expect(isSafeAuthUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects a data: URL", () => {
    expect(isSafeAuthUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isSafeAuthUrl("")).toBe(false);
  });

  it("rejects a relative path", () => {
    expect(isSafeAuthUrl("/oauth/callback")).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(isSafeAuthUrl("not a url at all")).toBe(false);
  });
});
