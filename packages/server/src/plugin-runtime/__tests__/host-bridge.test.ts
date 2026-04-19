import { describe, it, expect } from "vite-plus/test";
import { isHostAllowed, TokenBucket } from "../fetch-policy";

describe("isHostAllowed", () => {
  it("matches exact hostnames", () => {
    expect(isHostAllowed("api.trakt.tv", ["api.trakt.tv"])).toBe(true);
    expect(isHostAllowed("other.example.com", ["api.trakt.tv"])).toBe(false);
  });

  it("supports *.domain wildcards", () => {
    expect(isHostAllowed("api.themoviedb.org", ["*.themoviedb.org"])).toBe(true);
    expect(isHostAllowed("image.tmdb.org", ["*.tmdb.org"])).toBe(true);
    expect(isHostAllowed("themoviedb.org", ["*.themoviedb.org"])).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isHostAllowed("API.Trakt.TV", ["api.trakt.tv"])).toBe(true);
  });
});

describe("TokenBucket", () => {
  it("rejects over-capacity consumption", () => {
    const b = new TokenBucket(3, 1);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });

  it("refills over time", async () => {
    const b = new TokenBucket(2, 10); // 10 tokens/sec
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    await new Promise((r) => setTimeout(r, 150));
    expect(b.take()).toBe(true);
  });
});
