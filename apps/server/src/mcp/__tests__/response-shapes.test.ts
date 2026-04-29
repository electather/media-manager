import { describe, expect, it } from "vite-plus/test";
import { compactMediaItem, compactList } from "../response-shapes";

const base = {
  id: "tt0120338",
  title: "Titanic",
  year: 1997,
  type: "movie" as const,
  genres: ["Drama", "Romance"],
  rating: 7.934,
  overview: "A couple fall in love aboard a doomed ship.",
  posterUrl: "https://example.com/poster.jpg",
  ids: { tmdb: "597" },
};

describe("compactMediaItem", () => {
  it("maps a plain MediaItemShape to the compact surface", () => {
    const result = compactMediaItem(base);
    expect(result.id).toBe("tt0120338");
    expect(result.title).toBe("Titanic");
    expect(result.year).toBe(1997);
    expect(result.type).toBe("movie");
    expect(result.poster).toBe("https://example.com/poster.jpg");
  });

  it("unwraps a { item } wrapper transparently", () => {
    const result = compactMediaItem({ item: base });
    expect(result.id).toBe("tt0120338");
    expect(result.title).toBe("Titanic");
  });

  it("rounds rating to one decimal place", () => {
    const result = compactMediaItem({ ...base, rating: 7.934 });
    expect(result.rating).toBe(7.9);
  });

  it("truncates overview at 400 chars and appends ellipsis", () => {
    const long = "x".repeat(450);
    const result = compactMediaItem({ ...base, overview: long });
    expect(result.overview).toHaveLength(401);
    expect(result.overview?.endsWith("…")).toBe(true);
  });

  it("keeps overview verbatim when within limit", () => {
    const result = compactMediaItem(base);
    expect(result.overview).toBe("A couple fall in love aboard a doomed ship.");
  });

  it("caps genres at 6 entries", () => {
    const genres = ["A", "B", "C", "D", "E", "F", "G"];
    const result = compactMediaItem({ ...base, genres });
    expect(result.genres).toHaveLength(6);
  });

  it("omits genres when the array is empty", () => {
    const result = compactMediaItem({ ...base, genres: [] });
    expect(result.genres).toBeUndefined();
  });

  it("omits poster when posterUrl is absent", () => {
    const result = compactMediaItem({ ...base, posterUrl: null });
    expect(result.poster).toBeUndefined();
  });

  it("omits rating when not a number", () => {
    const result = compactMediaItem({ ...base, rating: null });
    expect(result.rating).toBeUndefined();
  });

  it("sets status from options, omitting 'unknown'", () => {
    const available = compactMediaItem(base, { status: "available" });
    expect(available.status).toBe("available");

    const unknown = compactMediaItem(base, { status: "unknown" });
    expect(unknown.status).toBeUndefined();
  });

  it("sets user_rated from options when positive", () => {
    const result = compactMediaItem(base, { userRated: 8 });
    expect(result.user_rated).toBe(8);
  });

  it("omits user_rated when 0 or negative", () => {
    expect(compactMediaItem(base, { userRated: 0 }).user_rated).toBeUndefined();
    expect(compactMediaItem(base, { userRated: -1 }).user_rated).toBeUndefined();
  });

  it("sets match_reason from options", () => {
    const result = compactMediaItem(base, { matchReason: "genre match" });
    expect(result.match_reason).toBe("genre match");
  });

  it("omits match_reason when empty string", () => {
    const result = compactMediaItem(base, { matchReason: "" });
    expect(result.match_reason).toBeUndefined();
  });

  it("returns a safe fallback for completely unknown input", () => {
    const result = compactMediaItem(null);
    expect(result.id).toBe("");
    expect(result.title).toBe("");
    expect(result.type).toBe("movie");
  });

  it("returns a safe fallback for an unrecognised object", () => {
    const result = compactMediaItem({ foo: "bar" });
    expect(result.id).toBe("");
  });
});

describe("compactList", () => {
  const items = [
    { ...base, id: "1", title: "One" },
    { ...base, id: "2", title: "Two" },
    { ...base, id: "3", title: "Three" },
  ];

  it("maps all items when no limit is given", () => {
    const result = compactList(items);
    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe("1");
    expect(result[2]!.id).toBe("3");
  });

  it("respects the limit cap", () => {
    const result = compactList(items, undefined, 2);
    expect(result).toHaveLength(2);
  });

  it("passes metaFor options to each item", () => {
    const result = compactList(items, (i) => ({ status: i === 0 ? "available" : "unavailable" }));
    expect(result[0]!.status).toBe("available");
    expect(result[1]!.status).toBe("unavailable");
  });

  it("skips rows that produce an empty id", () => {
    const mixed = [{ ...base, id: "valid" }, { foo: "no-id" }, { ...base, id: "also-valid" }];
    const result = compactList(mixed);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(["valid", "also-valid"]);
  });

  it("handles { item } wrappers within the list", () => {
    const wrapped = items.map((item) => ({ item }));
    const result = compactList(wrapped);
    expect(result).toHaveLength(3);
    expect(result[1]!.title).toBe("Two");
  });

  it("returns an empty array for an empty input", () => {
    expect(compactList([])).toEqual([]);
  });
});
