import { Skeleton } from "@/shared/ui/skeleton";

function CategoryLegendSkeleton() {
  return (
    <div className="border-b border-border bg-muted/40 px-5 py-3 sm:px-6">
      <div className="mb-2 sm:hidden">
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
        <Skeleton className="hidden h-3 w-20 sm:block" />
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <Skeleton className="size-1.5 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="hidden h-3 w-28 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ChannelRowSkeleton({ first = false }: { first?: boolean }) {
  return (
    <li
      className={[
        "grid gap-3 px-5 py-4 sm:px-6",
        "grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto]",
        first ? "" : "border-t border-border",
      ].join(" ")}
    >
      <Skeleton className="size-10 rounded-full" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        <div className="mt-2 flex flex-col gap-y-1 sm:flex-row sm:flex-wrap sm:gap-x-3.5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
      </div>
      <div className="col-span-2 flex justify-end gap-1.5 sm:col-span-1 sm:self-start">
        <Skeleton className="h-7 w-16 rounded-md" />
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="size-8 rounded-md" />
      </div>
      <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 sm:pl-12">
        <Skeleton className="h-3 w-16" />
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-16 rounded-md" />
          ))}
        </div>
      </div>
    </li>
  );
}

export function SettingsSkeleton() {
  return (
    <>
      <CategoryLegendSkeleton />
      <ul role="list" className="flex flex-col">
        <ChannelRowSkeleton first />
        <ChannelRowSkeleton />
        <ChannelRowSkeleton />
      </ul>
    </>
  );
}
