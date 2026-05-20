import * as React from "react";
import {
  derivePosterStyle,
  hash,
  POSTER_TITLES,
  ROW_CONFIG,
  ROW_POSTER_COUNT,
  ROW_SPEED_DIVISOR,
  type PosterTitle,
} from "../lib/poster-data";
import styles from "./poster-grid-background.module.css";
import { cn } from "@/shared/lib/utils";

interface PosterProps {
  data: PosterTitle;
  idx: number;
}

const Poster = React.memo(function Poster({ data, idx }: PosterProps) {
  const style = derivePosterStyle(data.title, idx);
  const pos = style.position;

  return (
    <div
      className={cn(
        "relative isolate aspect-2/3 w-40 shrink-0 overflow-hidden rounded-md bg-muted max-sm:w-24 max-sm:rounded-sm",
        styles.poster,
      )}
      style={{ background: style.posterSurface }}
    >
      <div className={cn("pointer-events-none absolute inset-0 z-1", styles.posterFloor)} />
      <div
        className={cn(
          "absolute z-2 text-sm leading-none font-bold text-white/95",
          styles.posterTitle,
        )}
        style={{
          insetBlockStart: pos.insetBlockStart,
          insetBlockEnd: pos.insetBlockEnd,
          insetInlineStart: pos.insetInlineStart,
          insetInlineEnd: pos.insetInlineEnd,
          textAlign: pos.textAlign,
          transform: pos.transform,
          fontFamily: style.fontFamily,
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
          fontStyle: style.fontStyle,
        }}
      >
        {style.displayTitle.split(" ").map((w, i) => (
          <span key={i} className="block">
            {w}
          </span>
        ))}
      </div>
      <div
        className={cn(
          "absolute top-2 inset-s-2 z-3 font-serif text-lg leading-none font-black text-primary italic max-sm:top-1.5 max-sm:inset-s-2 max-sm:text-sm",
          styles.posterBrand,
        )}
      >
        L
      </div>
      <div className="absolute top-2.5 inset-e-2 z-3 rounded-xs bg-black/45 px-1.5 py-1 font-mono text-xs tracking-widest text-white/80 backdrop-blur-xs max-sm:top-2 max-sm:inset-e-1.5 max-sm:px-1 max-sm:py-0.5">
        {data.tag}
      </div>
    </div>
  );
});

interface PosterRowProps {
  seed: string;
  speed: number;
  direction: number;
  scale: number;
  count: number;
}

const PosterRow = React.memo(function PosterRow({
  seed,
  speed,
  direction,
  scale,
  count,
}: PosterRowProps) {
  const items = React.useMemo(() => {
    const out: (PosterTitle & { _i: number })[] = [];
    const base = POSTER_TITLES.length;
    for (let i = 0; i < count; i++) {
      const item = POSTER_TITLES[hash(seed + i) % base];
      if (item) out.push({ ...item, _i: i });
    }
    return out;
  }, [seed, count]);

  const trackDirClass = direction > 0 ? styles.trackRight : styles.trackLeft;

  return (
    <div className="w-full origin-center overflow-visible" style={{ transform: `scale(${scale})` }}>
      <div
        className={cn("flex w-max gap-3 will-change-transform", styles.track, trackDirClass)}
        style={{ animationDuration: `${speed}s` }}
      >
        {[0, 1].map((copy) => (
          <div className="flex shrink-0 gap-3" key={copy}>
            {items.map((item, i) => (
              <Poster key={`${copy}-${i}`} data={item} idx={item._i + copy * 100} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

export const PosterGridBackground = React.memo(function PosterGridBackground() {
  const rows = React.useMemo(
    () =>
      ROW_CONFIG.map((cfg, i) => ({
        seed: `row-${i}-v3`,
        speed: cfg.baseSpeed / ROW_SPEED_DIVISOR,
        direction: cfg.direction,
        scale: cfg.scale,
        count: ROW_POSTER_COUNT,
      })),
    [],
  );

  return (
    <div
      className={cn(
        "fixed inset-0 overflow-hidden perspective-distant perspective-origin-center",
        styles.stage,
      )}
    >
      <div
        className={cn(
          "absolute flex flex-col justify-center gap-5 py-12 transform-3d max-md:gap-3",
          styles.grid,
        )}
      >
        {rows.map((r) => (
          <PosterRow key={r.seed} {...r} />
        ))}
      </div>
    </div>
  );
});
