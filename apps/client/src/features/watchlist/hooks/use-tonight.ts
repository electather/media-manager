import { useMemo } from "react";
import { useMediaRows } from "@/shared/media/use-media-rows";
import { watchlistTonightSource } from "../lib/sources";
import { pickTonight } from "../lib/tonight-pick";

/**
 * Tonight's watchable pool via `watchlist-tonight` source (design §B3).
 * Hero/alternate ranking now runs here via `pickTonight`: items[0] is hero.
 */
export function useTonight() {
  const { items, partial } = useMediaRows(watchlistTonightSource());
  const picked = useMemo(() => pickTonight(items), [items]);
  return { items: picked, partial };
}
