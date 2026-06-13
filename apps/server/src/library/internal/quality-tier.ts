import type { LibraryItemQuality } from "@nama/shared/plugins";

/**
 * Folds a structured plugin `quality` descriptor into the free-form tier label
 * the library stores in `qualityTiers` and the Quality lens ranks against
 * `QUALITY_TIERS` (design §Known fuzzy areas: quality tier rank). The label is
 * the resolution anchor with an HDR modifier appended so the Quality lens can
 * separate "4K HDR" from plain "4K":
 *   - resolution `4k` + a Dolby-Vision/HDR `hdr` flag → `"4K HDR"`,
 *   - resolution `4k` alone → `"4K"`, `1080p` → `"1080p"`, `720p` → `"720p"`,
 *     `sd` → `"SD"`,
 *   - no resolution but an HDR flag → `"HDR"`.
 *
 * Returns `null` when the descriptor carries no resolution and no HDR signal,
 * so a copy the server could not classify contributes no tier rather than a
 * bogus one. Pure and deterministic so it is unit-testable in isolation.
 */
export function qualityToTier(quality: LibraryItemQuality): string | null {
  const hasHdr = quality.hdr != null && quality.hdr !== "none";
  switch (quality.resolution) {
    case "4k":
      return hasHdr ? "4K HDR" : "4K";
    case "1080p":
      return "1080p";
    case "720p":
      return "720p";
    case "sd":
      return "SD";
    default:
      return hasHdr ? "HDR" : null;
  }
}

/**
 * Maps every copy's quality into its tier label and de-duplicates, preserving
 * first-seen order. A title with both a 4K HDR and a 1080p copy yields
 * `["4K HDR", "1080p"]` — the Quality lens later expands that one row into a
 * section per tier via `json_each`.
 */
export function deriveQualityTiers(copies: LibraryItemQuality[]): string[] {
  const seen = new Set<string>();
  const tiers: string[] = [];
  for (const copy of copies) {
    const tier = qualityToTier(copy);
    if (tier == null || seen.has(tier)) continue;
    seen.add(tier);
    tiers.push(tier);
  }
  return tiers;
}
