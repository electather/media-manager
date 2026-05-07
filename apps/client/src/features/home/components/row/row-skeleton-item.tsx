import { cn } from "@/shared/lib/utils";
import { Skeleton } from "@/shared/ui/skeleton";

export function RowSkeletonItem({ isBackdrop }: { isBackdrop: boolean }) {
  return (
    <li
      aria-hidden="true"
      className="flex shrink-0 snap-start flex-col gap-2"
      style={{ width: "var(--card-w)" }}
    >
      <Skeleton className={cn("w-full rounded-md", isBackdrop ? "aspect-video" : "aspect-2/3")} />
      <Skeleton className="h-3 w-3/4 rounded" />
      <Skeleton className="h-3 w-1/2 rounded" />
    </li>
  );
}
