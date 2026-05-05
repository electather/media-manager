import { useEffect, useMemo, useRef, useState } from "react";
import * as m from "@/paraglide/messages";
import type { HeroItem, HomeMediaItem } from "../../lib/types";
import { TopZoneAmbient } from "./top-zone-ambient";
import { TopZoneHeroCard } from "./top-zone-hero-card";

type Props = {
  hero: HeroItem;
  onPeek: (id: string) => void;
};

const PARALLAX_FACTOR = 0.25;

/**
 * Hero stage. Mirrors the prototype's overlay-on-image structure: ambient
 * backdrop layer with crossfade + parallax, foreground hero card with full
 * action cluster, and a dot-nav for cycling between hero candidates.
 */
export function TopZone({ hero, onPeek }: Props) {
  const candidates = useMemo<HomeMediaItem[]>(() => [hero, ...hero.alternates], [hero]);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = candidates[activeIndex] ?? hero;
  const ambientSrc = active.backdrop ?? active.poster;

  const stageRef = useRef<HTMLElement>(null);

  // Drive a CSS custom property from page scroll so the backdrop translates
  // independently of the foreground without re-rendering React per frame.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const handler = () => {
      stage.style.setProperty("--ambient-y", `${window.scrollY * PARALLAX_FACTOR}px`);
    };
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  function cycleAlternate() {
    setActiveIndex((idx) => (idx + 1) % candidates.length);
  }

  return (
    <section
      ref={stageRef}
      data-testid="top-zone"
      aria-label={hero.title}
      className="relative isolate -mx-4 mb-8 min-h-[420px] overflow-hidden rounded-3xl bg-card sm:-mx-6 sm:min-h-[520px]"
    >
      <TopZoneAmbient src={ambientSrc} />
      <TopZoneHeroCard
        hero={active}
        onMoreInfo={() => onPeek(active.id)}
        onDismiss={candidates.length > 1 ? cycleAlternate : undefined}
      />
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
