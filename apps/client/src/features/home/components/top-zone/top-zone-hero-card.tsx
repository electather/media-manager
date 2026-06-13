import type { RowKind } from "@nama/shared/home";
import { MediaMetaRow } from "@/shared/components/media-meta-row";
import { cn } from "@/shared/lib/utils";
import { MediaCardAvailability, deriveMediaCardAvailability } from "@/shared/components/media-card";
import { MATCH_REASON_COPY } from "../../lib/home-feed-config";
import type { HomeMediaItem } from "../../lib/types";
import { sourceLabel } from "./source-label";
import { TopZoneHeroActions } from "./top-zone-hero-actions";

type Props = {
  hero: HomeMediaItem;
  /**
   * Active slide's `RowKind`. Drives the per-slide source chip rendered above
   * the title — matches the row header of the source row below the hero so
   * users can see which row the active slide is drawn from.
   */
  source: RowKind;
  percent: number | null;
  onPlay: () => void;
  onMoreInfo: () => void;
  onDismiss?: () => void;
};

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

function HeroOverview({ value }: { value: string | undefined }) {
  if (!value) return null;
  return (
    <p className="m-0 line-clamp-3 max-w-170 text-pretty text-sm leading-normal text-foreground/85 sm:line-clamp-4 sm:text-base sm:leading-[1.58]">
      {value}
    </p>
  );
}

function HeroReason({ value }: { value: string | null }) {
  if (!value) return null;
  return <p className="text-xs text-foreground/70 sm:text-sm">{value}</p>;
}

function HeroSourceLabel({ value }: { value: string }) {
  return (
    <p
      data-testid="top-zone-source-label"
      className="font-mono text-xs uppercase tracking-[0.16em] text-foreground/70 sm:text-sm"
    >
      {value}
    </p>
  );
}

export function TopZoneHeroCard({ hero, source, percent, onPlay, onMoreInfo, onDismiss }: Props) {
  const availability = deriveMediaCardAvailability(hero);
  const reason = matchReasonFor(hero);
  // For movies the clear logo is the stylized title artwork, so showing a
  // separate heading underneath duplicates the same words. Keep the heading
  // in the accessibility tree (sr-only) so the section still has a level-1
  // landmark and screen-reader users get a heading to navigate to.
  const logoActsAsTitle =
    hero.mediaType === "movie" && Boolean(hero.clearLogo ?? hero.clearLogoText);

  return (
    <>
      <MediaCardAvailability
        state={availability}
        className="pointer-events-none absolute inset-e-4 top-4 z-4 max-w-[calc(100%-2rem)] overflow-hidden text-ellipsis whitespace-nowrap sm:inset-e-6 sm:top-6"
      />
      <div className="absolute inset-x-0 bottom-0 z-3 flex w-[88%] max-w-205 flex-col items-start gap-2.5 px-5 pt-6 pb-5 text-foreground sm:gap-3 sm:px-9 sm:pt-9 sm:pb-8 md:px-10 md:pb-9">
        <HeroSourceLabel value={sourceLabel(source)} />
        <HeroClearLogo src={hero.clearLogo} text={hero.clearLogoText} alt={hero.title} />
        <h1
          className={cn(
            "m-0 max-w-180 text-balance font-heading text-3xl font-bold leading-[1.08] text-foreground drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)] sm:text-5xl sm:leading-[1.03]",
            logoActsAsTitle && "sr-only",
          )}
        >
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
    </>
  );
}
