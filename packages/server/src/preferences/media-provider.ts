import { consola } from "consola";
import { dispatchAggregate, dispatchPrimary } from "../media/dispatcher";
import type { HistorySignal, PreferenceDataProvider, RatingSignal, RawMediaItem } from "./provider";
import { toCandidateFeatures } from "./provider";
import type { CandidateFeatures } from "./types";

interface HistoryItem {
  item?: {
    ids?: { tmdb_id?: string };
    id?: string;
    type?: "movie" | "tv";
  };
  watchedAt?: string;
  progress?: number | null;
}

interface RatingItem {
  item?: {
    ids?: { tmdb_id?: string };
    id?: string;
    type?: "movie" | "tv";
  };
  rating?: number;
  ratedAt?: string;
}

interface MetadataPayload extends RawMediaItem {
  ids?: { tmdb_id?: string };
}

/**
 * Adapter that bridges the preference engine to the live media dispatcher.
 * Every method is best-effort: an empty result is acceptable, a thrown error
 * is swallowed into an empty set so one bad plugin doesn't poison a rebuild.
 */
export class MediaServicePreferenceProvider implements PreferenceDataProvider {
  async getItemFeatures(
    userId: string,
    tmdbId: string,
    mediaType: "movie" | "tv",
  ): Promise<CandidateFeatures | null> {
    try {
      const result = await dispatchPrimary<MetadataPayload>({
        userId,
        capability: "metadata",
        version: "v1",
        method: "getDetails",
        input: { id: tmdbId, type: mediaType },
        mediaType,
      });
      if (!result.data) return null;
      return toCandidateFeatures({ ...result.data, type: mediaType, ids: { tmdb_id: tmdbId } });
    } catch (err) {
      consola.debug("[preference] getItemFeatures failed", err);
      return null;
    }
  }

  async getHistory(userId: string): Promise<HistorySignal[]> {
    try {
      const result = await dispatchAggregate<HistoryItem[]>({
        userId,
        capability: "watchHistory",
        version: "v1",
        method: "getHistory",
        input: {},
      });
      return (result.data ?? []).flatMap(toHistorySignal);
    } catch {
      return [];
    }
  }

  async getAllRatings(userId: string): Promise<RatingSignal[]> {
    try {
      const result = await dispatchAggregate<RatingItem[]>({
        userId,
        capability: "ratings",
        version: "v1",
        method: "getRatings",
        input: {},
      });
      return (result.data ?? []).flatMap(toRatingSignal);
    } catch {
      return [];
    }
  }
}

function toHistorySignal(entry: HistoryItem): HistorySignal[] {
  const identity = identify(entry.item);
  if (!identity) return [];
  const watchedAt = parseDate(entry.watchedAt);
  if (watchedAt === null) return [];
  return [
    {
      tmdbId: identity.tmdbId,
      mediaType: identity.type,
      watchedAt,
      progress: typeof entry.progress === "number" ? entry.progress : null,
    },
  ];
}

function toRatingSignal(entry: RatingItem): RatingSignal[] {
  const identity = identify(entry.item);
  if (!identity || typeof entry.rating !== "number") return [];
  const ratedAt = parseDate(entry.ratedAt) ?? Date.now();
  return [
    {
      tmdbId: identity.tmdbId,
      mediaType: identity.type,
      rating: entry.rating,
      ratedAt,
    },
  ];
}

function identify(
  item: HistoryItem["item"] | RatingItem["item"],
): { tmdbId: string; type: "movie" | "tv" } | null {
  if (!item) return null;
  const tmdbId = item.ids?.tmdb_id ?? splitCombined(item.id)?.id;
  const type = item.type ?? splitCombined(item.id)?.type;
  if (!tmdbId || !type) return null;
  return { tmdbId, type };
}

function splitCombined(id: string | undefined): { type: "movie" | "tv"; id: string } | null {
  if (!id) return null;
  const [type, value] = id.split(":");
  if ((type !== "movie" && type !== "tv") || !value) return null;
  return { type, id: value };
}

function parseDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : null;
}
