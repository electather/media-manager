import { describe, expect, it } from "vite-plus/test";
import { extractFeatures, toCandidateFeatures } from "../features";
import { toCanonicalRow } from "../canonical";

describe("extractFeatures", () => {
  it("dedupes and trims string lists", () => {
    const f = extractFeatures({
      keywords: ["dark", "DARK", "  noir  ", "noir"],
      cast: ["Actor", "", "Actor"],
      director: " David Fincher ",
      writers: [],
      creators: undefined,
    });
    expect(f.keywords).toEqual(["dark", "DARK", "noir"]);
    expect(f.cast).toEqual(["Actor"]);
    expect(f.director).toBe("David Fincher");
    expect(f.writers).toEqual([]);
    expect(f.creators).toEqual([]);
  });

  it("returns null director on blank input", () => {
    expect(extractFeatures({ director: "  " }).director).toBeNull();
    expect(extractFeatures({}).director).toBeNull();
  });
});

describe("toCandidateFeatures", () => {
  it("merges row columns with the features blob", () => {
    const row = toCanonicalRow(
      { tmdbId: "550", type: "movie" },
      {
        title: "Fight Club",
        type: "movie",
        year: 1999,
        runtime: 139,
        genres: ["Drama"],
        keywords: ["dark"],
        cast: ["Edward Norton"],
        director: "David Fincher",
        originalLanguage: "en",
      },
      0,
    );
    const candidate = toCandidateFeatures(row);
    expect(candidate.id).toBe("movie:550");
    expect(candidate.title).toBe("Fight Club");
    expect(candidate.year).toBe(1999);
    expect(candidate.runtime).toBe(139);
    expect(candidate.genres).toEqual(["Drama"]);
    expect(candidate.keywords).toEqual(["dark"]);
    expect(candidate.cast).toEqual(["Edward Norton"]);
    expect(candidate.director).toBe("David Fincher");
    expect(candidate.originalLanguage).toBe("en");
  });

  it("treats missing features blob as empty arrays", () => {
    const row = toCanonicalRow(
      { tmdbId: "1", type: "movie" },
      { title: "x", type: "movie", ids: { tmdb_id: "1" } },
      0,
    );
    const candidate = toCandidateFeatures({ ...row, features: null });
    expect(candidate.keywords).toEqual([]);
    expect(candidate.cast).toEqual([]);
    expect(candidate.director).toBeNull();
  });
});
