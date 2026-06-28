import { describe, expect, it } from "vite-plus/test";
import { decodeCollectionsCursor, encodeCollectionsCursor } from "../internal/collections-cursor";

describe("collections cursor codec", () => {
  // The id is a TMDB numeric string that never holds a space, while the name
  // can, so the codec splits on the LAST space. Round-tripping a spaced name
  // proves the suffix-is-id split survives interior spaces; a naive first-space
  // split would corrupt both fields here.
  it("round-trips a (name, id) pair whose name contains spaces", () => {
    const cursor = {
      collectionName: "The Lord of the Rings Collection",
      collectionId: "119",
    };
    const decoded = decodeCollectionsCursor(encodeCollectionsCursor(cursor));
    expect(decoded).toEqual(cursor);
  });

  // A single-word name must also survive so the spaced-name case is not the only
  // path the codec handles.
  it("round-trips a (name, id) pair with a single-word name", () => {
    const cursor = { collectionName: "Alien", collectionId: "8091" };
    const decoded = decodeCollectionsCursor(encodeCollectionsCursor(cursor));
    expect(decoded).toEqual(cursor);
  });

  // The decoder is total and degrades to "first page" instead of throwing, so an
  // undefined token (no cursor on the first request) yields undefined.
  it("returns undefined for an undefined token without throwing", () => {
    expect(() => decodeCollectionsCursor(undefined)).not.toThrow();
    expect(decodeCollectionsCursor(undefined)).toBeUndefined();
  });

  // An empty string is a hand-edited or stripped link; it must degrade to
  // undefined, not throw and not resume from a bogus position.
  it("returns undefined for an empty token", () => {
    expect(decodeCollectionsCursor("")).toBeUndefined();
  });

  // A foreign token with no space at all has no name/id boundary, so the codec
  // cannot recover a resume position and must return undefined.
  it("returns undefined for a token with no separator", () => {
    expect(decodeCollectionsCursor("nodelimiter")).toBeUndefined();
  });

  // A token that ends on the separator has an empty id suffix; with no id there
  // is no keyset anchor, so the codec rejects it rather than resuming on a blank
  // id that would scan from the wrong place.
  it("returns undefined when the id suffix is empty", () => {
    expect(decodeCollectionsCursor("Trailing Space ")).toBeUndefined();
  });
});
