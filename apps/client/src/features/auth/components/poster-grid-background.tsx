import * as React from "react";
import { useTrendingPosters } from "../hooks/use-trending-posters";
import type { TrendingPoster } from "../lib/types";
import { ROW_CONFIG, ROW_POSTER_COUNT, ROW_SPEED_SCALE } from "../lib/poster-data";
import styles from "./poster-grid-background.module.css";
import { PosterPlaceholder } from "@/shared/components/poster-placeholder";
import { cn } from "@/shared/lib/utils";

// One unique card per grid slot, before the seamless x2 duplication per row.
const TOTAL_CARDS = ROW_CONFIG.length * ROW_POSTER_COUNT;

interface PosterCard {
  // Stable React key: the live poster id when present, otherwise the slot index.
  key: string;
  // Live poster URL; absent slots fall through to the embossed placeholder.
  src?: string;
  // Tints the placeholder so empty/broken slots vary across the grid.
  seed: number;
}

interface PosterProps {
  src: string | undefined;
  seed: number;
}

const Poster = React.memo(function Poster({ src, seed }: PosterProps) {
  // The embossed placeholder is always the base layer. A live image overlays
  // it; on load error the image is dropped so this single card falls back to
  // the placeholder without touching its siblings.
  const [failed, setFailed] = React.useState(false);

  // Reset the failure state when the live pool resolves a new src after mount.
  React.useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImage = src !== undefined && !failed;

  return (
    <div
      className={cn(
        "relative isolate aspect-2/3 w-40 shrink-0 overflow-hidden rounded-md max-sm:w-24 max-sm:rounded-sm",
        styles.poster,
      )}
    >
      <PosterPlaceholder seed={seed} className="absolute inset-0" />
      {showImage ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
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
            {cards.map((card) => (
              <Poster key={`${copy}-${card.key}`} src={card.src} seed={card.seed} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

// Builds the full fixed-size card pool: live posters fill slots in order, any
// remaining slots (including the all-empty pending/error case) fall through to
// the embossed placeholder so the grid is never short or blank.
function buildCardPool(posters: readonly TrendingPoster[]): PosterCard[] {
  const cards: PosterCard[] = [];
  for (let i = 0; i < TOTAL_CARDS; i++) {
    const live = posters[i];
    cards.push(live ? { key: live.id, src: live.poster, seed: i } : { key: `empty-${i}`, seed: i });
  }
  return cards;
}

export const PosterGridBackground = React.memo(function PosterGridBackground() {
  // Non-suspense read: the grid never blocks the login form. While pending, on
  // error, or on an empty response `data` is undefined/empty and every slot
  // falls through to the embossed placeholder.
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
