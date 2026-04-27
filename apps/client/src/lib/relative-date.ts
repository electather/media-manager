const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const FULL_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "short",
});

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function formatRelativeAirDate(airsAt: number, now: number = Date.now()): string {
  const target = new Date(airsAt);
  const today = startOfDay(new Date(now));
  const targetDay = startOfDay(target);
  const days = Math.round((targetDay.getTime() - today.getTime()) / DAY_MS);

  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days >= 2 && days <= 6) return `Next ${WEEKDAY_FORMATTER.format(target)}`;
  if (days >= 7 && days <= 13) return `In ${days} days`;
  return FULL_FORMATTER.format(target);
}
