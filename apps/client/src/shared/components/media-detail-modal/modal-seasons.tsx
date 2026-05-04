import { ChevronDown } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Badge } from "@/shared/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible";
import { cn } from "@/shared/lib/utils";
import type { MediaDetailItem } from "./types";

type SeasonStatus = "available" | "requested" | "unavailable" | "upcoming";

type Season = {
  id: string;
  number: number;
  episodeCount: number;
  status: SeasonStatus;
};

const STATUS_LABEL: Record<SeasonStatus, () => string> = {
  available: m.home_detail_season_available,
  requested: m.home_detail_season_requested,
  unavailable: m.home_detail_season_unavailable,
  upcoming: m.home_detail_season_upcoming,
};

const STATUS_VARIANT: Record<SeasonStatus, "default" | "outline" | "secondary"> = {
  available: "default",
  requested: "secondary",
  unavailable: "outline",
  upcoming: "outline",
};

const STATUS_FROM_API: Record<NonNullable<MediaDetailItem["status"]>, SeasonStatus | null> = {
  available: "available",
  requested: "requested",
  processing: "requested",
  unavailable: "unavailable",
  unknown: null,
};

function inferStatus(item: MediaDetailItem): SeasonStatus {
  const mapped = item.status ? STATUS_FROM_API[item.status] : null;
  if (mapped) return mapped;
  return item.episode ? "upcoming" : "available";
}

function buildSeasons(item: MediaDetailItem): Season[] {
  if (item.mediaType !== "tv") return [];
  const currentSeason = item.episode?.season ?? 1;
  const baseStatus = inferStatus(item);
  return Array.from({ length: currentSeason }, (_, idx) => {
    const number = idx + 1;
    const status: SeasonStatus = number < currentSeason ? "available" : baseStatus;
    return {
      id: `${item.id}-s${number}`,
      number,
      episodeCount: 8 + ((number * 2) % 5),
      status,
    };
  });
}

export function ModalSeasons({ item }: { item: MediaDetailItem }) {
  const seasons = buildSeasons(item);
  if (seasons.length === 0) return null;

  return (
    <section
      aria-label={m.home_detail_seasons_label()}
      className="flex flex-col gap-2 px-6 pb-10 sm:px-10"
    >
      {seasons.map((season, index) => (
        <SeasonRow key={season.id} season={season} defaultOpen={index === seasons.length - 1} />
      ))}
    </section>
  );
}

function SeasonRow({ season, defaultOpen }: { season: Season; defaultOpen: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger
        className={cn(
          "group flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-start transition-colors hover:bg-muted",
        )}
      >
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
        />
        <div className="flex-1">
          <div className="text-sm font-medium text-foreground">
            {m.home_detail_season_number({ n: String(season.number) })}
          </div>
          <div className="text-xs text-muted-foreground">
            {m.home_detail_season_episode_count({ n: String(season.episodeCount) })}
          </div>
        </div>
        <Badge variant={STATUS_VARIANT[season.status]} className="font-medium">
          {STATUS_LABEL[season.status]()}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 py-3 text-sm text-muted-foreground">
        <ul className="flex flex-col gap-2">
          {Array.from({ length: season.episodeCount }, (_, idx) => (
            <li
              key={idx}
              className="flex items-center justify-between border-b border-border/40 pb-2 last:border-b-0 last:pb-0"
            >
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span className="ms-3 flex-1 truncate text-foreground/90">
                {m.home_detail_season_episode_label({ n: String(idx + 1) })}
              </span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
