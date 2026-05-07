import { useCallback, useState, type ReactNode } from "react";
import { clamp } from "es-toolkit";
import * as m from "@/paraglide/messages";
import type { HeroSlideUI, HomeMediaItem } from "../../lib/types";
import { ProgressOverlay } from "../progress-overlay";
import { TopZoneAmbient } from "./top-zone-ambient";
import { TopZoneHeroCard } from "./top-zone-hero-card";

function progressPercent(progress: HomeMediaItem["progress"]): number | null {
  if (!progress) return null;
  const { watched, total } = progress;
  if (!total || total <= 0) return null;
  return clamp(Math.round((watched / total) * 100), 0, 100);
}

type Props = {
  slides: HeroSlideUI[];
  onPeek: (id: string) => void;
};

function HeroArtwork({ src }: { src: string | undefined }) {
  if (!src) return null;
  return (
    <img src={src} alt="" aria-hidden="true" className="absolute inset-0 size-full object-cover" />
  );
}

function HeroFrame({
  ambientSrc,
  percent,
  children,
}: {
  ambientSrc: string | undefined;
  percent: number | null;
  children: ReactNode;
}) {
  return (
    <div className="relative z-10 aspect-2/3 max-h-[60lvh] w-full rounded-4xl bg-card shadow-hero sm:aspect-auto sm:max-h-none sm:h-[clamp(26rem,58vh,42rem)] lg:h-[clamp(30rem,64vh,46rem)]">
      <div
        data-testid="top-zone-hero-frame"
        className="absolute inset-0 isolate overflow-hidden rounded-4xl bg-card transform-gpu backface-hidden [clip-path:inset(0_round_var(--radius-4xl))]"
      >
        <HeroArtwork src={ambientSrc} />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(ellipse_120%_85%_at_50%_100%,oklch(0_0_0/0.7)_0%,oklch(0_0_0/0.35)_45%,transparent_80%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-2 h-35 rounded-t-4xl bg-[linear-gradient(to_bottom,oklch(0_0_0/0.5)_0%,transparent_100%)]"
        />
        {children}
        {percent !== null && (
          <ProgressOverlay
            percent={percent}
            ariaLabel={m.home_hero_progress_watched({ percent: String(percent) })}
            className="z-3"
          />
        )}
      </div>
    </div>
  );
}

function HeroAlternates({
  candidates,
  activeIndex,
  onSelect,
}: {
  candidates: readonly HeroSlideUI[];
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

function dismissHandler(candidates: readonly HeroSlideUI[], onDismiss: () => void) {
  return candidates.length > 1 ? onDismiss : undefined;
}

/**
 * Hero stage. Mirrors the prototype's overlay-on-image structure: a stage
 * container holds a blurred ambient backdrop that bleeds outside the card
 * (YouTube-style spill), and a bounded hero card on top with the sharp
 * artwork, gradient scrims, and the hero copy overlay. The carousel cycles
 * through `slides[]` (mixed sources per Amendment 3 of the home backend
 * design doc); each slide carries its own `source` so the hero card can
 * label which row the slide is drawn from.
 */
export function TopZone({ slides, onPeek }: Props) {
  const candidates = slides;
  const [activeIndex, setActiveIndex] = useState(0);
  const active = candidates[activeIndex] ?? candidates[0]!;
  const ambientSrc = active.backdrop ?? active.poster;
  const percent = progressPercent(active.progress);

  const cycleAlternate = useCallback(() => {
    setActiveIndex((idx) => (idx + 1) % candidates.length);
  }, [candidates.length]);

  return (
    <section
      data-testid="top-zone"
      aria-label={candidates[0]?.title ?? ""}
      className="relative isolate z-10 mb-2"
    >
      <TopZoneAmbient src={ambientSrc} />
      <HeroFrame ambientSrc={ambientSrc} percent={percent}>
        <TopZoneHeroCard
          hero={active}
          source={active.source}
          percent={percent}
          // v1: `slide.resumeUrl === null` (R2 / Amendment 3 §Server composition
          // step 6) — plugin SDK has no `playback@v1.getResumeUrl` method, so
          // Play opens the detail modal as a nav-to-detail action.
          onPlay={() => onPeek(active.id)}
          onMoreInfo={() => onPeek(active.id)}
          onDismiss={dismissHandler(candidates, cycleAlternate)}
        />
      </HeroFrame>
      <HeroAlternates candidates={candidates} activeIndex={activeIndex} onSelect={setActiveIndex} />
    </section>
  );
}
