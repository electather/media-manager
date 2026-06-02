import { Skeleton } from "@/shared/ui/skeleton";
import { LIBRARY_GRID_CLASS } from "./library-grid";

const TILE_KEYS = Array.from({ length: 12 }, (_, index) => `tile-${index}`);

/**
 * Loading placeholder for a lens route's content area. The layout has already
 * painted the header, so this covers only the grid below it; the leaf routes
 * use it as their `pendingComponent`.
 */
export function LibraryContentSkeleton() {
  return (
    <div className={LIBRARY_GRID_CLASS}>
      {TILE_KEYS.map((key) => (
        <div key={key} className="flex flex-col gap-2">
          <Skeleton className="aspect-2/3 w-full rounded-xl" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}
