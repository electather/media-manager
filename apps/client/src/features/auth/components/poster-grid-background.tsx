import * as React from "react";
import { fallbackPosterFor } from "../assets/fallback-posters";
import { useTrendingPosters } from "../hooks/use-trending-posters";
import type { TrendingPoster } from "../lib/types";
import { ROW_CONFIG, ROW_POSTER_COUNT, ROW_SPEED_SCALE } from "../lib/poster-data";
import styles from "./poster-grid-background.module.css";
import { cn } from "@/shared/lib/utils";

// One unique card per grid slot, before the seamless x2 duplication per row.
const TOTAL_CARDS = ROW_CONFIG.length * ROW_POSTER_COUNT;

interface PosterCard {
  // Stable React key: the live poster id when present, otherwise the slot index.
  key: string;
  src: string;
}

interface PosterProps {
  src: string;
  fallbackSrc: string;
}

const Poster = React.memo(function Poster({ src, fallbackSrc }: PosterProps) {
  // Per-card fallback swap: a broken live image becomes a bundled fallback for
  // this card only, never touching siblings.
  const [resolvedSrc, setResolvedSrc] = React.useState(src);

  // Keep the rendered image in sync when the live pool resolves after mount.
  React.useEffect(() => {
    setResolvedSrc(src);
  }, [src]);

  const handleError = React.useCallback(() => {
    setResolvedSrc((current) => (current === fallbackSrc ? current : fallbackSrc));
  }, [fallbackSrc]);

  return (
    <div
      className={cn(
        "relative isolate aspect-2/3 w-40 shrink-0 overflow-hidden rounded-md bg-muted max-sm:w-24 max-sm:rounded-sm",
        styles.poster,
      )}
    >
      <img
        src={resolvedSrc}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={handleError}
        className="size-full object-cover"
      />
    </div>
  );
});

interface PosterRowProps {
  cards: readonly PosterCard[];
  speed: number;
  direction: number;
  scale: number;
}

const PosterRow = React.memo(function PosterRow({
  cards,
  speed,
  direction,
  scale,
}: PosterRowProps) {
  const trackDirClass = direction > 0 ? styles.trackRight : styles.trackLeft;

  return (
    <div className="w-full origin-center overflow-visible" style={{ transform: `scale(${scale})` }}>
      <div
        className={cn("flex w-max gap-3 will-change-transform", styles.track, trackDirClass)}
        style={{ animationDuration: `${speed}s` }}
      >
        {[0, 1].map((copy) => (
          <div className="flex shrink-0 gap-3" key={copy}>
            {cards.map((card, i) => (
              <Poster
                key={`${copy}-${card.key}`}
                src={card.src}
                fallbackSrc={fallbackPosterFor(i)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

// Builds the full fixed-size card pool: live posters fill slots in order, any
// remaining slots (including the all-empty pending/error case) are cycled
// bundled fallback art so the grid is never short or blank.
function buildCardPool(posters: readonly TrendingPoster[]): PosterCard[] {
  const cards: PosterCard[] = [];
  for (let i = 0; i < TOTAL_CARDS; i++) {
    const live = posters[i];
    cards.push(
      live
        ? { key: live.id, src: live.poster }
        : { key: `fallback-${i}`, src: fallbackPosterFor(i) },
    );
  }
  return cards;
}

export const PosterGridBackground = React.memo(function PosterGridBackground() {
  // Non-suspense read: the grid never blocks the login form. While pending, on
  // error, or on an empty response `data` is undefined/empty and the pool is
  // filled entirely with fallback art.
  const { data } = useTrendingPosters(TOTAL_CARDS);

  const cardPool = React.useMemo(() => buildCardPool(data ?? []), [data]);

  const rows = React.useMemo(
    () =>
      ROW_CONFIG.map((cfg, i) => ({
        key: `row-${i}`,
        cards: cardPool.slice(i * ROW_POSTER_COUNT, (i + 1) * ROW_POSTER_COUNT),
        speed: cfg.baseSpeed * ROW_SPEED_SCALE,
        direction: cfg.direction,
        scale: cfg.scale,
      })),
    [cardPool],
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
        {rows.map(({ key, ...row }) => (
          <PosterRow key={key} {...row} />
        ))}
      </div>
    </div>
  );
});
