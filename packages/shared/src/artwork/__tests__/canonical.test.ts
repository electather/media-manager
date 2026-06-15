import { describe, expect, it } from "vite-plus/test";
import { canonicalArtworkKey, countCanonicalArtwork } from "../canonical";

describe("canonicalArtworkKey", () => {
  it("collapses items pointing at the same title regardless of id subset", () => {
    // The contract: two rows referencing the same logical title must pay one
    // dispatch. Keying on the full id subset broke that — these two used to
    // produce different keys and double-charge the rate limiter.
    const a = canonicalArtworkKey({ tmdb: "550" }, "movie");
    const b = canonicalArtworkKey({ tmdb: "550", imdb: "tt1" }, "movie");
    expect(a).toBe(b);
  });

  it("prefers tmdb over imdb over tvdb", () => {
    expect(canonicalArtworkKey({ tmdb: "550", imdb: "tt1", tvdb: "9" }, "movie")).toBe(
      "movie|tmdb:550",
    );
    expect(canonicalArtworkKey({ imdb: "tt1", tvdb: "9" }, "movie")).toBe("movie|imdb:tt1");
    expect(canonicalArtworkKey({ tvdb: "9" }, "tv")).toBe("tv|tvdb:9");
  });

  it("separates the same id under different media types", () => {
    expect(canonicalArtworkKey({ tmdb: "1" }, "movie")).not.toBe(
      canonicalArtworkKey({ tmdb: "1" }, "tv"),
    );
  });

  it("falls back to a type-only key when no id is present", () => {
    expect(canonicalArtworkKey({}, "movie")).toBe("movie");
  });
});

describe("countCanonicalArtwork", () => {
  it("counts unique titles, not request rows", () => {
    expect(
      countCanonicalArtwork([
        { ids: { tmdb: "550" }, type: "movie" },
        { ids: { tmdb: "550", imdb: "tt1" }, type: "movie" },
        { ids: { tmdb: "1396" }, type: "tv" },
      ]),
    ).toBe(2);
  });

  it("never returns less than one", () => {
    expect(countCanonicalArtwork([])).toBe(1);
  });
});
