/**
 * Coarse "X minutes ago" formatter shared between settings views and the
 * jobs admin page. Accepts a Date, a millis timestamp, or null.
 */
export function relativeTime(input: Date | number | null | undefined): string {
  if (input == null) return "never";
  const ts = input instanceof Date ? input.getTime() : input;
  if (!Number.isFinite(ts)) return "just now";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
