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

interface PosterProps {
  data: PosterTitle;
  idx: number;
}

const Poster = React.memo(function Poster({ data, idx }: PosterProps) {
  const style = derivePosterStyle(data.title, idx);
  const pos = style.position;

  return (
    <div className={styles.poster} style={{ ["--poster-surface" as string]: style.posterSurface }}>
      <div className={styles.posterFloor} />
      <div
        className={styles.posterTitle}
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
          <span key={i} className={styles.posterTitleWord}>
            {w}
          </span>
        ))}
      </div>
      <div className={styles.posterBrand}>L</div>
      <div className={styles.posterTag}>{data.tag}</div>
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

  const trackClass = `${styles.track} ${direction > 0 ? styles.trackRight : styles.trackLeft}`;

  return (
    <div className={styles.row} style={{ ["--row-scale" as string]: scale }}>
      <div className={trackClass} style={{ animationDuration: `${speed}s` }}>
        {[0, 1].map((copy) => (
          <div className={styles.trackCopy} key={copy}>
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
    <div className={styles.stage}>
      <div className={styles.grid}>
        {rows.map((r) => (
          <PosterRow key={r.seed} {...r} />
        ))}
      </div>
    </div>
  );
});
