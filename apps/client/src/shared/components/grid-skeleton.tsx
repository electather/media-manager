import type { CSSProperties } from "react";
import { cn } from "@/shared/lib/utils";
import { Skeleton } from "@/shared/ui/skeleton";

export type GridSkeletonAspect = "16/9" | "2/3";

interface GridSkeletonProps {
  /** How many card-shaped placeholders to render. */
  count?: number;
  /** Card aspect — matches `MediaRowCard` so cold-load chrome lines up with paint. */
  aspect?: GridSkeletonAspect;
  /** Tracks `repeat(auto-fill, minmax(min, 1fr))` so columns match the live grid. */
  minColumnWidthPx?: number;
  /** Gap between cells, in px. Forwarded to both `gridGap` and reflects the live grid. */
  gapPx?: number;
  className?: string;
  /** Override `data-testid` for callers that need to scope multiple skeletons on one page. */
  testId?: string;
}

const DEFAULT_COUNT = 12;
const DEFAULT_MIN_COLUMN_WIDTH_PX = 180;
const DEFAULT_GAP_PX = 16;

/**
 * Suspense fallback for paginated card grids (V.WL10 invariant — cold-load
 * skeleton matches the live grid shape). Caller varies `count`, `aspect`, and
 * `minColumnWidthPx` so home rails (16/9) and watchlist grids (2/3) share one
 * primitive without per-feature copies.
 */
export function GridSkeleton({
  count = DEFAULT_COUNT,
  aspect = "2/3",
  minColumnWidthPx = DEFAULT_MIN_COLUMN_WIDTH_PX,
  gapPx = DEFAULT_GAP_PX,
  className,
  testId = "grid-skeleton",
}: GridSkeletonProps) {
  const aspectClass = aspect === "16/9" ? "aspect-video" : "aspect-[2/3]";
  const style: CSSProperties = {
    gridTemplateColumns: `repeat(auto-fill, minmax(${minColumnWidthPx}px, 1fr))`,
    gap: gapPx,
  };
  return (
    <div
      data-slot="grid-skeleton"
      data-testid={testId}
      data-aspect={aspect}
      className={cn("grid", className)}
      style={style}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          data-slot="grid-skeleton-cell"
          className={cn(aspectClass, "w-full rounded-md")}
        />
      ))}
    </div>
  );
}
