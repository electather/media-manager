const DAY_MS = 24 * 60 * 60 * 1000;

export function formatRelativeAirDate(airsAt: number, now: number = Date.now()): string {
  const diff = airsAt - now;
  if (diff < 0) return "Aired";
  const days = Math.floor(diff / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;
  const date = new Date(airsAt);
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}
