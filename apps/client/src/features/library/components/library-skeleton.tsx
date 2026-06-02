import { Skeleton } from "@/shared/ui/skeleton";
import { LibraryContentSkeleton } from "./library-content-skeleton";

/** Loader-pending placeholder for the whole page: header + first grid. */
export function LibrarySkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-400 flex-col gap-6 px-4 pb-32 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-12 w-56" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-11 w-80 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>
      <LibraryContentSkeleton />
    </div>
  );
}
