import { describe, expect, it } from "vite-plus/test";
import { decode, encode, encodeSeedCursor, type Cursor } from "../cursor";

/**
 * Re-implements the codec's own base64url encoding so a test can mint a
 * *foreign* payload (one the codec would never produce) without leaning on
 * Node `Buffer` — the shared package is isomorphic, so its tests stay
 * runtime-neutral too.
 */
function rawBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function foreignCursor(value: unknown): string {
  return rawBase64Url(JSON.stringify(value));
}

describe("shared media cursor codec", () => {
  it("round-trips a keyset cursor through encode/decode", () => {
    const cursor: Cursor = { mode: "keyset", k: "1700000000000:cuid123" };
    expect(decode(encode(cursor))).toEqual(cursor);
  });

  it("round-trips an offset cursor through encode/decode", () => {
    const cursor: Cursor = { mode: "offset", n: 40 };
    expect(decode(encode(cursor))).toEqual(cursor);
  });

  it("produces an opaque base64url string with no JSON-revealing characters", () => {
    // An opaque wire format must not leak the JSON braces/quotes that would let
    // a client hand-edit the payload, so the cursor is base64url, not raw JSON.
    const encoded = encode({ mode: "offset", n: 7 });
    expect(encoded).not.toMatch(/[{}":+/=]/u);
  });

  // decode NEVER throws and returns null on unusable input (invariant V.CU1) so
  // a malformed or hostile cursor degrades to the consumer's null-cursor path
  // (home → 400, watchlist → first page) instead of crashing the read.
  describe("decode returns null without throwing on bad input", () => {
    it("returns null for non-base64url garbage", () => {
      expect(decode("!!! not base64 !!!")).toBeNull();
    });

    it("returns null for base64url that is not JSON", () => {
      expect(decode(rawBase64Url("plain text, not json{"))).toBeNull();
    });

    it("returns null for valid JSON with a foreign shape (no mode)", () => {
      expect(decode(foreignCursor({ page: 3 }))).toBeNull();
    });

    it("returns null for an unknown mode value", () => {
      expect(decode(foreignCursor({ mode: "scroll", n: 1 }))).toBeNull();
    });

    it("returns null when a keyset cursor is missing its k field", () => {
      expect(decode(foreignCursor({ mode: "keyset" }))).toBeNull();
    });

    it("returns null when an offset cursor carries a non-numeric n", () => {
      expect(decode(foreignCursor({ mode: "offset", n: "40" }))).toBeNull();
    });

    // Offset `n` drives `Array.slice` directly in `paginateOffset`, so a
    // negative or fractional `n` would otherwise mint a poisoned next-page
    // cursor instead of taking the documented bad-cursor path.
    it("returns null when an offset cursor carries a negative n", () => {
      expect(decode(foreignCursor({ mode: "offset", n: -10 }))).toBeNull();
    });

    it("returns null when an offset cursor carries a non-integer n", () => {
      expect(decode(foreignCursor({ mode: "offset", n: 1.5 }))).toBeNull();
    });

    // A well-formed cursor is ~50-100 bytes; capping the raw input stops a
    // hostile client forcing a multi-megabyte base64 allocation + JSON parse.
    it("returns null for an oversized cursor string without decoding it", () => {
      expect(decode("a".repeat(1024))).toBeNull();
    });
  });

  // A source declares its cursorMode; a cursor minted for the other mode is
  // foreign to it and must decode to null so an offset cursor can never drive a
  // keyset query (or vice versa) — the mismatch is rejected, not coerced.
  describe("mode-mismatch is rejected against the expected mode (both modes)", () => {
    it("returns null when an offset cursor is decoded as keyset", () => {
      const offset = encode({ mode: "offset", n: 10 });
      expect(decode(offset, "keyset")).toBeNull();
      expect(decode(offset, "offset")).toEqual({ mode: "offset", n: 10 });
    });

    it("returns null when a keyset cursor is decoded as offset", () => {
      const keyset = encode({ mode: "keyset", k: "seed:abc" });
      expect(decode(keyset, "offset")).toBeNull();
      expect(decode(keyset, "keyset")).toEqual({ mode: "keyset", k: "seed:abc" });
    });

    it("accepts any valid cursor when no expected mode is supplied", () => {
      expect(decode(encode({ mode: "keyset", k: "x" }))).toEqual({ mode: "keyset", k: "x" });
      expect(decode(encode({ mode: "offset", n: 0 }))).toEqual({ mode: "offset", n: 0 });
    });
  });

  // encodeSeedCursor mints the `similarTo` initial cursor; the home-private
  // `decodeSeedToken` reads the seed back out of the keyset `k`. The codec owns
  // that round-trip: a seed encoded here must decode to a keyset cursor whose
  // `k` parses back to the same seed at offset 0.
  describe("encodeSeedCursor / seed-token round-trip", () => {
    it("mints a keyset cursor whose k decodes back to the seed at offset 0", () => {
      const seed = { seedId: "550", seedType: "movie" } as const;
      const decoded = decode(encodeSeedCursor(seed), "keyset");
      expect(decoded?.mode).toBe("keyset");
      const token = JSON.parse(decoded?.mode === "keyset" ? decoded.k : "{}");
      expect(token).toEqual({ seedId: "550", seedType: "movie", offset: 0 });
    });

    it("round-trips a tv seed", () => {
      const seed = { seedId: "1396", seedType: "tv" } as const;
      const decoded = decode(encodeSeedCursor(seed), "keyset");
      const token = JSON.parse(decoded?.mode === "keyset" ? decoded.k : "{}");
      expect(token).toEqual({ seedId: "1396", seedType: "tv", offset: 0 });
    });
  });
});
