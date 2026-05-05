import type { RowData } from "../../lib/types";
import { RowHeader } from "./row-header";
import { RowScroller } from "./row-scroller";

interface RowProps {
  row: RowData;
  watchlist?: ReadonlySet<string>;
  onWatchlistToggle?: (id: string) => void;
  onCardClick?: (id: string) => void;
}

/** Renders a full labelled row combining the header and the horizontal card scroller. */
export function Row({ row, watchlist, onWatchlistToggle, onCardClick }: RowProps) {
  return (
    <section className="mb-8">
      <RowHeader row={row} />
      <div data-testid="row-scroller-bleed" className="relative left-1/2 w-screen -translate-x-1/2">
        <div className="ps-[max(1rem,calc((100vw-min(100vw,1600px))/2+1rem))] sm:ps-[max(1.5rem,calc((100vw-min(100vw,1600px))/2+1.5rem))] lg:ps-[max(2rem,calc((100vw-min(100vw,1600px))/2+2rem))]">
          <RowScroller
            row={row}
            watchlist={watchlist}
            onWatchlistToggle={onWatchlistToggle}
            onCardClick={onCardClick}
          />
        </div>
      </div>
    </section>
  );
}
