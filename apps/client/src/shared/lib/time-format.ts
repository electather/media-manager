import * as m from "@/paraglide/messages";

type TimeInput = Date | number | string | null | undefined;
type RelativeTimeUnit = "year" | "month" | "week" | "day" | "hour" | "minute" | "second";

type RelativeTimeOptions = {
  now?: Date | number;
};

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

function toEpochMs(input: Date | number | string): number {
  if (input instanceof Date) return input.getTime();
  return typeof input === "string" ? new Date(input).getTime() : input;
}

function resolveNowMs(now: Date | number | undefined): number {
  return now === undefined ? Date.now() : toEpochMs(now);
}

// fallow-ignore-next-line complexity
function toRelativeDuration(
  input: Date | number | string,
  options: RelativeTimeOptions = {},
): { duration: number; unit: RelativeTimeUnit } | null {
  const delta = toEpochMs(input) - resolveNowMs(options.now);
  const absDelta = Math.abs(delta);

  if (absDelta < 45 * SECOND_MS) return null;
  if (absDelta < MINUTE_MS) return { duration: Math.round(delta / SECOND_MS), unit: "second" };
  if (absDelta < HOUR_MS) return { duration: Math.round(delta / MINUTE_MS), unit: "minute" };
  if (absDelta < DAY_MS) return { duration: Math.round(delta / HOUR_MS), unit: "hour" };
  if (absDelta < WEEK_MS) return { duration: Math.round(delta / DAY_MS), unit: "day" };
  if (absDelta < MONTH_MS) return { duration: Math.round(delta / WEEK_MS), unit: "week" };
  if (absDelta < YEAR_MS) return { duration: Math.round(delta / MONTH_MS), unit: "month" };
  return { duration: Math.round(delta / YEAR_MS), unit: "year" };
}

export function relativeTime(input: TimeInput, options: RelativeTimeOptions = {}): string {
  if (input == null) return m.shared_time_never();
  const relative = toRelativeDuration(input, options);
  if (relative === null) return m.shared_time_just_now();
  return m.shared_time_relative_long(relative);
}

export function compactRelativeTime(input: TimeInput, options: RelativeTimeOptions = {}): string {
  if (input == null) return m.shared_time_missing();
  const inputMs = toEpochMs(input);
  const absDelta = Math.abs(inputMs - resolveNowMs(options.now));

  if (absDelta >= WEEK_MS) return shortDate(input);

  const relative = toRelativeDuration(input, options);
  if (relative === null) return m.shared_time_just_now();
  return m.shared_time_relative_narrow(relative);
}

export function shortDate(input: TimeInput): string {
  if (input == null) return m.shared_time_missing();
  return m.shared_time_short_date({ date: new Date(toEpochMs(input)) });
}

export function absoluteDateTime(input: TimeInput): string {
  if (input == null) return m.shared_time_missing();
  return m.shared_time_absolute({ date: new Date(toEpochMs(input)) });
}

// fallow-ignore-next-line complexity
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return m.shared_time_missing();
  if (ms < 1) return m.shared_time_duration({ unit: "sub_ms", value: 0, secondaryValue: 0 });
  if (ms < SECOND_MS) {
    return m.shared_time_duration({
      unit: "ms",
      value: Math.round(ms),
      secondaryValue: 0,
    });
  }
  if (ms < MINUTE_MS) {
    const value = ms < 10 * SECOND_MS ? Math.round(ms / 10) / 100 : Math.round(ms / 100) / 10;
    return m.shared_time_duration({ unit: "s", value, secondaryValue: 0 });
  }

  const seconds = Math.round(ms / SECOND_MS);
  return m.shared_time_duration({
    unit: "min_s",
    value: Math.floor(seconds / 60),
    secondaryValue: seconds % 60,
  });
}
