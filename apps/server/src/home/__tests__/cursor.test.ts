import { describe, it, expect } from "vite-plus/test";
import { decodeCursor, encodeCursor } from "../cursor";

/**
 * Cursors are untrusted client input. The codec is the only place that
 * decides whether a cursor reaches business logic, so its tests cover both
 * the happy path (round-trip every variant) and every rejection path the
 * design enumerates.
 */
describe("home cursor codec", () => {
  it("round-trips an offset cursor", () => {
    const encoded = encodeCursor("continueWatching", {
      v: 1,
      r: "continueWatching",
      o: 40,
    });
    const decoded = decodeCursor("continueWatching", encoded);
    expect(decoded).toEqual({ v: 1, r: "continueWatching", o: 40 });
  });

  it("round-trips a page cursor", () => {
    const encoded = encodeCursor("trendingNow", { v: 1, r: "trendingNow", p: 2 });
    expect(decodeCursor("trendingNow", encoded)).toEqual({ v: 1, r: "trendingNow", p: 2 });
  });

  it("round-trips a page+seed cursor", () => {
    const encoded = encodeCursor("becauseYouWatched", {
      v: 1,
      r: "becauseYouWatched",
      p: 1,
      s: "movie:550",
    });
    expect(decodeCursor("becauseYouWatched", encoded)).toEqual({
      v: 1,
      r: "becauseYouWatched",
      p: 1,
      s: "movie:550",
    });
  });

  it("round-trips a page+exclusion cursor", () => {
    const ids = ["movie:550", "tv:1396", "movie:24428"];
    const encoded = encodeCursor("recommendedForYou", {
      v: 1,
      r: "recommendedForYou",
      p: 2,
      x: ids,
    });
    const decoded = decodeCursor("recommendedForYou", encoded);
    expect("x" in decoded ? decoded.x : null).toEqual(ids);
  });

  it("round-trips a page+profileVersion cursor", () => {
    const encoded = encodeCursor("recommendedForYou", {
      v: 1,
      r: "recommendedForYou",
      p: 2,
      pv: 7,
    });
    const decoded = decodeCursor("recommendedForYou", encoded);
    expect("pv" in decoded ? decoded.pv : null).toBe(7);
  });

  it("round-trips an afterTmdbId cursor", () => {
    const encoded = encodeCursor("upcomingForYou", {
      v: 1,
      r: "upcomingForYou",
      a: "tv:1396",
      ts: 1_713_820_000_000,
    });
    expect(decodeCursor("upcomingForYou", encoded).ts).toBe(1_713_820_000_000);
  });

  it("rejects malformed base64", () => {
    expect(() => decodeCursor("trendingNow", "!!!not-base64!!!")).toThrow(/cursor/);
  });

  it("rejects rowId mismatch between request and cursor", () => {
    const encoded = encodeCursor("trendingNow", { v: 1, r: "trendingNow", p: 1 });
    expect(() => decodeCursor("newReleases", encoded)).toThrow(/does not match/);
  });

  it("rejects extra keys (strict parsing)", () => {
    const malformed = Buffer.from(
      JSON.stringify({ v: 1, r: "trendingNow", p: 1, extra: "boom" }),
    ).toString("base64url");
    expect(() => decodeCursor("trendingNow", malformed)).toThrow();
  });

  it("rejects an exclusion list larger than the cap on decode", () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => `movie:${i}`);
    const malformed = Buffer.from(
      JSON.stringify({ v: 1, r: "recommendedForYou", p: 0, x: ids }),
    ).toString("base64url");
    expect(() => decodeCursor("recommendedForYou", malformed)).toThrow();
  });

  it("refuses to encode an exclusion list larger than the cap", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `movie:${i}`);
    expect(() =>
      encodeCursor("recommendedForYou", { v: 1, r: "recommendedForYou", p: 0, x: ids }),
    ).toThrow(/cursor encode/);
  });

  it("rejects upcomingForYou cursor missing ts", () => {
    const malformed = Buffer.from(
      JSON.stringify({ v: 1, r: "upcomingForYou", a: "tv:1" }),
    ).toString("base64url");
    expect(() => decodeCursor("upcomingForYou", malformed)).toThrow();
  });

  it("rejects becauseYouWatched cursor missing s", () => {
    const malformed = Buffer.from(JSON.stringify({ v: 1, r: "becauseYouWatched", p: 1 })).toString(
      "base64url",
    );
    expect(() => decodeCursor("becauseYouWatched", malformed)).toThrow();
  });

  it("rejects becauseYouWatched cursor with malformed seed id", () => {
    const malformed = Buffer.from(
      JSON.stringify({ v: 1, r: "becauseYouWatched", p: 1, s: "not-a-media-id" }),
    ).toString("base64url");
    expect(() => decodeCursor("becauseYouWatched", malformed)).toThrow();
  });

  it("preserves seed pin when scrolling becauseYouWatched", () => {
    // Page 1 (layout-synthesised), then page 2 (client echo). The seed
    // remains pinned even if the live signal shifts mid-session.
    const page1 = encodeCursor("becauseYouWatched", {
      v: 1,
      r: "becauseYouWatched",
      p: 1,
      s: "movie:550",
    });
    const decoded1 = decodeCursor("becauseYouWatched", page1);
    const page2 = encodeCursor("becauseYouWatched", {
      v: 1,
      r: "becauseYouWatched",
      p: decoded1.p + 1,
      s: decoded1.s,
    });
    expect(decodeCursor("becauseYouWatched", page2).s).toBe("movie:550");
  });
});
