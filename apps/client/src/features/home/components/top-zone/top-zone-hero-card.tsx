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
    <div className="absolute inset-x-0 bottom-0 z-3 flex w-[86%] max-w-180 flex-col items-start gap-2 px-5 pt-6 pb-5 text-foreground sm:px-8 sm:pt-7 sm:pb-6.5 before:pointer-events-none before:absolute before:-inset-y-10 before:-inset-e-20 before:-inset-s-6 before:-z-1 before:bg-[radial-gradient(ellipse_at_bottom_left,oklch(0_0_0/0.76),oklch(0_0_0/0.44)_46%,transparent_72%)] before:content-['']">
      {hero.clearLogoText ? (
        <div
          aria-hidden="true"
          className="font-mono text-[13px] font-bold uppercase tracking-[0.16em] text-foreground drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)]"
        >
          {hero.clearLogoText}
        </div>
      ) : null}
      {kicker ? (
        <div className="inline-flex min-h-5.5 w-fit items-center rounded-md border border-white/15 bg-black/40 px-2 font-mono text-[11px] uppercase tracking-[0.04em] text-primary">
          {kicker}
        </div>
      ) : null}
      <h1 className="m-0 max-w-170 text-balance font-heading text-[28px] font-bold leading-[1.08] text-foreground drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)] sm:text-[38px] sm:leading-[1.03]">
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
        <p className="m-0 line-clamp-3 max-w-155 text-pretty text-[13px] leading-[1.45] text-muted-foreground sm:text-sm">
          {hero.overview}
        </p>
      ) : null}
      {reason ? <p className="text-xs text-muted-foreground/85">{reason}</p> : null}
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
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button size="default" className="gap-2">
          <Play aria-hidden="true" className="size-4 fill-current" />
          {hasProgress ? m.home_hero_resume() : m.home_hero_play()}
        </Button>
        <Button size="default" variant="secondary" className="gap-2" onClick={onMoreInfo}>
          <Info aria-hidden="true" className="size-4" />
          {m.home_hero_more_info()}
        </Button>
        {onDismiss ? (
          <Button
            size="default"
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
