import { Info, Play } from "lucide-react";
import * as m from "@/paraglide/messages";
import { MediaMetaRow } from "@/shared/components/media-meta-row";
import { Button } from "@/shared/ui/button";
import type { HomeMediaItem } from "../../lib/types";

type Props = {
  hero: HomeMediaItem;
  onMoreInfo: () => void;
};

export function TopZoneHeroCard({ hero, onMoreInfo }: Props) {
  return (
    <div className="relative z-10 flex min-h-[420px] flex-col justify-end gap-5 px-6 py-10 sm:px-10 sm:py-14 lg:max-w-3xl">
      <HeroTitle hero={hero} />
      <MediaMetaRow
        year={hero.year}
        runtime={hero.runtime}
        ageRating={hero.ageRating}
        rating={hero.rating}
        genres={hero.genres}
      />
      {hero.overview ? (
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {hero.overview}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" className="gap-2">
          <Play aria-hidden="true" className="size-4 fill-current" />
          {m.home_hero_play()}
        </Button>
        <Button size="lg" variant="secondary" className="gap-2" onClick={onMoreInfo}>
          <Info aria-hidden="true" className="size-4" />
          {m.home_hero_more_info()}
        </Button>
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
