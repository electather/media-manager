import { m } from "@/paraglide/messages";
import { SeasonBlock } from "./season-block";
import type { MediaDetail } from "../lib/types";

interface SeasonsListProps {
  item: MediaDetail;
  isHydrating?: boolean;
}

export function SeasonsList({ item, isHydrating = false }: SeasonsListProps) {
  if (item.mediaType !== "tv") return null;
  const seasons = item.seasons;
  if (!seasons) {
    return isHydrating ? <SeasonsSkeleton /> : null;
  }
  if (seasons.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h3 className="text-[13px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
          {m.media_details_seasons_title()}
        </h3>
        <div className="font-mono text-[11px] text-muted-foreground/70">
          {m.media_details_seasons_count({ count: seasons.length })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {seasons.map((s, i) => (
          <SeasonBlock key={s.id} season={s} defaultOpen={i === seasons.length - 1} />
        ))}
      </div>
    </div>
  );
}

function SeasonsSkeleton() {
  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="h-12 animate-pulse rounded-md bg-muted" />
      <div className="h-12 animate-pulse rounded-md bg-muted" />
      <div className="h-12 animate-pulse rounded-md bg-muted" />
    </div>
  );
}
