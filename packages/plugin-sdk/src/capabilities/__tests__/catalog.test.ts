import { describe, it, expect } from "vite-plus/test";
import { CAPABILITY_CATALOG, capabilityKey, getCapability } from "../index";

describe("capability catalog", () => {
  it("keys by id@version", () => {
    expect(capabilityKey("metadata", "v1")).toBe("metadata@v1");
  });

  it("exposes every v1 capability", () => {
    const keys = Object.keys(CAPABILITY_CATALOG).sort();
    expect(keys).toEqual(
      [
        "artwork@v1",
        "calendar@v1",
        "collection@v1",
        "continueWatching@v1",
        "idResolve@v1",
        "libraryAdmin@v1",
        "libraryAvailability@v1",
        "mediaRequest@v1",
        "metadata@v1",
        "playback@v1",
        "playbackSessions@v1",
        "ratings@v1",
        "recommendations@v1",
        "trailers@v1",
        "userComments@v1",
        "watchHistory@v1",
        "watchlist@v1",
        "watchProviders@v1",
      ].sort(),
    );
  });

  it("returns undefined for unknown versions", () => {
    expect(getCapability("metadata", "v99")).toBeUndefined();
  });
});
