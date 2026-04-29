import type { MouseEvent } from "react";
import type { CompactMediaItem } from "@ent-mcp/shared/home";

import { cn } from "@/shared/lib/utils";

import { deriveAspect, deriveTreatment } from "../lib/aspect";
import { useOpenPeek } from "../lib/peek";
import { formatRelativeAirDate } from "../lib/relative-date";
import { MatchReason } from "./match-reason";
import { ProgressBar } from "./progress-bar";
import { RatingBadge } from "./rating-badge";
import { StatusPill } from "./status-pill";

interface CardProps {
  item: CompactMediaItem;
  isHero?: boolean;
}

const ASPECT_CLASS: Record<"16/9" | "2/3", string> = {
  "16/9": "aspect-[16/9]",
  "2/3": "aspect-[2/3]",
};

export function Card({ item, isHero = false }: CardProps) {
  const open = useOpenPeek();
  const treatment = deriveTreatment(item);
  const aspect = deriveAspect(item, { isHero });
  const image = aspect === "16/9" ? (item.backdrop ?? item.poster) : (item.poster ?? item.backdrop);

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
    event.preventDefault();
    open(item.id);
  };

  return (
    <a
      href={`/media/${item.id}`}
      onClick={onClick}
      data-treatment={treatment}
      data-aspect={aspect}
      className={cn(
        "card group relative block overflow-hidden rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "@container",
      )}
    >
      <div className={cn("relative w-full overflow-hidden bg-muted", ASPECT_CLASS[aspect])}>
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn(
              "h-full w-full object-cover transition-transform duration-[250ms] ease-out",
              "motion-reduce:transition-none",
              treatment === "continue-watching" || aspect !== "16/9"
                ? "group-hover:scale-105"
                : "group-hover:scale-105",
            )}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
            {item.title}
          </div>
        )}
        {aspect === "16/9" && item.clearLogo ? (
          <img
            src={item.clearLogo}
            alt=""
            aria-hidden
            className="pointer-events-none absolute bottom-2 right-2 z-[1] max-w-[30%] drop-shadow-md"
          />
        ) : null}
        {treatment === "continue-watching" && item.progress ? (
          <ProgressBar watched={item.progress.watched} total={item.progress.total} />
        ) : null}
        <StatusPill status={item.status} />
        <RatingBadge rating={item.userRating} />
        <span className="pointer-events-none absolute inset-0 ring-0 ring-border transition group-hover:ring-1 group-focus-visible:ring-1" />
      </div>
      <div className="mt-2 flex flex-col gap-0.5">
        <p className="line-clamp-2 text-[13px] font-medium leading-tight text-foreground/90 transition-colors group-hover:text-foreground sm:text-sm">
          {item.title}
        </p>
        {treatment === "continue-watching" && item.progress ? (
          <CaptionRow
            left={`${minutesLeft(item.progress)} left`}
            right={
              item.episodeProgress
                ? `${item.episodeProgress.watched}/${item.episodeProgress.total} watched`
                : undefined
            }
          />
        ) : null}
        {treatment === "upcoming" && item.episode ? (
          <p className="text-[11px] text-muted-foreground sm:text-xs">
            S{item.episode.season} E{item.episode.episode} ·{" "}
            {formatRelativeAirDate(item.episode.airsAt)}
          </p>
        ) : null}
        {treatment === "default" && item.year ? (
          <p className="text-[11px] text-muted-foreground sm:text-xs">{item.year}</p>
        ) : null}
        <MatchReason reason={item.matchReason} />
      </div>
    </a>
  );
}

function CaptionRow({ left, right }: { left: string; right?: string }) {
  return (
    <p className="flex items-center justify-between text-[11px] text-muted-foreground sm:text-xs">
      <span>{left}</span>
      {right ? <span>{right}</span> : null}
    </p>
  );
}

function minutesLeft(progress: { watched: number; total: number }): string {
  const remaining = Math.max(0, progress.total - progress.watched);
  if (remaining === 0) return "Done";
  if (remaining < 60) return `${Math.round(remaining)}m`;
  const hours = Math.floor(remaining / 60);
  const mins = Math.round(remaining % 60);
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}
