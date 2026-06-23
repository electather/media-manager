import type { LibraryItemQuality } from "@nama/shared/plugins";

/** Folds plugin `quality` to tier label for `QUALITY_TIERS` (design §Known fuzzy areas: quality tier rank).
 * Label = resolution anchor + optional HDR: "4K HDR", "4K", "1080p", "720p", "SD", or "HDR" if no resolution.
 * Returns null if no resolution and no HDR, so unclassified copies don't create bogus tiers. */
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

/** Maps each copy's quality to tier label, deduplicates, preserves order. e.g., 4K HDR + 1080p → ["4K HDR", "1080p"]; Quality lens expands via json_each. */
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
