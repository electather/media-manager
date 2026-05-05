import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { invariant } from "es-toolkit/util";
import { MediaDetailModal } from "@/shared/components/media-detail-modal";
import { useHomeFeed } from "../hooks/use-home-feed";
import type { HomeMediaItem } from "../lib/types";
import { Row } from "./row/index";
import { TopZone } from "./top-zone";

// Local re-type. Importing the type from `@/lib/home-display` crosses the
// `client-feat-home → client-features-legacy` zone boundary.
type PeekSearch = { peek?: string };

// Mock-pagination clones append `#clone-N` to the original id so React keys
// stay unique. Strip the suffix when resolving the peek so cloned cards still
// open the detail modal for the original content.
function sourceIdOf(id: string): string {
  const hash = id.indexOf("#");
  return hash === -1 ? id : id.slice(0, hash);
}

export function HomeFeed() {
  const data = useHomeFeed();
  invariant(data.hero !== null, "home feed requires a hero item");
  const hero = data.hero;
  const { peek } = useSearch({ strict: false }) as PeekSearch;
  const navigate = useNavigate();

  const initialWatchlist = useMemo(() => {
    const set = new Set<string>();
    const watchlistRow = data.rows.find((row) => row.kind === "yourWatchlist");
    if (watchlistRow) for (const item of watchlistRow.items) set.add(item.id);
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

  const peekItem = peek ? (itemIndex.get(peek) ?? itemIndex.get(sourceIdOf(peek)) ?? null) : null;

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

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-10 px-4 pb-32 sm:px-6 lg:px-8">
      <TopZone hero={hero} onPeek={handlePeek} />
      <div className="flex flex-col gap-2">
        {data.rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            watchlist={watchlist}
            onWatchlistToggle={toggleWatchlistId}
            onCardClick={handlePeek}
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
