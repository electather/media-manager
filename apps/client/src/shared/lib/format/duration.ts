import { m } from "@/paraglide/messages";

const SEC_PER_MIN = 60;
const MIN_PER_HOUR = 60;

export function formatMinutesLeft(secondsLeft: number): string {
  const totalMinutes = Math.max(0, Math.round(secondsLeft / SEC_PER_MIN));
  if (totalMinutes >= MIN_PER_HOUR) {
    const hours = Math.floor(totalMinutes / MIN_PER_HOUR);
    const minutes = totalMinutes % MIN_PER_HOUR;
    return m.media_card_hour_min_left({ hours, minutes });
  }
  return m.media_card_min_left_short({ minutes: totalMinutes });
}
