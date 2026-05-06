import { describe, expect, it } from "vite-plus/test";
import { buildCompositeId, splitCompositeId } from "../media-id";

describe("buildCompositeId", () => {
  it("joins media type and slug with a colon", () => {
    expect(buildCompositeId("movie", "n-aurora")).toBe("movie:n-aurora");
    expect(buildCompositeId("tv", "n-portal")).toBe("tv:n-portal");
  });
});

describe("splitCompositeId", () => {
  it("parses valid composite ids", () => {
    expect(splitCompositeId("movie:n-aurora")).toEqual({
      mediaType: "movie",
      mediaId: "n-aurora",
    });
    expect(splitCompositeId("tv:n-portal")).toEqual({ mediaType: "tv", mediaId: "n-portal" });
  });

  it("returns null when the colon separator is missing", () => {
    expect(splitCompositeId("movien-aurora")).toBeNull();
  });

  it("returns null for unknown media types", () => {
    expect(splitCompositeId("podcast:foo")).toBeNull();
  });

  it("returns null when the slug is empty", () => {
    expect(splitCompositeId("movie:")).toBeNull();
  });

  it("preserves later colons in the slug", () => {
    expect(splitCompositeId("movie:foo:bar")).toEqual({ mediaType: "movie", mediaId: "foo:bar" });
  });
});
