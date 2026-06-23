import { useState } from "react";

import { useInterval } from "./use-interval";

interface UseNowOptions {
  /**
   * When `false`, the hook returns a stable timestamp captured at mount and
   * skips scheduling the interval entirely. Lets a consumer with no live
   * countdown to render avoid per-tick re-renders. Defaults to `true`.
   */
  active?: boolean;
}

/**
 * Returns `Date.now()` snapshot updating every `intervalMs`.
 * Designed for shared-credentials cooldown: timer ticks only while ≥1 row rate-limited,
 * idle when nothing in cooldown.
 */
export function useNow(intervalMs: number, opts: UseNowOptions = {}): number {
  const active = opts.active ?? true;
  const [now, setNow] = useState(() => Date.now());

  useInterval(() => setNow(Date.now()), active ? intervalMs : null);

  return now;
}
