import { Skeleton } from "@/shared/ui/skeleton";

const TILE_KEYS = Array.from({ length: 12 }, (_, index) => `tile-${index}`);

/** Loader-pending placeholder mirroring the header + first grid section. */
export function LibrarySkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-400 flex-col gap-6 px-4 pb-32 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-12 w-56" />
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-11 w-80 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-3.5 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]">
        {TILE_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-2">
            <Skeleton className="aspect-2/3 w-full rounded-xl" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
