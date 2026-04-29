import { consola } from "consola";
import { and, desc, eq, gt, gte, or } from "drizzle-orm";
import { getDb } from "../db/client";
import { feedback, preferenceProfiles } from "../db/schema";
import type { MediaService } from "../media/service";
import type { RequestScopedLoader } from "./dataloader";

/**
 * Cheap layout-time snapshot used to filter the candidate row set before any
 * plugin fetch fires. Each field corresponds to a single design-doc rule;
 * the snapshot itself is targeted to fit inside ~50ms even on a cold cache,
 * so the full snapshot is surfaced as a single Promise — partial failures
 * default the failing field rather than aborting the whole layout.
 */
export interface LayoutSignals {
  hasWatchHistoryPlugin: boolean;
  hasWatchlistPlugin: boolean;
  hasCalendarPlugin: boolean;
  hasRecommendationsPlugin: boolean;

  inProgressCount: number;
  watchlistCount: number;
  calendarProgressCount: number;

  profileConfidence: "low" | "medium" | "high" | "none";

  recentSeed: RecentSeed | null;
}

export interface RecentSeed {
  /** Composite media id `"movie:550"` / `"tv:1396"`. */
  id: string;
  tmdbId: string;
  mediaType: "movie" | "tv";
  title: string;
  reason: "high_rating" | "liked" | "recently_completed";
}

const RECENT_SEED_PRIMARY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_SEED_FALLBACK_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Builds the snapshot. Reads run in parallel; a per-field failure is logged
 * and replaced with the conservative default (boolean → false, count → 0,
 * confidence → "none", seed → null). The whole snapshot only throws when
 * the database itself is unreachable, which the caller surfaces as
 * `home.internal`.
 */
// fallow-ignore-next-line complexity
export async function captureSignals(args: {
  userId: string;
  mediaService: MediaService;
  loader: RequestScopedLoader;
}): Promise<LayoutSignals> {
  const { userId, mediaService, loader } = args;

  const [hasWatchHistoryPlugin, hasWatchlistPlugin, hasCalendarPlugin, hasRecommendationsPlugin] =
    await Promise.all([
      loader.hasPlugin("watchHistory@v1"),
      loader.hasPlugin("watchlist@v1"),
      loader.hasPlugin("calendar@v1"),
      loader.hasPlugin("recommendations@v1"),
    ]);

  const inProgressCountPromise: Promise<number> = hasWatchHistoryPlugin
    ? loader
        .getInProgressSet()
        .then((set) => set.size)
        .catch(zeroOnError)
    : Promise.resolve(0);

  const watchlistCountPromise: Promise<number> = hasWatchlistPlugin
    ? mediaService.getWatchlistCount().catch(zeroOnError)
    : Promise.resolve(0);

  const calendarProgressCountPromise: Promise<number> =
    hasCalendarPlugin && hasWatchHistoryPlugin
      ? mediaService.getCalendarProgressCount().catch(zeroOnError)
      : Promise.resolve(0);

  const profileConfidencePromise = readProfileConfidence(userId).catch((err) => {
    consola.warn("[home/signals] profile confidence read failed:", err);
    return "none" as const;
  });

  const recentSeedPromise = readRecentSeed(userId, mediaService).catch((err) => {
    consola.warn("[home/signals] recent seed read failed:", err);
    return null;
  });

  const [inProgressCount, watchlistCount, calendarProgressCount, profileConfidence, recentSeed] =
    await Promise.all([
      inProgressCountPromise,
      watchlistCountPromise,
      calendarProgressCountPromise,
      profileConfidencePromise,
      recentSeedPromise,
    ]);

  return {
    hasWatchHistoryPlugin,
    hasWatchlistPlugin,
    hasCalendarPlugin,
    hasRecommendationsPlugin,
    inProgressCount,
    watchlistCount,
    calendarProgressCount,
    profileConfidence,
    recentSeed,
  };
}

function zeroOnError(): number {
  return 0;
}

// fallow-ignore-next-line complexity
async function readProfileConfidence(userId: string): Promise<LayoutSignals["profileConfidence"]> {
  const rows = await getDb()
    .select({ confidence: preferenceProfiles.confidence })
    .from(preferenceProfiles)
    .where(and(eq(preferenceProfiles.userId, userId), eq(preferenceProfiles.mediaType, "combined")))
    .limit(1)
    .all();
  const value = rows[0]?.confidence;
  if (value === "low" || value === "medium" || value === "high") return value;
  return "none";
}

/**
 * Resolves the seed for `becauseYouWatched`. Two-tier window:
 *   - 30d: most recent `like` or high-rating (`rate` ≥ 8).
 *   - 60d: fall back to the most recently completed watch.
 *
 * The 30d window is intentional — explicit feedback decays fast and a
 * narrow window keeps the signal volitional. Completed watches are weaker
 * per-event so the fallback opens up to 60d to accumulate evidence.
 *
 * Returns null when neither tier produces a candidate; `becauseYouWatched`
 * then drops out of the candidate set.
 */
async function readRecentSeed(
  userId: string,
  mediaService: MediaService,
): Promise<RecentSeed | null> {
  const now = Date.now();
  const primaryRows = await getDb()
    .select()
    .from(feedback)
    .where(
      and(
        eq(feedback.userId, userId),
        gt(feedback.createdAt, now - RECENT_SEED_PRIMARY_WINDOW_MS),
        or(eq(feedback.action, "like"), and(eq(feedback.action, "rate"), gte(feedback.rating, 8))),
      ),
    )
    .orderBy(desc(feedback.createdAt))
    .limit(1)
    .all();
  if (primaryRows.length > 0) {
    const row = primaryRows[0]!;
    return {
      id: composeId(row.mediaType, row.tmdbId),
      tmdbId: row.tmdbId,
      mediaType: row.mediaType,
      title: await resolveTitle(mediaService, row.mediaType, row.tmdbId),
      reason: row.action === "like" ? "liked" : "high_rating",
    };
  }

  // Fallback: most-recently-completed watch within 60 days. We approximate
  // "completed" via the existing `feedback` table — a `rate` action without
  // a high score is logged when the user finishes an item; absence of any
  // completion logs returns null and the seed disappears for this snapshot.
  const fallbackRows = await getDb()
    .select()
    .from(feedback)
    .where(
      and(
        eq(feedback.userId, userId),
        gt(feedback.createdAt, now - RECENT_SEED_FALLBACK_WINDOW_MS),
        eq(feedback.action, "rate"),
      ),
    )
    .orderBy(desc(feedback.createdAt))
    .limit(1)
    .all();
  if (fallbackRows.length > 0) {
    const row = fallbackRows[0]!;
    return {
      id: composeId(row.mediaType, row.tmdbId),
      tmdbId: row.tmdbId,
      mediaType: row.mediaType,
      title: await resolveTitle(mediaService, row.mediaType, row.tmdbId),
      reason: "recently_completed",
    };
  }
  return null;
}

function composeId(type: "movie" | "tv", tmdbId: string): string {
  return `${type}:${tmdbId}`;
}

/**
 * Best-effort title resolver. Goes through `MediaService.getDetails` so the
 * underlying metadata cache is shared across the request and subsequent
 * `becauseYouWatched` fetches. Failures fall back to a `tmdb:<id>`
 * placeholder rather than throwing — the subtitle is cosmetic, and a missing
 * title is still a usable layout signal.
 */
// fallow-ignore-next-line complexity
async function resolveTitle(
  mediaService: MediaService,
  type: "movie" | "tv",
  tmdbId: string,
): Promise<string> {
  try {
    const details = (await mediaService.getDetails(`${type}:${tmdbId}`, type)) as {
      title?: string;
    } | null;
    if (details && typeof details.title === "string" && details.title.length > 0) {
      return details.title;
    }
  } catch (err) {
    consola.debug("[home/signals] title lookup failed:", err);
  }
  return `tmdb:${tmdbId}`;
}
