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
 * Returns a `Date.now()` snapshot that updates every `intervalMs`.
 *
 * Designed for the shared-credentials cooldown countdown: the
 * `<SharedCredentialsSection>` calls `useNow(1000, { active })` on every
 * render where `active` is `rows.some(r => r.retryAfter && r.retryAfter > now)`
 * — so the timer only ticks while at least one row is rate-limited and
 * stays idle on the admin page when nothing is in cooldown.
 */
export function useNow(intervalMs: number, opts: UseNowOptions = {}): number {
  const active = opts.active ?? true;
  const [now, setNow] = useState(() => Date.now());

  useInterval(() => setNow(Date.now()), active ? intervalMs : null);

  return now;
}
