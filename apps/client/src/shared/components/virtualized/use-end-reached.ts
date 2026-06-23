import { useEffect, useRef } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";

// Call `onReached` when the last virtual row is final (scroll nears end).
// Re-fires on `rowCount` growth while at end, so appended pages chain loads.
// Callback in ref (primitives only, no identity re-runs); callback owns hasNextPage guard.
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
