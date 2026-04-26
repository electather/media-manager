import { Skeleton } from "@/components/ui/skeleton";

const ROW_ASPECTS = ["poster", "backdrop", "poster", "poster"] as const;

export function HomeFeedSkeleton() {
  return (
    <div className="flex flex-col gap-6 py-4 md:gap-8 md:py-6" aria-busy>
      <div className="px-4 lg:px-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] md:gap-6">
          <Skeleton className="aspect-video w-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-24" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="aspect-video w-[100px] shrink-0" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {ROW_ASPECTS.map((aspect, idx) => (
        <div key={idx} className="flex flex-col gap-2 px-4 lg:px-6">
          <Skeleton className="h-4 w-32" />
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 6 }).map((_, j) => (
              <Skeleton
                key={j}
                className={
                  aspect === "poster"
                    ? "aspect-[2/3] w-[140px] shrink-0 md:w-[160px] xl:w-[180px]"
                    : "aspect-video w-[220px] shrink-0 md:w-[250px] xl:w-[280px]"
                }
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
