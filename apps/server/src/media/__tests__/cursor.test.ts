import { describe, expect, it } from "vite-plus/test";
import { decode, encode, type Cursor } from "../cursor";

describe("media cursor codec", () => {
  it("round-trips a keyset cursor through encode/decode", () => {
    const cursor: Cursor = { mode: "keyset", k: "1700000000000:cuid123" };
    const decoded = decode(encode(cursor));
    expect(decoded).toEqual(cursor);
  });

  it("round-trips an offset cursor through encode/decode", () => {
    const cursor: Cursor = { mode: "offset", n: 40 };
    const decoded = decode(encode(cursor));
    expect(decoded).toEqual(cursor);
  });

  it("produces an opaque base64url string with no JSON-revealing characters", () => {
    // An opaque wire format must not leak the JSON braces/quotes that would let
    // a client hand-edit the payload, so the cursor is base64url, not raw JSON.
    const encoded = encode({ mode: "offset", n: 7 });
    expect(encoded).not.toMatch(/[{}":+/=]/);
  });

  // decode NEVER throws and returns null on unusable input (invariant V.CU1) so
  // a malformed or hostile cursor degrades to the consumer's null-cursor path
  // (home → 400, watchlist → first page) instead of crashing the read.
  describe("decode returns null without throwing on bad input", () => {
    it("returns null for non-base64url garbage", () => {
      expect(decode("!!! not base64 !!!")).toBeNull();
    });

    it("returns null for base64url that is not JSON", () => {
      const notJson = Buffer.from("plain text, not json", "utf8").toString("base64url");
      expect(decode(notJson)).toBeNull();
    });

    it("returns null for valid JSON with a foreign shape (no mode)", () => {
      const foreign = Buffer.from(JSON.stringify({ page: 3 }), "utf8").toString("base64url");
      expect(decode(foreign)).toBeNull();
    });

    it("returns null for an unknown mode value", () => {
      const foreign = Buffer.from(JSON.stringify({ mode: "scroll", n: 1 }), "utf8").toString(
        "base64url",
      );
      expect(decode(foreign)).toBeNull();
    });

    it("returns null when a keyset cursor is missing its k field", () => {
      const malformed = Buffer.from(JSON.stringify({ mode: "keyset" }), "utf8").toString(
        "base64url",
      );
      expect(decode(malformed)).toBeNull();
    });

    it("returns null when an offset cursor carries a non-numeric n", () => {
      const malformed = Buffer.from(JSON.stringify({ mode: "offset", n: "40" }), "utf8").toString(
        "base64url",
      );
      expect(decode(malformed)).toBeNull();
    });
  });

  // A source declares its cursorMode; a cursor minted for the other mode is
  // foreign to it and must decode to null so an offset cursor can never drive a
  // keyset query (or vice versa) — the mode mismatch is rejected, not coerced.
  describe("mode-mismatch is rejected against the expected mode", () => {
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
});
