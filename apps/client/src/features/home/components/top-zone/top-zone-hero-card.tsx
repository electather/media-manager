import * as m from "@/paraglide/messages";
import { MediaMetaRow } from "@/shared/components/media-meta-row";
import { deriveCardState, type CardAvailabilityState } from "../../lib/card-state";
import { MATCH_REASON_COPY } from "../../lib/home-feed-config";
import type { HomeMediaItem } from "../../lib/types";
import { TopZoneHeroActions } from "./top-zone-hero-actions";
import { TopZoneHeroProgress } from "./top-zone-hero-progress";

type Props = {
  hero: HomeMediaItem;
  onMoreInfo: () => void;
  onDismiss?: () => void;
};

function formatServerKicker(state: CardAvailabilityState): string | null {
  if (state.serverLabel) return state.serverLabel;
  if (state.serverPicker) return m.home_card_servers_count({ n: String(state.serverCount) });
  return null;
}

// Exhaustive switch so a new CardAvailabilityKind triggers a TypeScript error
// instead of silently dropping the kicker.
function formatKicker(state: CardAvailabilityState): string | null {
  switch (state.kind) {
    case "server":
      return formatServerKicker(state);
    case "request":
      return m.home_card_request();
    case "requested":
      return m.home_card_requested();
    case "upcoming":
      return m.home_card_upcoming();
    case "info":
      return null;
  }
}

function progressPercent(progress: HomeMediaItem["progress"]): number | null {
  if (!progress) return null;
  const { watched, total } = progress;
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((watched / total) * 100)));
}

export function TopZoneHeroCard({ hero, onMoreInfo, onDismiss }: Props) {
  const kicker = formatKicker(deriveCardState(hero));
  const reason = hero.matchReasonKey
    ? MATCH_REASON_COPY[hero.matchReasonKey](hero.matchReasonParams ?? {})
    : null;
  const percent = progressPercent(hero.progress);

  return (
    <div className="absolute inset-x-0 bottom-0 z-3 flex w-[86%] max-w-180 flex-col items-start gap-2 px-5 pt-6 pb-5 text-foreground sm:px-8 sm:pt-7 sm:pb-6.5 before:pointer-events-none before:absolute before:-inset-y-10 before:-inset-e-20 before:-inset-s-6 before:-z-1 before:bg-[radial-gradient(ellipse_at_bottom_left,oklch(0_0_0/0.76),oklch(0_0_0/0.44)_46%,transparent_72%)] before:content-['']">
      {hero.clearLogoText ? (
        <div
          aria-hidden="true"
          className="font-mono text-sm font-bold uppercase tracking-[0.16em] text-foreground drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)]"
        >
          {hero.clearLogoText}
        </div>
      ) : null}
      {kicker ? (
        <div className="inline-flex min-h-5.5 w-fit items-center rounded-md border border-border bg-card/40 px-2 font-mono text-xs uppercase tracking-[0.04em] text-primary">
          {kicker}
        </div>
      ) : null}
      <h1 className="m-0 max-w-170 text-balance font-heading text-3xl font-bold leading-[1.08] text-foreground drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)] sm:text-4xl sm:leading-[1.03]">
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
        <p className="m-0 line-clamp-3 max-w-155 text-pretty text-sm leading-[1.45] text-muted-foreground">
          {hero.overview}
        </p>
      ) : null}
      {reason ? <p className="text-xs text-muted-foreground/85">{reason}</p> : null}
      {percent !== null ? <TopZoneHeroProgress percent={percent} /> : null}
      <TopZoneHeroActions
        hasProgress={percent !== null}
        onMoreInfo={onMoreInfo}
        onDismiss={onDismiss}
      />
    </div>
  );
}
