import { useEffect, useState } from "react";

/**
 * Returns `value` after `delay` ms have passed without further changes. Used
 * to keep search-result fetches off the critical path while typing — pairs
 * with `useDeferredValue` for paint-priority but still throttles the network.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [delay, value]);
  return debounced;
}
