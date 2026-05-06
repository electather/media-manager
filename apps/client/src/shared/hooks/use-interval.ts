import { useEffect, useRef } from "react";

/**
 * Calls `callback` every `delayMs` milliseconds while mounted.
 *
 * Pass `null` for `delayMs` to pause the interval without unmounting the
 * caller. The latest `callback` is always invoked even if it changes between
 * ticks — consumers do not need to memoise it.
 */
export function useInterval(callback: () => void, delayMs: number | null): void {
  const cbRef = useRef(callback);

  useEffect(() => {
    cbRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delayMs === null) return;
    const id = window.setInterval(() => cbRef.current(), delayMs);
    return () => window.clearInterval(id);
  }, [delayMs]);
}
