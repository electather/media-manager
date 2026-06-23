import type { MoodId } from "@nama/shared/watchlist";
import { MOOD_IDS } from "@nama/shared/watchlist";
import * as m from "@/paraglide/messages";

type MessageFn = () => string;

export interface MoodCopy {
  label: MessageFn;
  note: MessageFn;
}

/**
 * Localized mood label + note via `watchlist_mood_label`/`watchlist_mood_note`
 * ICU variants (selector `moodId`); one message per axis covers all moods.
 */
export const MOOD_REGISTRY: Record<MoodId, MoodCopy> = Object.fromEntries(
  MOOD_IDS.map((moodId): [MoodId, MoodCopy] => [
    moodId,
    {
      label: () => m.watchlist_mood_label({ moodId }),
      note: () => m.watchlist_mood_note({ moodId }),
    },
  ]),
) as Record<MoodId, MoodCopy>;
