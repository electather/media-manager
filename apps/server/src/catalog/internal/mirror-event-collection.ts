import { identifyItem, parseHistoryBase, parseItemDate, type MediaService } from "../../media";
import type { HistoryEvent, RatingEvent } from "@ent-mcp/shared/catalog";
import { isNil } from "es-toolkit/predicate";

export async function collectHistoryEvents(
  media: MediaService,
  pluginId: string,
): Promise<HistoryEvent[]> {
  const raw = (await media.getAllHistory(pluginId)) as Array<{
    item?: { ids?: { tmdb_id?: string }; id?: string; type?: "movie" | "tv" };
    watchedAt?: string;
    progress?: number | null;
    episodeKey?: string | null;
  }>;
  return raw.flatMap((entry) => toHistoryEvent(entry, pluginId));
}

export async function collectRatingEvents(
  media: MediaService,
  pluginId: string,
): Promise<RatingEvent[]> {
  const raw = (await media.getAllRatings(pluginId)) as Array<{
    item?: { ids?: { tmdb_id?: string }; id?: string; type?: "movie" | "tv" };
    rating?: number;
    ratedAt?: string;
  }>;
  return raw.flatMap((entry) => toRatingEvent(entry, pluginId));
}

function toHistoryEvent(
  entry: {
    item?: { ids?: { tmdb_id?: string }; id?: string; type?: "movie" | "tv" };
    watchedAt?: string;
    progress?: number | null;
    episodeKey?: string | null;
  },
  pluginId: string,
): HistoryEvent[] {
  const base = parseHistoryBase(entry);
  if (!base) return [];
  return [
    {
      ...base,
      sourceConnectionId: pluginId,
      episodeKey: entry.episodeKey ?? null,
      progress: typeof entry.progress === "number" ? entry.progress : null,
    },
  ];
}

function toRatingEvent(
  entry: {
    item?: { ids?: { tmdb_id?: string }; id?: string; type?: "movie" | "tv" };
    rating?: number;
    ratedAt?: string;
  },
  pluginId: string,
): RatingEvent[] {
  const identity = identifyItem(entry.item);
  if (!identity || typeof entry.rating !== "number") return [];
  // The dedupe key includes `ratedAt`; falling back to `Date.now()` would
  // mint a fresh key every sync run and let the same plugin entry land
  // repeatedly. Drop malformed events instead, mirroring the history path.
  const ratedAt = parseItemDate(entry.ratedAt);
  if (isNil(ratedAt)) return [];
  return [
    {
      tmdbId: identity.tmdbId,
      mediaType: identity.type,
      rating: entry.rating,
      ratedAt,
      sourceConnectionId: pluginId,
    },
  ];
}
