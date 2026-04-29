import { formatDistanceToNowStrict } from "date-fns";

/**
 * Coarse relative-time formatter shared between settings views and the
 * jobs admin page. Accepts a Date, a millis timestamp, or null.
 */
// fallow-ignore-next-line complexity
export function relativeTime(input: Date | number | null | undefined): string {
  if (input == null) return "never";
  const date = input instanceof Date ? input : new Date(input);
  return formatDistanceToNowStrict(date, { addSuffix: true });
}
