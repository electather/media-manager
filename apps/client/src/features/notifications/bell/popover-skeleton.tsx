import { Skeleton } from "@/shared/ui/skeleton";

function ChipSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <Skeleton
      className={wide ? "h-7 w-16 shrink-0 rounded-full" : "h-7 w-12 shrink-0 rounded-full"}
    />
  );
}

function RowSkeleton() {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] gap-3 border-l-2 border-l-transparent px-3.5 py-3.5">
      <Skeleton className="size-8 rounded-full" />
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-12" />
        </div>
        <Skeleton className="mt-2 h-3 w-full" />
        <Skeleton className="mt-1.5 h-3 w-3/4" />
        <div className="mt-2.5 flex items-center gap-1">
          <Skeleton className="size-2.5 rounded-full" />
          <Skeleton className="h-3 w-14" />
        </div>
      </div>
      <Skeleton className="size-7 rounded-md" />
    </div>
  );
}

export function PopoverSkeleton() {
  return (
    <>
      <div className="shrink-0 px-4 pb-2.5">
        <div className="flex gap-1.5 overflow-hidden pb-0.5">
          <ChipSkeleton />
          <ChipSkeleton wide />
          <ChipSkeleton />
          <ChipSkeleton />
          <ChipSkeleton wide />
        </div>
      </div>
      <div className="h-px shrink-0 bg-border" />
      <div className="min-h-0 flex-1 overflow-hidden">
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </div>
    </>
  );
}
