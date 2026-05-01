import { useMemo } from "react";
import { m } from "@/paraglide/messages";
import { mockData } from "../lib/mock-data";
import { SeasonBlock } from "./season-block";
import type { MediaDetailItem } from "../lib/types";

interface SeasonsListProps {
  item: MediaDetailItem;
}

export function SeasonsList({ item }: SeasonsListProps) {
  const seasons = useMemo(() => mockData.generateSeasons(item), [item]);
  if (item.kind !== "tv" || !seasons.length) return null;

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
