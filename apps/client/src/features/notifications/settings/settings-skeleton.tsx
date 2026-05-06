import { Skeleton } from "@/shared/ui/skeleton";

export function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
