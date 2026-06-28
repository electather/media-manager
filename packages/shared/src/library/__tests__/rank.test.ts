import { describe, expect, it } from "vite-plus/test";
import { QUALITY_TIERS } from "../enums";
import { QUALITY_RANK_UNRANKED, rankQualityTier } from "../rank";

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

  // LOCKSTEP INVARIANT: SQL CASE WHEN arms per tier, ELSE uses QUALITY_RANK_UNRANKED;
  // must equal QUALITY_TIERS.length so ELSE ordinal is exactly one past last ranked index.
  // Drift → SQL/JS rank disagree at page boundary → Quality lens drops/duplicates rows.
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
