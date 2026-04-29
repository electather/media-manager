import { describe, expect, it } from "vite-plus/test";

import { parseCompactId } from "../lib/parse-id";

describe("parseCompactId", () => {
  it("parses movie id", () => {
    expect(parseCompactId("movie:550")).toEqual({ mediaType: "movie", tmdbId: "550" });
  });

  it("parses tv id", () => {
    expect(parseCompactId("tv:1396")).toEqual({ mediaType: "tv", tmdbId: "1396" });
  });

  it("rejects malformed inputs", () => {
    expect(parseCompactId("foo:1")).toBeNull();
    expect(parseCompactId("movie:")).toBeNull();
    expect(parseCompactId(":1")).toBeNull();
    expect(parseCompactId("movie")).toBeNull();
    expect(parseCompactId("")).toBeNull();
  });
});
