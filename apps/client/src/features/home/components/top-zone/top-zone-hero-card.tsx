import * as m from "@/paraglide/messages";
import { MediaMetaRow } from "@/shared/components/media-meta-row";
import { deriveCardState, type CardAvailabilityState } from "../../lib/card-state";
import { MATCH_REASON_COPY } from "../../lib/home-feed-config";
import type { HomeMediaItem } from "../../lib/types";
import { TopZoneHeroActions } from "./top-zone-hero-actions";

type Props = {
  hero: HomeMediaItem;
  percent: number | null;
  onPlay: () => void;
  onMoreInfo: () => void;
  onDismiss?: () => void;
};

function formatServerKicker(state: CardAvailabilityState): string | null {
  if (state.serverLabel) return state.serverLabel;
  if (state.serverPicker) return m.home_card_servers_count({ n: String(state.serverCount) });
  return null;
}

const KICKER_COPY_BY_KIND = {
  request: m.home_card_request,
  requested: m.home_card_requested,
  upcoming: m.home_card_upcoming,
  info: () => null,
} satisfies Record<Exclude<CardAvailabilityState["kind"], "server">, () => string | null>;

function formatKicker(state: CardAvailabilityState): string | null {
  if (state.kind === "server") return formatServerKicker(state);
  return KICKER_COPY_BY_KIND[state.kind]();
}

function matchReasonFor(hero: HomeMediaItem): string | null {
  if (!hero.matchReason) return null;
  return MATCH_REASON_COPY[hero.matchReason.key](hero.matchReason.params ?? {});
}

function HeroClearLogo({
  src,
  text,
  alt,
}: {
  src: string | undefined;
  text: string | undefined;
  alt: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="eager"
        decoding="async"
        className="max-h-16 w-auto max-w-[55%] object-contain object-left drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)] sm:max-h-24"
      />
    );
  }
  if (!text) return null;
  return (
    <div
      aria-hidden="true"
      className="font-mono text-sm font-bold uppercase tracking-[0.16em] text-foreground drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)]"
    >
      {text}
    </div>
  );
}

function HeroKicker({ value }: { value: string | null }) {
  if (!value) return null;
  return (
    <div className="inline-flex min-h-5.5 w-fit items-center rounded-md border border-border bg-card/40 px-2 font-mono text-xs uppercase tracking-[0.04em] text-primary">
      {value}
    </div>
  );
}

function HeroOverview({ value }: { value: string | undefined }) {
  if (!value) return null;
  return (
    <p className="m-0 line-clamp-3 max-w-170 text-pretty text-sm leading-[1.5] text-foreground/85 sm:line-clamp-4 sm:text-base sm:leading-[1.58]">
      {value}
    </p>
  );
}

function HeroReason({ value }: { value: string | null }) {
  if (!value) return null;
  return <p className="text-xs text-foreground/70 sm:text-sm">{value}</p>;
}

export function TopZoneHeroCard({ hero, percent, onPlay, onMoreInfo, onDismiss }: Props) {
  const kicker = formatKicker(deriveCardState(hero));
  const reason = matchReasonFor(hero);

  return (
    <div className="absolute inset-x-0 bottom-0 z-3 flex w-[88%] max-w-205 flex-col items-start gap-2.5 px-5 pt-6 pb-5 text-foreground sm:gap-3 sm:px-9 sm:pt-9 sm:pb-8 md:px-10 md:pb-9 before:pointer-events-none before:absolute before:-inset-y-14 before:-inset-e-28 before:-inset-s-8 before:-z-1 before:bg-[radial-gradient(ellipse_at_bottom_left,oklch(0_0_0/0.84),oklch(0_0_0/0.62)_45%,transparent_76%)] before:content-['']">
      <HeroClearLogo src={hero.clearLogo} text={hero.clearLogoText} alt={hero.title} />
      <HeroKicker value={kicker} />
      <h1 className="m-0 max-w-180 text-balance font-heading text-3xl font-bold leading-[1.08] text-foreground drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)] sm:text-5xl sm:leading-[1.03]">
        {hero.title}
      </h1>
      <MediaMetaRow
        year={hero.year}
        runtime={hero.runtime}
        ageRating={hero.ageRating}
        rating={hero.rating}
        genres={hero.genres}
        className="text-foreground/75 sm:text-base"
      />
      <HeroOverview value={hero.overview} />
      <HeroReason value={reason} />
      <TopZoneHeroActions
        hasProgress={percent !== null}
        onPlay={onPlay}
        onMoreInfo={onMoreInfo}
        onDismiss={onDismiss}
      />
    </div>
  );
}
