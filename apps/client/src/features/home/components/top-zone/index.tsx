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
 * Hero stage. Mirrors the prototype's overlay-on-image structure: a stage
 * container holds a blurred ambient backdrop that bleeds outside the card
 * (YouTube-style spill), and a bounded hero card on top with the sharp
 * artwork, gradient scrims, and the hero copy overlay.
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
    let ticking = false;
    function update() {
      stage!.style.setProperty("--ambient-y", `${window.scrollY * PARALLAX_FACTOR}px`);
      ticking = false;
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function cycleAlternate() {
    setActiveIndex((idx) => (idx + 1) % candidates.length);
  }

  return (
    <section
      ref={stageRef}
      data-testid="top-zone"
      aria-label={hero.title}
      className="relative isolate mb-2"
    >
      <TopZoneAmbient src={ambientSrc} />
      <div className="relative z-10 aspect-2/3 w-full overflow-hidden rounded-[20px] bg-card shadow-hero sm:aspect-auto sm:h-[clamp(300px,42vh,400px)]">
        {ambientSrc ? (
          <img
            src={ambientSrc}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(180deg,transparent_45%,oklch(0_0_0/0.65)_100%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-2 h-35 rounded-t-[20px] bg-[linear-gradient(to_bottom,oklch(0_0_0/0.5)_0%,transparent_100%)]"
        />
        <TopZoneHeroCard
          hero={active}
          onMoreInfo={() => onPeek(active.id)}
          onDismiss={candidates.length > 1 ? cycleAlternate : undefined}
        />
      </div>
      {candidates.length > 1 ? (
        <nav
          aria-label={m.home_hero_alternates_label()}
          className="absolute inset-e-4 bottom-4 z-20 flex flex-wrap gap-1.5"
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
