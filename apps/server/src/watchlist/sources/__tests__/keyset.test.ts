import { describe, expect, it } from "vite-plus/test";
import { decodeKeyset, rawToken } from "../keyset";

// `decodeKeyset` is the single parse point for the watchlist keyset hop
// position; rejecting unusable input here keeps the DB query honest. Bad
// cursors must return `undefined` so the source resumes from the first page
// instead of issuing a query that can never match a real row.
describe("decodeKeyset", () => {
  it("returns the parsed hop position for a well-formed keyset cursor", () => {
    expect(decodeKeyset({ mode: "keyset", k: "1700000000000:abc" })).toEqual({
      addedAt: 1_700_000_000_000,
      id: "abc",
    });
  });

  it("returns undefined for a null or offset cursor", () => {
    expect(decodeKeyset(null)).toBeUndefined();
    expect(decodeKeyset({ mode: "offset", n: 0 })).toBeUndefined();
  });

  it("returns undefined when the colon separator is missing", () => {
    expect(decodeKeyset({ mode: "keyset", k: "no-separator" })).toBeUndefined();
  });

  it("returns undefined when addedAt is not finite", () => {
    expect(decodeKeyset({ mode: "keyset", k: "NaN:abc" })).toBeUndefined();
    expect(decodeKeyset({ mode: "keyset", k: "Infinity:abc" })).toBeUndefined();
  });

  // `Number.isFinite(-1)` is `true`, so without the explicit `< 0` guard a
  // negative `addedAt` would otherwise pass and flow into the DB query — no
  // rows match (epochs are non-negative), so the page silently empties.
  it("returns undefined when addedAt is negative", () => {
    expect(decodeKeyset({ mode: "keyset", k: "-1:abc" })).toBeUndefined();
  });

  it("returns undefined when the id segment is empty", () => {
    expect(decodeKeyset({ mode: "keyset", k: "42:" })).toBeUndefined();
  });
});

describe("rawToken", () => {
  it("encodes the addedAt:id resume position from an active row", () => {
    expect(
      rawToken({
        id: "abc",
        userId: "u1",
        tmdbId: "1",
        mediaType: "movie",
        state: "active",
        source: "manual",
        addedAt: 42,
        removedAt: null,
        seeded: false,
      }),
    ).toBe("42:abc");
  });
});
