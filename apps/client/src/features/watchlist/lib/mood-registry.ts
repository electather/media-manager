import type { MoodId } from "@ent-mcp/shared/watchlist";
import { MOOD_IDS } from "@ent-mcp/shared/watchlist";
import * as m from "@/paraglide/messages";

type MessageFn = () => string;

export interface MoodCopy {
  label: MessageFn;
  note: MessageFn;
}

/**
 * Localized label + helper-note message functions for each `MoodId`. Kept
 * inside the feature because no cross-feature surface presents moods. Copy is
 * resolved through the keyed `watchlist_mood_label` / `watchlist_mood_note`
 * ICU variants (selector `moodId`), so one message per axis covers every mood.
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
