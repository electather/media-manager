import { Skeleton } from "@/shared/ui/skeleton";

export function ModalSkeleton() {
  return (
    <div className="px-7 pt-5 pb-7">
      <div className="mb-3.5 flex min-h-[44px] items-center">
        <Skeleton className="h-7 w-[46%] rounded-md" />
      </div>
      <div className="mb-4 flex items-center gap-2.5">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-4 w-9 rounded" />
        <Skeleton className="h-3 w-44" />
      </div>
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-[34px] w-20 rounded-full" />
        <Skeleton className="h-[34px] w-24 rounded-full" />
        <Skeleton className="h-[34px] w-20 rounded-full" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="h-9 w-32 rounded-md" />
        <Skeleton className="h-9 w-10 rounded-md" />
      </div>
      <div className="mb-4 flex gap-2">
        <Skeleton className="h-12 w-28 rounded-md" />
        <Skeleton className="h-12 w-28 rounded-md" />
        <Skeleton className="h-12 w-28 rounded-md" />
      </div>
      <div className="mb-4 flex max-w-[640px] flex-col gap-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-[96%]" />
        <Skeleton className="h-3 w-[92%]" />
        <Skeleton className="h-3 w-[70%]" />
      </div>
      <div className="mb-4 grid max-w-[540px] grid-cols-[80px_1fr] gap-x-4 gap-y-2.5">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-[60%]" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-[80%]" />
      </div>
      <Skeleton className="mb-4 h-20 w-full rounded-xl" />
    </div>
  );
}
