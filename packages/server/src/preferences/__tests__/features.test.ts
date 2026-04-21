import { describe, it, expect } from "vite-plus/test";
import { genresScorer } from "../features/genres";
import { keywordsScorer } from "../features/keywords";
import { peopleScorer } from "../features/people";
import { decadesScorer, decadeFor } from "../features/decades";
import { runtimeScorer, runtimeBucketFor } from "../features/runtime";
import { languagesScorer } from "../features/languages";
import type { CandidateFeatures } from "../types";

function fixture(overrides: Partial<CandidateFeatures> = {}): CandidateFeatures {
  return {
    id: "movie:1",
    type: "movie",
    title: "Example",
    year: 2005,
    runtime: 120,
    genres: ["Thriller", "Crime"],
    keywords: ["Neo-Noir", "Unreliable Narrator"],
    cast: ["Alice", "Bob", "Cara"],
    director: "Dora",
    writers: [],
    creators: [],
    originalLanguage: "en",
    ...overrides,
  };
}

describe("genres extractor", () => {
  it("emits one weight per non-empty genre", () => {
    expect(genresScorer.extract!(fixture())).toEqual({ Thriller: 1, Crime: 1 });
  });
  it("returns empty for missing genres", () => {
    expect(genresScorer.extract!(fixture({ genres: undefined }))).toEqual({});
  });
});

describe("keywords extractor", () => {
  it("lowercases keywords and emits one weight each", () => {
    expect(keywordsScorer.extract!(fixture())).toEqual({
      "neo-noir": 1,
      "unreliable narrator": 1,
    });
  });

  it("filters out structural tags", () => {
    const result = keywordsScorer.extract!(
      fixture({ keywords: ["aftercreditsstinger", "sequel", "Neo-Noir", "Reboot"] }),
    );
    expect(result).toEqual({ "neo-noir": 1 });
  });

  it("filters out tone descriptors", () => {
    const result = keywordsScorer.extract!(
      fixture({ keywords: ["whimsical", "intense", "Unreliable Narrator", "dramatic"] }),
    );
    expect(result).toEqual({ "unreliable narrator": 1 });
  });

  it("passes content keywords alongside filtered ones", () => {
    const result = keywordsScorer.extract!(
      fixture({
        keywords: ["aftercreditsstinger", "heist", "whimsical", "neo-noir", "spin off", "complex"],
      }),
    );
    expect(result).toEqual({ heist: 1, "neo-noir": 1 });
  });
});

describe("people extractor", () => {
  it("prefixes director and actors and caps cast", () => {
    const out = peopleScorer.extract!(
      fixture({ cast: ["A", "B", "C", "D", "E", "F", "G"], director: "Dir" }),
    );
    expect(out).toEqual({
      "Director:Dir": 1,
      "Actor:A": 1,
      "Actor:B": 1,
      "Actor:C": 1,
      "Actor:D": 1,
      "Actor:E": 1,
    });
  });
});

describe("decades extractor", () => {
  it("buckets years to their decade", () => {
    expect(decadeFor(2003)).toBe("2000s");
    expect(decadeFor(1997)).toBe("1990s");
    expect(decadesScorer.extract!(fixture({ year: 1997 }))).toEqual({ "1990s": 1 });
  });
});

describe("runtime extractor", () => {
  it("returns the correct runtime bucket", () => {
    expect(runtimeBucketFor(20)).toBe("short");
    expect(runtimeBucketFor(50)).toBe("medium");
    expect(runtimeBucketFor(120)).toBe("long");
    expect(runtimeBucketFor(180)).toBe("very_long");
    expect(runtimeScorer.extract!(fixture({ runtime: 55 }))).toEqual({ medium: 1 });
  });
});

describe("languages extractor", () => {
  it("lowercases the language code", () => {
    expect(languagesScorer.extract!(fixture({ originalLanguage: "JA" }))).toEqual({ ja: 1 });
  });
});
