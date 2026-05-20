import type { WatchlistItem, WatchlistMood, WatchlistMoodGroup } from "./types";

interface MoodRule {
  mood: WatchlistMood;
  /** All names must appear in `item.genres` for a movie to match. */
  requireMovie: string[];
  /** All names must appear in `item.genres` for a TV item to match. */
  requireTv: string[];
}

/**
 * English TMDB genre names. The catalog persists what plugins resolve, which
 * for TMDB defaults to English. RISK-001 covers the locale fragility — if the
 * catalog ever switches locales, every cluster falls back to empty silently.
 */
const MOOD_RULES: MoodRule[] = [
  {
    mood: {
      id: "horror",
      labelKey: "watchlist_mood_horror",
      noteKey: "watchlist_mood_horror_note",
    },
    requireMovie: ["Horror"],
    requireTv: [],
  },
  {
    mood: { id: "scifi", labelKey: "watchlist_mood_scifi", noteKey: "watchlist_mood_scifi_note" },
    requireMovie: ["Science Fiction"],
    requireTv: ["Sci-Fi & Fantasy"],
  },
  {
    mood: {
      id: "comedy",
      labelKey: "watchlist_mood_comedy",
      noteKey: "watchlist_mood_comedy_note",
    },
    requireMovie: ["Comedy"],
    requireTv: ["Comedy"],
  },
  {
    mood: {
      id: "period",
      labelKey: "watchlist_mood_period",
      noteKey: "watchlist_mood_period_note",
    },
    requireMovie: ["History"],
    requireTv: ["Drama"],
  },
  {
    mood: {
      id: "slow_burn",
      labelKey: "watchlist_mood_slow_burn",
      noteKey: "watchlist_mood_slow_burn_note",
    },
    requireMovie: ["Drama"],
    requireTv: ["Drama"],
  },
  {
    mood: {
      id: "quiet_thrill",
      labelKey: "watchlist_mood_quiet_thrill",
      noteKey: "watchlist_mood_quiet_thrill_note",
    },
    requireMovie: ["Thriller", "Mystery"],
    requireTv: ["Drama", "Mystery"],
  },
];

export const DEFAULT_MOOD_THRESHOLD = 3;

function matches(item: WatchlistItem, rule: MoodRule): boolean {
  const required = item.mediaType === "tv" ? rule.requireTv : rule.requireMovie;
  if (required.length === 0) return false;
  const genres = item.genres ?? [];
  if (genres.length === 0) return false;
  // Skip numeric-string genre ids (TMDB fallback shape). They would otherwise
  // never match an English-name rule and clutter the cluster silently.
  const set = new Set(genres.filter((g) => !/^\d+$/.test(g)));
  if (set.size === 0) return false;
  return required.every((name) => set.has(name));
}

/**
 * Derives mood clusters from a list of items. A cluster is surfaced only when
 * its bucket reaches `threshold` items. Items may appear in multiple clusters.
 */
export function deriveMoods(
  items: readonly WatchlistItem[],
  opts: { threshold?: number } = {},
): WatchlistMoodGroup[] {
  const threshold = opts.threshold ?? DEFAULT_MOOD_THRESHOLD;
  const groups: WatchlistMoodGroup[] = [];
  for (const rule of MOOD_RULES) {
    const matched = items.filter((item) => matches(item, rule));
    if (matched.length >= threshold) {
      groups.push({ mood: rule.mood, items: matched });
    }
  }
  return groups;
}
