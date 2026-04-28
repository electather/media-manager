import { useRef, type MouseEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import type { CompactMediaItem, RowKind } from "@ent-mcp/shared/home";
import { ROW_DISPLAY } from "@/lib/home-display";
import { cn } from "@/lib/utils";
import { useArtworkIfMissing } from "@/hooks/use-artwork";
import { useInView } from "@/hooks/use-in-view";
import { StatusPill } from "./status-pill";
import { RatingBadge } from "./rating-badge";
import { MatchReason } from "./match-reason";

export interface CardProps {
  item: CompactMediaItem;
  rowId: RowKind;
  size?: "row" | "hero" | "sidebar";
  /**
   * When true, the card is treated as above-the-fold and fetches artwork
   * eagerly. Below-fold cards defer until they intersect the viewport so
   * a single slow image upstream cannot block the rest of the row.
   */
  priority?: boolean;
  className?: string;
}

type Treatment = "continue" | "upcoming" | "default";

function pickTreatment(item: CompactMediaItem): Treatment {
  if (item.progress) return "continue";
  if (item.episode) return "upcoming";
  return "default";
}

function formatMinutesLeft(progress: { watched: number; total: number }): string {
  const remaining = Math.max(progress.total - progress.watched, 0);
  if (remaining <= 0) return "0min left";
  if (remaining < 60) return `${Math.round(remaining)}min left`;
  const hours = Math.floor(remaining / 60);
  const minutes = Math.round(remaining % 60);
  return minutes === 0 ? `${hours}h left` : `${hours}h ${minutes}min left`;
}

function formatEpisodeProgress(p: { watched: number; total: number }): string {
  return `${p.watched}/${p.total} watched`;
}

function progressPercent(progress: { watched: number; total: number }): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.max(0, (progress.watched / progress.total) * 100));
}

// `toLocaleTimeString` is only spec-bound to render time fields; passing
// `weekday` is a V8 extension other engines may drop. `Intl.DateTimeFormat`
// formats whatever combination of fields the options object names, so the
// weekday + time output is portable across engines.
const EPISODE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

function formatEpisodeLine(item: CompactMediaItem): string | null {
  if (!item.episode) return null;
  const { season, episode, airsAt } = item.episode;
  const time = EPISODE_TIME_FORMAT.format(new Date(airsAt));
  return `S${season} E${episode} · ${time}`;
}

export function Card({ item, rowId, size = "row", priority, className }: CardProps) {
  const router = useRouter();
  const display = ROW_DISPLAY[rowId];
  const treatment = pickTreatment(item);
  const aspect = display.aspectRatio === "poster" ? "aspect-[2/3]" : "aspect-video";

  const anchorRef = useRef<HTMLAnchorElement>(null);
  const isInView = useInView(anchorRef);
  const artwork = useArtworkIfMissing(
    {
      key: item.id,
      ids: { tmdb: item.tmdbId },
      type: item.mediaType,
      poster: item.poster,
      backdrop: item.backdrop,
      clearLogo: item.clearLogo,
    },
    ["poster"],
    { enabled: Boolean(priority) || isInView },
  );
  const posterUrl = artwork.data?.poster[0]?.url ?? item.poster;
  const backdropUrl = artwork.data?.backdrop[0]?.url ?? item.backdrop ?? posterUrl;
  const clearLogoUrl = artwork.data?.clearLogo[0]?.url ?? item.clearLogo;
  const art = display.aspectRatio === "poster" ? posterUrl : backdropUrl;

  const showClearLogo = size === "hero" && treatment === "continue" && clearLogoUrl;
  const showMatchReason =
    size !== "hero" && display.showMatchReasonInline && item.matchReason && treatment === "default";

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
    event.preventDefault();
    void router.navigate({
      to: ".",
      search: (prev) => ({ ...(prev as Record<string, unknown>), peek: item.id }),
      replace: false,
    });
  }

  return (
    <a
      ref={anchorRef}
      href={`/media/${item.id}`}
      onClick={handleClick}
      data-testid="home-card"
      data-card-link
      data-treatment={treatment}
      data-size={size}
      data-aspect={display.aspectRatio}
      className={cn(
        "group flex flex-col gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div className={cn("relative w-full overflow-hidden rounded-md bg-muted/40", aspect)}>
        {art ? (
          <img
            src={art}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-opacity group-hover:opacity-95"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            {item.title}
          </div>
        )}

        {showClearLogo && clearLogoUrl ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-[8%]">
            <img
              src={clearLogoUrl}
              alt={item.title}
              className="max-h-[60%] max-w-[70%] object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
            />
          </div>
        ) : null}

        {item.status && item.status !== "available" && item.status !== "unknown" ? (
          <StatusPill status={item.status} className="absolute right-2 top-2" />
        ) : null}

        {item.userRating ? (
          <RatingBadge rating={item.userRating} className="absolute left-2 top-2" />
        ) : null}

        {treatment === "continue" && item.progress ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15" aria-hidden>
            <div
              className="h-full bg-progress-watched"
              style={{ width: `${progressPercent(item.progress)}%` }}
            />
          </div>
        ) : null}
      </div>

      {size !== "hero" ? (
        <div className="flex flex-col gap-0.5">
          {treatment === "continue" && item.progress ? (
            <div className="flex items-center justify-between text-[11px] text-muted-foreground sm:text-xs">
              <span>{formatMinutesLeft(item.progress)}</span>
              {item.episodeProgress ? (
                <span>{formatEpisodeProgress(item.episodeProgress)}</span>
              ) : null}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-medium leading-tight text-foreground sm:text-sm">
                  {item.title}
                </span>
                {item.year && treatment === "default" ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground sm:text-xs">
                    {item.year}
                  </span>
                ) : null}
              </div>
              {treatment === "upcoming" ? (
                <span className="text-[11px] text-muted-foreground sm:text-xs">
                  {formatEpisodeLine(item)}
                </span>
              ) : null}
              {showMatchReason ? <MatchReason reason={item.matchReason!} /> : null}
            </>
          )}
        </div>
      ) : null}
    </a>
  );
}
