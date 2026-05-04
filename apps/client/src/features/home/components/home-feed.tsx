import { useMemo, useState } from "react";
import { invariant } from "es-toolkit/util";
import { useHomeFeed } from "../hooks/use-home-feed";
import { Row } from "./row/index";

export function HomeFeed() {
  const data = useHomeFeed();
  invariant(data.hero !== null, "home feed requires a hero item");

  // Seed the watchlist set from the yourWatchlist row so cards already on the
  // list render the "Remove" affordance instead of "Add" on first paint.
  const initialWatchlist = useMemo(() => {
    const set = new Set<string>();
    const watchlistRow = data.rows.find((row) => row.kind === "yourWatchlist");
    if (watchlistRow) {
      for (const item of watchlistRow.items) {
        set.add(item.id);
      }
    }
    return set;
  }, [data.rows]);

  const [watchlist, setWatchlist] = useState<Set<string>>(initialWatchlist);

  function handleWatchlistToggle(id: string) {
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // Optimistic no-op placeholder until backend integration adds real request logic.
  function handleRequest(_id: string) {}

  return (
    <div>
      {data.rows.map((row) => (
        <Row
          key={row.id}
          row={row}
          watchlist={watchlist}
          onWatchlistToggle={handleWatchlistToggle}
          onRequest={handleRequest}
        />
      ))}
    </div>
  );
}
