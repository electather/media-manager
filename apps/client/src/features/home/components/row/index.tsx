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
      <div data-testid="row-scroller-bleed">
        <RowScroller
          row={row}
          watchlist={watchlist}
          onWatchlistToggle={onWatchlistToggle}
          onCardClick={onCardClick}
        />
      </div>
    </section>
  );
}
