import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { invariant } from "es-toolkit/util";
import { MediaDetailModal } from "@/shared/components/media-detail-modal";
import { useHomeFeed } from "../hooks/use-home-feed";
import type { HomeMediaItem } from "../lib/types";
import { TopZone } from "./top-zone";

type PeekSearch = { peek?: string };

export function HomeFeed() {
  const data = useHomeFeed();
  invariant(data.hero !== null, "home feed requires a hero item");
  const hero = data.hero;
  const { peek } = useSearch({ strict: false }) as PeekSearch;
  const navigate = useNavigate();
  const [watchlist, setWatchlist] = useState<Set<string>>(() => new Set());

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

  const inWatchlist = peekItem ? watchlist.has(peekItem.id) : false;
  const handleToggleWatchlist = useCallback(() => {
    if (!peekItem) return;
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(peekItem.id)) next.delete(peekItem.id);
      else next.add(peekItem.id);
      return next;
    });
  }, [peekItem]);

  return (
    <div className="flex flex-col gap-8 px-4 pb-12 sm:px-6">
      <TopZone hero={hero} onPeek={handlePeek} />
      <MediaDetailModal
        item={peekItem}
        open={Boolean(peekItem)}
        onClose={handleClose}
        inWatchlist={inWatchlist}
        onToggleWatchlist={handleToggleWatchlist}
      />
    </div>
  );
}
