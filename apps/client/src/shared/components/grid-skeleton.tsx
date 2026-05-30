// fallow-ignore-file unused-file
// Reason: this skeleton lands before its consumers — it replaces the per-feature grid fallbacks, wired into the shells in US-008 / US-009.
import { Skeleton } from "@/shared/ui/skeleton";

export interface GridSkeletonProps {
  /** Number of card-shaped placeholders. */
  count?: number;
  /** Placeholder card shape — `2/3` poster (watchlist grid) or `16/9` backdrop. */
  aspect?: "16/9" | "2/3";
  /** Responsive grid min column width in px. */
  minColumnWidthPx?: number;
}

/**
 * The one Suspense grid fallback (design §B2). Shape varies by prop so both the
 * watchlist poster grid (2/3) and any backdrop grid (16/9) read through it,
 * mirroring the responsive `auto-fill` layout the real grids use.
 */
export function GridSkeleton({
  count = 12,
  aspect = "2/3",
  minColumnWidthPx = 180,
}: GridSkeletonProps) {
  const aspectClass = aspect === "16/9" ? "aspect-video" : "aspect-[2/3]";
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minColumnWidthPx}px, 1fr))` }}
      aria-hidden="true"
      data-testid="grid-skeleton"
    >
      {Array.from({ length: Math.max(1, count) }, (_, i) => (
        <Skeleton key={i} className={`${aspectClass} w-full rounded-xl`} />
      ))}
    </div>
  );
}
