import { Skeleton } from "@/shared/ui/skeleton";

const TILE_KEYS = Array.from({ length: 12 }, (_, index) => `tile-${index}`);

/**
 * Loading placeholder for a lens route's content area. The layout has already
 * painted the header, so this covers only the grid below it; the leaf routes
 * use it as their `pendingComponent`.
 */
export function LibraryContentSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-3.5 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]">
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
