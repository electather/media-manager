import { useState } from "react";
import { invariant } from "es-toolkit/util";
import { useHomeFeed } from "../hooks/use-home-feed";
import { Row } from "./row/index";

export function HomeFeed() {
  const data = useHomeFeed();
  invariant(data.hero !== null, "home feed requires a hero item");

  const [_watchlist, setWatchlist] = useState<Set<string>>(new Set());

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
          onWatchlistToggle={handleWatchlistToggle}
          onRequest={handleRequest}
        />
      ))}
    </div>
  );
}
