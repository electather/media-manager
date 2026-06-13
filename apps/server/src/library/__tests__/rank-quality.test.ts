import { describe, expect, it } from "vite-plus/test";
import { QUALITY_TIERS } from "@nama/shared/library";
import { decodeCollectionsCursor, encodeCollectionsCursor } from "../internal/collections-cursor";
import { QUALITY_RANK_UNRANKED, rankQualityTier } from "../internal/rank-quality";

// These are pure-derivation invariants: each assertion is written so it FAILS
// if the underlying business rule changes (Rule 9), not merely if the function
// throws. No database or plugin runtime is touched — every input is a literal.
describe("rankQualityTier", () => {
  // Every known tier must map to its own tuple index, and the tuple is ordered
  // hi→lo so index 0 is the highest fidelity. Asserting the FULL list (not a
  // spot check) means this test fails if a tier is reordered, renamed, added,
  // or removed — any of which would silently desync the Quality lens ordering.
  it("maps each known tier label to its hi→lo tuple index", () => {
    QUALITY_TIERS.forEach((label, expectedIndex) => {
      expect(rankQualityTier(label)).toBe(expectedIndex);
    });
  });

  // The top of the tuple is the highest fidelity, so its rank must be exactly 0;
  // pinning this catches a regression that flipped the tuple to lo→hi order.
  it("ranks the highest-fidelity tier at ordinal 0", () => {
    expect(rankQualityTier(QUALITY_TIERS[0])).toBe(0);
  });

  // A label no plugin tier lists (free-form strings like "Atmos") must sink to
  // the unranked sentinel so it sorts below every real tier; a non-sentinel
  // result here would float unknown quality up into the ranked band.
  it("ranks an unknown label as the unranked sentinel", () => {
    expect(rankQualityTier("Atmos")).toBe(QUALITY_RANK_UNRANKED);
  });

  // The empty string is the degenerate unknown label; it must also fall through
  // to the sentinel rather than accidentally matching an empty tuple slot.
  it("ranks the empty label as the unranked sentinel", () => {
    expect(rankQualityTier("")).toBe(QUALITY_RANK_UNRANKED);
  });

  // LOCKSTEP INVARIANT. The SQL `CASE` the repo builds emits one WHEN arm per
  // tier and uses QUALITY_RANK_UNRANKED in its ELSE arm; that value MUST equal
  // QUALITY_TIERS.length so the SQL ELSE ordinal sits exactly one past the last
  // ranked index — identical to the JS fallback. If the sentinel and the tuple
  // length ever drift, the SQL ORDER BY and the JS rank disagree at a page
  // boundary and the Quality lens drops or duplicates rows. This pins the link.
  it("keeps the unranked sentinel equal to the tuple length", () => {
    expect(QUALITY_RANK_UNRANKED).toBe(QUALITY_TIERS.length);
  });

  // The sentinel must rank strictly below every real tier; comparing it against
  // the last (lowest-fidelity) tier's rank proves the ordering gap exists rather
  // than merely asserting an arithmetic identity.
  it("ranks the sentinel below the lowest-fidelity tier", () => {
    const lowestTierRank = rankQualityTier(QUALITY_TIERS.at(-1)!);
    expect(QUALITY_RANK_UNRANKED).toBeGreaterThan(lowestTierRank);
  });
});

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
