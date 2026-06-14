import { useMemo } from "react";
import { useMediaRows } from "@/shared/media/use-media-rows";
import { watchlistTonightSource } from "../lib/sources";
import { pickTonight } from "../lib/tonight-pick";

/**
 * Reader for tonight's watchable pool via the `watchlist-tonight` media source.
 * The resolver returns the FLAT enriched candidate page; the hero/alternate
 * ranking + split that used to run server-side now runs here (`pickTonight`),
 * so `items[0]` is the hero and the rest are the ≤4 alternates (design §B3).
 */
export function useTonight() {
  const { items, partial } = useMediaRows(watchlistTonightSource());
  const picked = useMemo(() => pickTonight(items), [items]);
  return { items: picked, partial };
}
