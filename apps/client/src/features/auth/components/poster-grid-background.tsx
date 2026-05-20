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
        `relative isolate aspect-2/3 w-[clamp(88px,11vw,200px)] shrink-0 overflow-hidden rounded-[6px] bg-(--poster-surface,var(--muted)) max-[600px]:w-[clamp(72px,22vw,120px)] max-[600px]:rounded-[5px]`,
        styles.poster,
      )}
      style={{ ["--poster-surface" as string]: style.posterSurface }}
    >
      <div className={cn(`pointer-events-none absolute inset-0 z-1`, styles.posterFloor)} />
      <div
        className={cn(
          `absolute z-2 text-[clamp(12px,1.1vw,18px)] leading-none font-bold text-[oklch(1_0_0/0.95)]`,
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
          `absolute top-2 start-2 z-3 font-serif text-[18px] leading-none font-black text-primary italic max-[600px]:top-[6px] max-[600px]:start-[7px] max-[600px]:text-[14px]`,
          styles.posterBrand,
        )}
      >
        L
      </div>
      <div
        className={cn(
          "absolute top-2 inset-e-2 z-3 rounded-[2px] bg-[oklch(0_0_0/0.45)] px-1.5 py-1 font-mono text-[8.5px] tracking-[0.1em] text-[oklch(1_0_0/0.78)] backdrop-blur-[4px] max-[600px]:top-[7px] max-[600px]:end-[6px] max-[600px]:px-[4px] max-[600px]:py-[2px] max-[600px]:text-[7px]",
        )}
      >
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
    <div
      className="w-full origin-center overflow-visible scale-[var(--row-scale,1)]"
      style={{ ["--row-scale" as string]: scale }}
    >
      <div
        className={`flex w-max gap-[clamp(10px,1vw,18px)] will-change-transform ${styles.track} ${trackDirClass}`}
        style={{ animationDuration: `${speed}s` }}
      >
        {[0, 1].map((copy) => (
          <div className="flex shrink-0 gap-[clamp(10px,1vw,18px)]" key={copy}>
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
      className={`fixed inset-0 overflow-hidden perspective-[1600px] perspective-origin-center ${styles.stage}`}
    >
      <div
        className={`absolute -top-1/4 -start-1/4 flex h-[150%] w-[150%] flex-col justify-center gap-[clamp(14px,1.6vw,26px)] py-[4vw] transform-3d max-[720px]:-top-[40%] max-[720px]:-start-[40%] max-[720px]:h-[180%] max-[720px]:w-[180%] max-[720px]:gap-[clamp(8px,1.4vw,16px)] ${styles.grid}`}
      >
        {rows.map((r) => (
          <PosterRow key={r.seed} {...r} />
        ))}
      </div>
    </div>
  );
});
