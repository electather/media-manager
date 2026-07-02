import { describe, expect, it } from "vite-plus/test";
import type { MatchingServer } from "../types";
import { isRequestEligible } from "../classify";

// #903: requestEligible is the AND of three independently-necessary guards; each
// must independently veto so a regression trips a specific case, not just downstream.
describe("isRequestEligible", () => {
  const server: MatchingServer = { id: "s1", label: "Plex" };

  it("is true only when no local copy, not available, and a request provider exists", () => {
    expect(isRequestEligible([], "unknown", 1)).toBe(true);
  });

  it("is false when a local copy exists (servers.length > 0)", () => {
    expect(isRequestEligible([server], "unknown", 1)).toBe(false);
  });

  it("is false when already available, even with no servers", () => {
    expect(isRequestEligible([], "available", 1)).toBe(false);
  });

  it("is false when no request providers are registered", () => {
    expect(isRequestEligible([], "unknown", 0)).toBe(false);
  });
});
