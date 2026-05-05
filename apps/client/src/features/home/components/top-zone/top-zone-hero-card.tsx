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

export function TopZoneHeroCard({ hero, onMoreInfo, onDismiss }: Props) {
  const state = deriveCardState(hero);
  const reason = hero.matchReasonKey
    ? MATCH_REASON_COPY[hero.matchReasonKey](hero.matchReasonParams ?? {})
    : null;
  const kicker = formatKicker(state);

  return (
    <div className="relative z-10 flex min-h-[420px] flex-col justify-end gap-4 px-6 py-10 sm:min-h-[520px] sm:px-10 sm:py-14 lg:max-w-3xl">
      {kicker ? (
        <div className="font-mono text-xs uppercase tracking-widest text-primary">{kicker}</div>
      ) : null}
      <HeroTitle hero={hero} />
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
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" className="gap-2">
          <Play aria-hidden="true" className="size-4 fill-current" />
          {m.home_hero_play()}
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

function HeroTitle({ hero }: { hero: HomeMediaItem }) {
  if (hero.clearLogoText) {
    return (
      <h1
        aria-label={hero.title}
        className="font-mono text-3xl font-bold tracking-[0.18em] text-foreground drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)] sm:text-5xl"
      >
        {hero.clearLogoText}
      </h1>
    );
  }
  return (
    <h1 className="font-heading text-3xl font-semibold text-foreground drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)] sm:text-5xl">
      {hero.title}
    </h1>
  );
}
