import { ChevronDown } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Badge } from "@/shared/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible";
import type { EpisodeData, EpisodeStatus, MediaDetailItem, SeasonData } from "./types";

type SeasonStatus = EpisodeStatus | "partial";

const STATUS_LABEL: Record<SeasonStatus, () => string> = {
  available: m.home_detail_season_available,
  requested: m.home_detail_season_requested,
  unavailable: m.home_detail_season_unavailable,
  upcoming: m.home_detail_season_upcoming,
  partial: m.home_detail_season_partial,
};

const STATUS_VARIANT: Record<SeasonStatus, "default" | "outline" | "secondary"> = {
  available: "default",
  requested: "secondary",
  unavailable: "outline",
  upcoming: "outline",
  partial: "secondary",
};

function inferSeasonStatus(season: SeasonData): SeasonStatus {
  const { counts, episodeCount } = season;
  const available = counts.available ?? 0;
  const requested = counts.requested ?? 0;
  const upcoming = counts.upcoming ?? 0;
  const unavailable = counts.unavailable ?? 0;

  if (upcoming === episodeCount) return "upcoming";
  if (available === episodeCount) return "available";
  if (unavailable === episodeCount) return "unavailable";
  if (requested === episodeCount) return "requested";
  // "partial" covers any case where some episodes are available but the
  // season isn't fully available yet (the rest may be upcoming, missing,
  // or requested). The previous predicate `available < episodeCount - upcoming`
  // misclassified seasons where `available + upcoming === episodeCount` as
  // unavailable; switching to `available + upcoming <= episodeCount` keeps
  // them in "partial".
  if (available > 0 && available + upcoming <= episodeCount) return "partial";
  if (requested > 0) return "requested";
  return "unavailable";
}

function buildSeasonSubline(season: SeasonData, status: SeasonStatus): string | null {
  const { counts, episodeCount } = season;
  const available = counts.available ?? 0;
  const requested = counts.requested ?? 0;
  const upcoming = counts.upcoming ?? 0;

  if (status === "upcoming") {
    return m.home_detail_season_subline_upcoming({ n: String(episodeCount) });
  }
  if (status === "partial") {
    const parts: string[] = [
      m.home_detail_season_of_episodes({
        available: String(available),
        total: String(episodeCount),
      }),
    ];
    if (requested > 0) {
      parts.push(m.home_detail_season_subline_requested({ n: String(requested) }));
    }
    if (upcoming > 0) {
      parts.push(m.home_detail_season_subline_upcoming_count({ n: String(upcoming) }));
    }
    return parts.join(" · ");
  }
  return null;
}

const EP_STATUS_LABEL: Record<EpisodeStatus, () => string> = {
  available: m.home_detail_episode_status_available,
  requested: m.home_detail_episode_status_requested,
  unavailable: m.home_detail_episode_status_unavailable,
  upcoming: m.home_detail_episode_status_upcoming,
};

const EP_STATUS_VARIANT: Record<EpisodeStatus, "default" | "outline" | "secondary"> = {
  available: "default",
  requested: "secondary",
  unavailable: "outline",
  upcoming: "outline",
};

export function ModalSeasons({ item }: { item: MediaDetailItem }) {
  const seasons = item.seasons;
  if (item.mediaType !== "tv" || !seasons || seasons.length === 0) return null;

  return (
    <section
      aria-label={m.home_detail_seasons_label()}
      className="flex flex-col gap-2 px-6 sm:px-10"
    >
      {seasons.map((season, index) => (
        <SeasonRow
          key={`${item.id}-s${season.number}`}
          season={season}
          defaultOpen={index === seasons.length - 1}
        />
      ))}
    </section>
  );
}

function SeasonRow({ season, defaultOpen }: { season: SeasonData; defaultOpen: boolean }) {
  const status = inferSeasonStatus(season);
  const subline = buildSeasonSubline(season, status);

  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="overflow-hidden rounded-xl border border-border bg-card/80"
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-muted/40">
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
        />
        <div className="flex-1">
          <div className="text-sm font-medium text-foreground">
            {m.home_detail_season_number({ n: String(season.number) })}
          </div>
          {subline ? (
            <div className="text-xs text-muted-foreground">{subline}</div>
          ) : (
            <div className="text-xs text-muted-foreground">
              {m.home_detail_season_episode_count({ n: String(season.episodeCount) })}
            </div>
          )}
        </div>
        <Badge variant={STATUS_VARIANT[status]} className="font-medium">
          {STATUS_LABEL[status]()}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border/60 bg-background/30">
        <EpisodeList episodes={season.episodes} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function EpisodeList({ episodes }: { episodes: EpisodeData[] }) {
  return (
    <ul className="flex flex-col">
      {episodes.map((ep) => (
        <EpisodeRow key={ep.id} ep={ep} />
      ))}
    </ul>
  );
}

function EpisodeRow({ ep }: { ep: EpisodeData }) {
  const dim = ep.status === "unavailable" || ep.status === "upcoming";
  return (
    <li
      className={`grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-border/40 px-4 py-2.5 last:border-b-0 ${dim ? "opacity-60" : ""}`}
    >
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {String(ep.episode).padStart(2, "0")}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{ep.title}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{ep.airDate}</span>
          {ep.status !== "upcoming" && (
            <>
              <span aria-hidden="true">·</span>
              <span>{ep.runtime} min</span>
            </>
          )}
        </div>
      </div>
      <Badge
        variant={EP_STATUS_VARIANT[ep.status]}
        className="shrink-0 font-mono text-[10px] tracking-[0.04em] uppercase"
      >
        <span className="mr-1.5 inline-block size-1.5 rounded-full bg-current" aria-hidden="true" />
        {EP_STATUS_LABEL[ep.status]()}
      </Badge>
    </li>
  );
}
