import { useMemo, useState } from "react";
import * as m from "@/paraglide/messages";
import type { HeroItem, HomeMediaItem } from "../../lib/types";
import { TopZoneAmbient } from "./top-zone-ambient";
import { TopZoneHeroCard } from "./top-zone-hero-card";

type Props = {
  hero: HeroItem;
  onPeek: (id: string) => void;
};

export function TopZone({ hero, onPeek }: Props) {
  const candidates = useMemo<HomeMediaItem[]>(() => [hero, ...hero.alternates], [hero]);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = candidates[activeIndex] ?? hero;
  const ambientSrc = active.backdrop ?? active.poster;

  return (
    <section
      data-testid="top-zone"
      aria-label={hero.title}
      className="relative isolate -mx-4 mb-8 overflow-hidden rounded-3xl bg-card sm:-mx-6"
    >
      <TopZoneAmbient src={ambientSrc} />
      <TopZoneHeroCard hero={hero} onMoreInfo={() => onPeek(hero.id)} />
      {candidates.length > 1 ? (
        <nav
          aria-label={m.home_hero_alternates_label()}
          className="absolute end-4 bottom-4 z-20 flex flex-wrap gap-1.5"
          data-testid="top-zone-alternates"
        >
          {candidates.map((item, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={isActive ? "true" : undefined}
                aria-label={item.title}
                onClick={() => setActiveIndex(index)}
                className={
                  isActive
                    ? "size-2 rounded-full bg-primary"
                    : "size-2 rounded-full bg-muted-foreground/40 transition-colors hover:bg-muted-foreground"
                }
              />
            );
          })}
        </nav>
      ) : null}
    </section>
  );
}
