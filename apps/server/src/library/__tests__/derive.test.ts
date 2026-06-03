import { describe, expect, it } from "vite-plus/test";
import { QUALITY_TIERS, WATCHED_STATES } from "@ent-mcp/shared/library";
import type { LibraryItemQuality } from "@ent-mcp/shared/plugins";
import type { ProgressEntry } from "../../media";
import { normalizeSortTitle } from "../internal/normalize-title";
import { deriveQualityTiers, qualityToTier } from "../internal/quality-tier";
import { deriveWatchedState } from "../internal/watched-state";

// These are pure-derivation invariants: each assertion is written so it FAILS
// if the underlying business rule changes (Rule 9), not merely if the function
// throws. No database or plugin runtime is touched — every input is a literal.
describe("normalizeSortTitle", () => {
  // The A–Z rail files "The Matrix" under "M", so a leading "the" must be
  // dropped. If article-stripping regressed, the key would start with "the".
  it("strips a leading 'the' article", () => {
    expect(normalizeSortTitle("The Matrix")).toBe("matrix");
  });

  // "a" is also an article: "A Few Good Men" files under "F". The remaining
  // interior whitespace must be preserved so multi-word titles stay intact.
  it("strips a leading 'a' article and keeps interior words", () => {
    expect(normalizeSortTitle("A Few Good Men")).toBe("few good men");
  });

  // "an" is the third article form. Folding it proves the regex matches the
  // whole `the|a|an` set, not just one literal.
  it("strips a leading 'an' article", () => {
    expect(normalizeSortTitle("An Education")).toBe("education");
  });

  // The browse key is lowercased so the rail index is case-insensitive; a
  // title shouting in caps must still group with its lowercase peers.
  it("lowercases the title", () => {
    expect(normalizeSortTitle("BLADE RUNNER")).toBe("blade runner");
  });

  // Diacritics are NFD-folded so "Amélie" sorts beside ASCII "a…" titles. If
  // the combining-mark strip regressed, the accented "é" would survive.
  it("folds diacritics to their ASCII base letter", () => {
    expect(normalizeSortTitle("Amélie")).toBe("amelie");
  });

  // Surrounding whitespace is collapsed (trimmed) so a padded title produces
  // the same key as the clean one — keys must be stable across hydrate runs.
  it("collapses surrounding whitespace", () => {
    expect(normalizeSortTitle("  Inception  ")).toBe("inception");
  });

  // A null/blank title still needs a defined key so the row groups under "#";
  // the contract is the empty string, never null/undefined or a thrown error.
  it("returns an empty string for null, undefined, and blank input", () => {
    expect(normalizeSortTitle(null)).toBe("");
    expect(normalizeSortTitle(undefined)).toBe("");
    expect(normalizeSortTitle("")).toBe("");
    expect(normalizeSortTitle("   ")).toBe("");
  });

  // "Theater" begins with the letters "the" but is NOT the article "the" — the
  // regex anchors on a trailing word boundary (whitespace), so the word must
  // survive intact. This is the guard against over-eager prefix stripping.
  it("does NOT strip a non-article leading word", () => {
    expect(normalizeSortTitle("Theater")).toBe("theater");
  });
});

describe("qualityToTier", () => {
  // 4K with an HDR signal is the top tier; the HDR modifier must be appended so
  // the Quality lens can separate "4K HDR" from plain "4K".
  it("maps 4k with an HDR format to '4K HDR'", () => {
    const quality: LibraryItemQuality = { resolution: "4k", hdr: "hdr10" };
    const tier = qualityToTier(quality);
    expect(tier).toBe("4K HDR");
    // The label must be an anchor the canonical tier tuple recognises, or the
    // Quality lens would rank it below every listed tier.
    expect(QUALITY_TIERS).toContain(tier);
  });

  // 4K with no HDR signal collapses to plain "4K". This pins the branch that the
  // HDR modifier is conditional, not always appended.
  it("maps 4k without HDR to '4K'", () => {
    expect(qualityToTier({ resolution: "4k" })).toBe("4K");
  });

  // hdr: "none" is an explicit "no HDR" signal, not a present format. If the
  // null/"none" guard regressed, this would wrongly yield "4K HDR".
  it("treats hdr 'none' as no HDR", () => {
    expect(qualityToTier({ resolution: "4k", hdr: "none" })).toBe("4K");
  });

  it("maps 1080p to '1080p'", () => {
    expect(qualityToTier({ resolution: "1080p" })).toBe("1080p");
  });

  it("maps 720p to '720p'", () => {
    expect(qualityToTier({ resolution: "720p" })).toBe("720p");
  });

  it("maps sd to 'SD'", () => {
    expect(qualityToTier({ resolution: "sd" })).toBe("SD");
  });

  // No resolution but an HDR flag still carries a fidelity signal worth a tier.
  it("maps a missing resolution with an HDR flag to 'HDR'", () => {
    expect(qualityToTier({ hdr: "dolby-vision" })).toBe("HDR");
  });

  // An empty/unclassifiable descriptor must contribute no tier rather than a
  // bogus one, so the contract is null — the signal the dedupe path drops.
  it("returns null for an empty/unclassifiable quality", () => {
    expect(qualityToTier({})).toBeNull();
    expect(qualityToTier({ hdr: "none" })).toBeNull();
    expect(qualityToTier({ codec: "hevc", bitrate: 8000 })).toBeNull();
  });
});

describe("deriveQualityTiers", () => {
  // Each copy's tier appears once, in first-seen order. A title with a 4K HDR
  // and a 1080p copy must yield exactly that ordered pair.
  it("maps every copy to its tier in first-seen order", () => {
    const copies: LibraryItemQuality[] = [
      { resolution: "4k", hdr: "hdr10" },
      { resolution: "1080p" },
    ];
    expect(deriveQualityTiers(copies)).toEqual(["4K HDR", "1080p"]);
  });

  // Duplicate copies of the same tier collapse to one entry, and the FIRST
  // occurrence fixes the position. Reordering the surviving entry would fail
  // this, proving order is preserved rather than incidentally correct.
  it("dedupes copies that map to the same tier, preserving first-seen order", () => {
    const copies: LibraryItemQuality[] = [
      { resolution: "1080p" },
      { resolution: "4k", hdr: "dolby-vision" },
      { resolution: "1080p", codec: "h264" },
      { resolution: "4k", hdr: "hdr10" },
    ];
    expect(deriveQualityTiers(copies)).toEqual(["1080p", "4K HDR"]);
  });

  // Unclassifiable copies are omitted entirely, never emitted as null/"".
  it("omits copies that classify to null", () => {
    const copies: LibraryItemQuality[] = [{}, { resolution: "720p" }, { hdr: "none" }];
    expect(deriveQualityTiers(copies)).toEqual(["720p"]);
  });

  it("returns an empty array for no copies", () => {
    expect(deriveQualityTiers([])).toEqual([]);
  });

  // Every label the deriver emits must be a member of the canonical anchor
  // tuple; an emitted label outside QUALITY_TIERS would silently rank dead last
  // in the Quality lens. This locks the deriver's vocabulary to the anchor.
  it("emits only labels found in the QUALITY_TIERS anchor", () => {
    const copies: LibraryItemQuality[] = [
      { resolution: "4k", hdr: "hdr10" },
      { resolution: "1080p" },
      { resolution: "720p" },
      { resolution: "sd" },
      { hdr: "dolby-vision" },
    ];
    for (const tier of deriveQualityTiers(copies)) {
      expect(QUALITY_TIERS).toContain(tier);
    }
  });
});

describe("deriveWatchedState", () => {
  // Progress at or past total is "watched". This branch is defensive (the CW
  // projection drops finished titles) but must still resolve correctly.
  it("returns 'watched' when watched reaches total", () => {
    const progress: ProgressEntry = { watched: 10, total: 10 };
    expect(deriveWatchedState(progress)).toBe("watched");
  });

  it("returns 'watched' when watched exceeds total", () => {
    expect(deriveWatchedState({ watched: 11, total: 10 })).toBe("watched");
  });

  // Strictly-between progress is "partial" — the everyday continue-watching row.
  it("returns 'partial' for progress between 0 and total", () => {
    const state = deriveWatchedState({ watched: 3, total: 10 });
    expect(state).toBe("partial");
  });

  // Zero watched (but a present entry) is "unwatched". An entry exists yet no
  // part has been started.
  it("returns 'unwatched' when watched is zero", () => {
    expect(deriveWatchedState({ watched: 0, total: 10 })).toBe("unwatched");
  });

  // A total of zero must not be read as "watched" via the `>= total` rule; with
  // zero watched it falls through to "unwatched", proving the `total > 0` guard.
  it("does not call a zero-total entry 'watched' when nothing is watched", () => {
    expect(deriveWatchedState({ watched: 0, total: 0 })).toBe("unwatched");
  });

  // Absence is "unknown" (null), NOT an assumed "unwatched": the CW feed cannot
  // distinguish a finished title from one never started, so guessing would
  // mislabel finished titles. The honest projection is null.
  it("returns null when no progress entry exists", () => {
    expect(deriveWatchedState(undefined)).toBeNull();
  });

  // Every non-null result must be a member of the canonical WatchedState tuple,
  // so the facet and filter axis never see a value outside the three buckets.
  it("only ever returns a member of WATCHED_STATES or null", () => {
    const inputs: (ProgressEntry | undefined)[] = [
      { watched: 10, total: 10 },
      { watched: 3, total: 10 },
      { watched: 0, total: 10 },
      undefined,
    ];
    for (const input of inputs) {
      const state = deriveWatchedState(input);
      if (state !== null) {
        expect(WATCHED_STATES).toContain(state);
      }
    }
  });
});
