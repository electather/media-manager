import { consola } from "consola";
import { dispatchAggregate, dispatchPrimary } from "../media/dispatcher";
import { identifyItem, parseHistoryBase, parseItemDate } from "../media/parse-item";
import type {
  CommentSignal,
  HistorySignal,
  PreferenceDataProvider,
  RatingSignal,
  RawMediaItem,
  WatchlistSignal,
} from "./provider";
import { rawItemToCandidateFeatures } from "./provider";
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

interface WatchlistItem {
  item?: {
    ids?: { tmdb_id?: string };
    id?: string;
    type?: "movie" | "tv";
  };
  addedAt?: string;
}

interface CommentItem {
  item?: {
    ids?: { tmdb_id?: string };
    id?: string;
    type?: "movie" | "tv";
  };
  text?: string;
  createdAt?: string;
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
      return rawItemToCandidateFeatures({
        ...result.data,
        type: mediaType,
        ids: { tmdb_id: tmdbId },
      });
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

  async getWatchlist(userId: string): Promise<WatchlistSignal[]> {
    try {
      const result = await dispatchAggregate<WatchlistItem[]>({
        userId,
        capability: "watchlist",
        version: "v1",
        method: "getWatchlist",
        input: {},
      });
      return (result.data ?? []).flatMap(toWatchlistSignal);
    } catch {
      return [];
    }
  }

  async getComments(userId: string): Promise<CommentSignal[]> {
    try {
      const result = await dispatchAggregate<CommentItem[]>({
        userId,
        capability: "userComments",
        version: "v1",
        method: "getComments",
        input: {},
      });
      return (result.data ?? []).flatMap(toCommentSignal);
    } catch (err) {
      consola.debug("[preference] getComments failed", err);
      return [];
    }
  }
}

function toHistorySignal(entry: HistoryItem): HistorySignal[] {
  const base = parseHistoryBase(entry);
  if (!base) return [];
  return [
    {
      ...base,
      progress: typeof entry.progress === "number" ? entry.progress : null,
    },
  ];
}

function toRatingSignal(entry: RatingItem): RatingSignal[] {
  const identity = identifyItem(entry.item);
  if (!identity || typeof entry.rating !== "number") return [];
  const ratedAt = parseItemDate(entry.ratedAt) ?? Date.now();
  return [
    {
      tmdbId: identity.tmdbId,
      mediaType: identity.type,
      rating: entry.rating,
      ratedAt,
    },
  ];
}

function toWatchlistSignal(entry: WatchlistItem): WatchlistSignal[] {
  const identity = identifyItem(entry.item);
  if (!identity) return [];
  const addedAt = parseItemDate(entry.addedAt) ?? Date.now();
  return [{ tmdbId: identity.tmdbId, mediaType: identity.type, addedAt }];
}

function toCommentSignal(entry: CommentItem): CommentSignal[] {
  const identity = identifyItem(entry.item);
  if (!identity || !entry.text) return [];
  const createdAt = parseItemDate(entry.createdAt) ?? Date.now();
  return [{ tmdbId: identity.tmdbId, mediaType: identity.type, text: entry.text, createdAt }];
}
