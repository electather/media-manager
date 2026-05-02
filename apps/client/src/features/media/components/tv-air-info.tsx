import { CalendarIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";
import { Skeleton } from "@/shared/ui/skeleton";
import type { MediaDetail } from "../lib/types";

interface TVAirInfoProps {
  item: MediaDetail;
  isHydrating?: boolean;
}

export function TVAirInfo({ item, isHydrating = false }: TVAirInfoProps) {
  if (item.mediaType !== "tv") return null;

  if (!item.seriesStatus && isHydrating) {
    return (
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-12 w-32 rounded-md" />
        <Skeleton className="h-12 w-40 rounded-md" />
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {item.seriesStatus && (
        <div className="inline-flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
          <span
            className={cn(
              "size-2 rounded-full",
              item.seriesStatus === "ongoing"
                ? "bg-success shadow-[0_0_8px_var(--success)]"
                : "bg-muted-foreground/60",
            )}
          />
          <div className="flex flex-col">
            <div className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
              {m.media_details_series()}
            </div>
            <div className="text-[13px] font-medium">
              {item.seriesStatus === "ongoing"
                ? m.media_details_series_ongoing()
                : m.media_details_series_finished()}
            </div>
          </div>
        </div>
      )}
      {item.seriesStatus === "ongoing" && item.nextAirDate && (
        <div className="inline-flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
          <span className="text-primary">
            <CalendarIcon className="size-3.5" />
          </span>
          <div className="flex flex-col">
            <div className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
              {m.media_details_next_air_date()}
            </div>
            <div className="text-[13px] font-medium">{item.nextAirDate}</div>
          </div>
        </div>
      )}
    </div>
  );
}
