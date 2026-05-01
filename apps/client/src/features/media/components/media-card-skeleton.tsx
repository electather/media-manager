import { cn } from "@/shared/lib/utils";

type Aspect = "16/9" | "2/3";

type MediaCardSkeletonProps = {
  aspect: Aspect;
  className?: string;
};

export function MediaCardSkeleton({ aspect, className }: MediaCardSkeletonProps) {
  const aspectClass = aspect === "16/9" ? "aspect-video" : "aspect-[2/3]";
  return (
    <div aria-hidden="true" className={cn("flex w-full flex-col", className)}>
      <div className={cn("animate-pulse rounded-xl bg-muted", aspectClass)} />
      <div className="flex flex-col gap-1.5 pt-2">
        <div className="h-3 w-[70%] animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-[40%] animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
