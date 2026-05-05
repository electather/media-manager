import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { invariant } from "es-toolkit/util";
import { MediaDetailModal } from "@/shared/components/media-detail-modal";
import { useHomeFeed } from "../hooks/use-home-feed";
import type { HomeMediaItem } from "../lib/types";
import { Row } from "./row/index";
import { TopZone } from "./top-zone";

// Local re-type. Importing the type from `@/lib/home-display` crosses the
// `client-feat-home → client-features-legacy` zone boundary that the design
// doc explicitly warns against, so the route owns the schema and feature code
// just structurally types what it reads off `useSearch`.
type PeekSearch = { peek?: string };

export function HomeFeed() {
  const data = useHomeFeed();
  invariant(data.hero !== null, "home feed requires a hero item");
  const hero = data.hero;
  const { peek } = useSearch({ strict: false }) as PeekSearch;
  const navigate = useNavigate();

  // Seed the watchlist from the yourWatchlist row so cards already on the
  // list render the "Remove" affordance instead of "Add" on first paint.
  const initialWatchlist = useMemo(() => {
    const set = new Set<string>();
    const watchlistRow = data.rows.find((row) => row.kind === "yourWatchlist");
    if (watchlistRow) {
      for (const item of watchlistRow.items) set.add(item.id);
    }
    return set;
  }, [data.rows]);

  const [watchlist, setWatchlist] = useState<Set<string>>(initialWatchlist);

  const itemIndex = useMemo(() => {
    const map = new Map<string, HomeMediaItem>();
    map.set(hero.id, hero);
    for (const alt of hero.alternates) map.set(alt.id, alt);
    for (const row of data.rows) for (const item of row.items) map.set(item.id, item);
    return map;
  }, [hero, data.rows]);

  const peekItem = peek ? (itemIndex.get(peek) ?? null) : null;

  const handlePeek = useCallback(
    (id: string) => {
      void navigate({ to: ".", search: { peek: id }, replace: false });
    },
    [navigate],
  );

  const handleClose = useCallback(() => {
    void navigate({ to: ".", search: {}, replace: false });
  }, [navigate]);

  const toggleWatchlistId = useCallback((id: string) => {
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const inWatchlist = peekItem ? watchlist.has(peekItem.id) : false;
  const handleToggleWatchlistFromModal = useCallback(() => {
    if (!peekItem) return;
    toggleWatchlistId(peekItem.id);
  }, [peekItem, toggleWatchlistId]);

  // Optimistic no-op placeholder until backend integration adds real request logic.
  const handleRequest = useCallback((_id: string) => {}, []);

  return (
    <div className="flex flex-col gap-8 px-4 pb-12 sm:px-6">
      <TopZone hero={hero} onPeek={handlePeek} />
      <div>
        {data.rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            watchlist={watchlist}
            onWatchlistToggle={toggleWatchlistId}
            onRequest={handleRequest}
          />
        ))}
      </div>
      <MediaDetailModal
        item={peekItem}
        open={Boolean(peekItem)}
        onClose={handleClose}
        inWatchlist={inWatchlist}
        onToggleWatchlist={handleToggleWatchlistFromModal}
      />
    </div>
  );
}
