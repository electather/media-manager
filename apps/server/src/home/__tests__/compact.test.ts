import { describe, it, expect } from "vite-plus/test";
import { composeId, parseCompactId, toCompact } from "../compact";

/**
 * `compact.ts` is the single conversion site between plugin shapes and the
 * wire `CompactMediaItem`. The contract: optional fields omitted (not null),
 * top-3 genres only, overview truncated, composite id round-trips.
 */
describe("compact mapper", () => {
  it("composes and parses media ids symmetrically", () => {
    expect(composeId("movie", "550")).toBe("movie:550");
    expect(parseCompactId("movie:550")).toEqual({ mediaType: "movie", tmdbId: "550" });
    expect(parseCompactId("nonsense")).toBeNull();
    expect(parseCompactId("")).toBeNull();
  });

  it("omits absent fields rather than emitting null/undefined; status defaults to 'unknown'", () => {
    const item = toCompact({
      id: "movie:550",
      type: "movie",
      title: "Fight Club",
      ids: { tmdb_id: "550" },
    });
    expect(item).toEqual({
      id: "movie:550",
      tmdbId: "550",
      mediaType: "movie",
      title: "Fight Club",
      status: "unknown",
    });
  });

  it("truncates overview to ~240 characters", () => {
    const long = "x".repeat(400);
    const item = toCompact({
      id: "tv:1",
      type: "tv",
      title: "x",
      overview: long,
      ids: { tmdb_id: "1" },
    });
    expect(item.overview?.length).toBeLessThanOrEqual(240);
    expect(item.overview?.endsWith("…")).toBe(true);
  });

  it("keeps only the first three genres", () => {
    const item = toCompact({
      id: "movie:1",
      type: "movie",
      title: "x",
      genres: ["a", "b", "c", "d", "e"],
      ids: { tmdb_id: "1" },
    });
    expect(item.genres).toEqual(["a", "b", "c"]);
  });

  it("merges extras and skips undefined values", () => {
    const item = toCompact(
      {
        id: "movie:1",
        type: "movie",
        title: "x",
        ids: { tmdb_id: "1" },
      },
      { matchReason: "Similar to Inception", year: undefined },
    );
    expect(item.matchReason).toBe("Similar to Inception");
    expect("year" in item).toBe(false);
  });

  it("throws when the input lacks any tmdb id source", () => {
    expect(() =>
      toCompact({
        id: "garbage",
        type: "movie",
        title: "x",
      }),
    ).toThrow(/tmdb id/);
  });
});
