import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import * as m from "@/paraglide/messages";
import type { HeroItem, HomeMediaItem } from "../../lib/types";
import { TopZoneAmbient } from "./top-zone-ambient";
import { TopZoneHeroCard } from "./top-zone-hero-card";

type Props = {
  hero: HeroItem;
  onPeek: (id: string) => void;
};

const PARALLAX_FACTOR = 0.25;

function useAmbientParallax(stageRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageElement = stage;
    let ticking = false;
    function update() {
      stageElement.style.setProperty("--ambient-y", `${window.scrollY * PARALLAX_FACTOR}px`);
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
  }, [stageRef]);
}

function HeroArtwork({ src }: { src: string | undefined }) {
  if (!src) return null;
  return (
    <img src={src} alt="" aria-hidden="true" className="absolute inset-0 size-full object-cover" />
  );
}

function HeroFrame({
  ambientSrc,
  children,
}: {
  ambientSrc: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="relative z-10 aspect-2/3 w-full overflow-hidden rounded-4xl bg-card shadow-hero sm:aspect-auto sm:h-[clamp(26rem,58vh,42rem)] lg:h-[clamp(30rem,64vh,46rem)]">
      <HeroArtwork src={ambientSrc} />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,transparent_45%,oklch(0_0_0/0.65)_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-2 h-35 rounded-t-4xl bg-[linear-gradient(to_bottom,oklch(0_0_0/0.5)_0%,transparent_100%)]"
      />
      {children}
    </div>
  );
}

function HeroAlternates({
  candidates,
  activeIndex,
  onSelect,
}: {
  candidates: readonly HomeMediaItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  if (candidates.length <= 1) return null;
  return (
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
            onClick={() => onSelect(index)}
            className={
              isActive
                ? "size-2 rounded-full bg-primary"
                : "size-2 rounded-full bg-muted-foreground/40 transition-colors hover:bg-muted-foreground"
            }
          />
        );
      })}
    </nav>
  );
}

function dismissHandler(candidates: readonly HomeMediaItem[], onDismiss: () => void) {
  return candidates.length > 1 ? onDismiss : undefined;
}

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
  useAmbientParallax(stageRef);

  const cycleAlternate = useCallback(() => {
    setActiveIndex((idx) => (idx + 1) % candidates.length);
  }, [candidates.length]);

  return (
    <section
      ref={stageRef}
      data-testid="top-zone"
      aria-label={hero.title}
      className="relative isolate mb-2 overflow-x-clip overflow-y-visible"
    >
      <TopZoneAmbient src={ambientSrc} />
      <HeroFrame ambientSrc={ambientSrc}>
        <TopZoneHeroCard
          hero={active}
          onMoreInfo={() => onPeek(active.id)}
          onDismiss={dismissHandler(candidates, cycleAlternate)}
        />
      </HeroFrame>
      <HeroAlternates candidates={candidates} activeIndex={activeIndex} onSelect={setActiveIndex} />
    </section>
  );
}
