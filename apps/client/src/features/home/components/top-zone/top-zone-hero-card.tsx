import { Info, Play, X } from "lucide-react";
import * as m from "@/paraglide/messages";
import { MediaMetaRow } from "@/shared/components/media-meta-row";
import { Button } from "@/shared/ui/button";
import { deriveCardState, type CardAvailabilityState } from "../../lib/card-state";
import { MATCH_REASON_COPY } from "../../lib/home-feed-config";
import type { HomeMediaItem } from "../../lib/types";

type Props = {
  hero: HomeMediaItem;
  onMoreInfo: () => void;
  onDismiss?: () => void;
};

function formatKicker(state: CardAvailabilityState): string | null {
  if (state.kind === "server" && state.serverLabel) return state.serverLabel;
  if (state.kind === "server" && state.serverPicker)
    return m.home_card_servers_count({ n: String(state.serverCount) });
  if (state.kind === "request") return m.home_card_request();
  if (state.kind === "requested") return m.home_card_requested();
  if (state.kind === "upcoming") return m.home_card_upcoming();
  return null;
}

function progressPercent(progress: HomeMediaItem["progress"]): number | null {
  if (!progress) return null;
  const { watched, total } = progress;
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((watched / total) * 100)));
}

export function TopZoneHeroCard({ hero, onMoreInfo, onDismiss }: Props) {
  const state = deriveCardState(hero);
  const reason = hero.matchReasonKey
    ? MATCH_REASON_COPY[hero.matchReasonKey](hero.matchReasonParams ?? {})
    : null;
  const kicker = formatKicker(state);
  const percent = progressPercent(hero.progress);
  const hasProgress = percent !== null;

  return (
    <div className="relative z-10 flex min-h-[420px] flex-col justify-end gap-3 px-6 py-10 sm:min-h-[520px] sm:px-10 sm:py-14 lg:max-w-3xl">
      {hero.clearLogoText ? (
        <div
          aria-hidden="true"
          className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-foreground/85 drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)] sm:text-sm"
        >
          {hero.clearLogoText}
        </div>
      ) : null}
      {kicker ? (
        <div className="inline-flex w-fit items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-widest text-primary">
          {kicker}
        </div>
      ) : null}
      <h1 className="font-heading text-3xl font-semibold leading-[1.05] text-foreground drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)] sm:text-5xl">
        {hero.title}
      </h1>
      <MediaMetaRow
        year={hero.year}
        runtime={hero.runtime}
        ageRating={hero.ageRating}
        rating={hero.rating}
        genres={hero.genres}
      />
      {hero.overview ? (
        <p className="line-clamp-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {hero.overview}
        </p>
      ) : null}
      {reason ? <p className="text-sm text-muted-foreground/85">{reason}</p> : null}
      {hasProgress ? (
        <div className="flex w-full max-w-md flex-col gap-1.5">
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-foreground/15"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-progress-watched"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {m.home_hero_progress_watched({ percent: String(percent) })}
          </div>
        </div>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <Button size="lg" className="gap-2">
          <Play aria-hidden="true" className="size-4 fill-current" />
          {hasProgress ? m.home_hero_resume() : m.home_hero_play()}
        </Button>
        <Button size="lg" variant="secondary" className="gap-2" onClick={onMoreInfo}>
          <Info aria-hidden="true" className="size-4" />
          {m.home_hero_more_info()}
        </Button>
        {onDismiss ? (
          <Button
            size="lg"
            variant="ghost"
            className="gap-2 text-muted-foreground"
            onClick={onDismiss}
          >
            <X aria-hidden="true" className="size-4" />
            {m.home_hero_dismiss()}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
