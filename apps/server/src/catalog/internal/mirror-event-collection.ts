import { identifyItem, parseHistoryBase, parseItemDate, type MediaService } from "../../media";
import type { HistoryEvent, RatingEvent } from "@nama/shared/catalog";
import { isNil } from "es-toolkit/predicate";

type PluginEntryItem = {
  item?: { ids?: { tmdb_id?: string }; id?: string; type?: "movie" | "tv" };
};

export async function collectHistoryEvents(
  media: MediaService,
  pluginId: string,
): Promise<HistoryEvent[]> {
  const raw = (await media.getAllHistory(pluginId)) as Array<
    PluginEntryItem & {
      watchedAt?: string;
      progress?: number | null;
      episodeKey?: string | null;
    }
  >;
  return raw.flatMap((entry) => toHistoryEvent(entry, pluginId));
}

export async function collectRatingEvents(
  media: MediaService,
  pluginId: string,
): Promise<RatingEvent[]> {
  const raw = (await media.getAllRatings(pluginId)) as Array<
    PluginEntryItem & {
      rating?: number;
      ratedAt?: string;
    }
  >;
  return raw.flatMap((entry) => toRatingEvent(entry, pluginId));
}

function toHistoryEvent(
  entry: PluginEntryItem & {
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
  entry: PluginEntryItem & {
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
