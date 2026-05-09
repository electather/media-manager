/** Renders a millisecond timestamp as a human relative string ("just now",
 *  "5m ago", "2d ago"). Falls back to a localized short date once it crosses
 *  the seven-day mark so older records still anchor visually. */
export function formatRel(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 45_000) return "just now";
  if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.round(diff / (60 * 60_000))}h ago`;
  if (diff < 7 * 24 * 60 * 60_000) return `${Math.round(diff / (24 * 60 * 60_000))}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Absolute timestamp string, used as a tooltip for the relative value. */
export function formatAbs(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Formats a duration in milliseconds with the smallest reasonable unit. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Maps a range key to the (since, until?) window expected by the API. */
export function rangeToWindow(range: "24h" | "7d" | "30d"): { since: number } {
  const now = Date.now();
  switch (range) {
    case "7d":
      return { since: now - 7 * 24 * 60 * 60_000 };
    case "30d":
      return { since: now - 30 * 24 * 60 * 60_000 };
    case "24h":
    default:
      return { since: now - 24 * 60 * 60_000 };
  }
}
