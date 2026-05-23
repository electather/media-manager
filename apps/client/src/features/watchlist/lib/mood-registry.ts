import type { MoodId } from "@ent-mcp/shared/watchlist";
import * as m from "@/paraglide/messages";

type MessageFn = () => string;

export interface MoodCopy {
  label: MessageFn;
  note: MessageFn;
}

/**
 * Localized label + helper-note message functions for each `MoodId`. Kept
 * inside the feature because no cross-feature surface presents moods.
 */
export const MOOD_REGISTRY: Record<MoodId, MoodCopy> = {
  cozy: { label: m.watchlist_mood_cozy, note: m.watchlist_mood_cozy_note },
  epic: { label: m.watchlist_mood_epic, note: m.watchlist_mood_epic_note },
  cerebral: { label: m.watchlist_mood_cerebral, note: m.watchlist_mood_cerebral_note },
  dark: { label: m.watchlist_mood_dark, note: m.watchlist_mood_dark_note },
  laugh: { label: m.watchlist_mood_laugh, note: m.watchlist_mood_laugh_note },
  throwback: { label: m.watchlist_mood_throwback, note: m.watchlist_mood_throwback_note },
  quick: { label: m.watchlist_mood_quick, note: m.watchlist_mood_quick_note },
  binge: { label: m.watchlist_mood_binge, note: m.watchlist_mood_binge_note },
};
