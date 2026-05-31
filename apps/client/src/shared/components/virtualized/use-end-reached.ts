import { useEffect, useRef } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";

/**
 * Calls `onReached` whenever the last rendered (overscanned) virtual row is the
 * final row — i.e. the scroll position nears the end of the list. It re-fires
 * each time `rowCount` grows while still at the end, so an appended page that
 * still ends inside the window chains another load. The callback lives in a ref
 * so the effect depends only on primitives and never re-runs on callback
 * identity (vercel `rerender-dependencies`). The callback owns its own
 * `hasNextPage` / in-flight guard — this hook only signals proximity.
 */
export function useEndReached(
  virtualRows: readonly VirtualItem[],
  rowCount: number,
  onReached?: () => void,
) {
  const last = virtualRows.at(-1);
  const atEnd = last !== undefined && last.index >= rowCount - 1;
  const onReachedRef = useRef(onReached);
  onReachedRef.current = onReached;
  useEffect(() => {
    if (atEnd) onReachedRef.current?.();
  }, [atEnd, rowCount]);
}
