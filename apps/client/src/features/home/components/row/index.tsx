import type { RowData } from "../../lib/types";
import { RowHeader } from "./row-header";
import { RowScroller } from "./row-scroller";

interface RowProps {
  row: RowData;
  onWatchlistToggle?: (id: string) => void;
  onRequest?: (id: string) => void;
}

/** Renders a full labelled row combining the header and the horizontal card scroller. */
export function Row({ row, onWatchlistToggle, onRequest }: RowProps) {
  return (
    <section className="mb-8">
      <RowHeader row={row} />
      <RowScroller row={row} onWatchlistToggle={onWatchlistToggle} onRequest={onRequest} />
    </section>
  );
}
