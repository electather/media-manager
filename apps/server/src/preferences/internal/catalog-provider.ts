import { consola } from "consola";
import {
  toCanonicalRow,
  toCandidateFeatures,
  type CatalogService,
  type RawCanonicalSource,
} from "../../catalog";
import type {
  CandidateFeatures,
  CommentSignal,
  HistorySignal,
  PreferenceDataProvider,
  RatingSignal,
  WatchlistSignal,
} from "../types";

/**
 * Preference data provider backed by the catalog. Reads serve from
 * `canonical_metadata`; misses fall through to a wrapped fallback (typically
 * `MediaServicePreferenceProvider`) and, on success, schedule a detached
 * write-back so the next read is warm. History/ratings/watchlist/comments
 * stay on the fallback until Phase 5 wires the mirrors in.
 */
export interface FeatureCacheMetrics {
  /** Hits served straight from `canonical_metadata.features`. */
  hits: number;
  /** Falls through to the wrapped fallback (typically a plugin dispatch). */
  misses: number;
  /** Misses that resolved to `null` from the fallback (item not findable). */
  unresolved: number;
}

export class CatalogPreferenceProvider implements PreferenceDataProvider {
  private hits = 0;
  private misses = 0;
  private unresolved = 0;

  constructor(
    private readonly catalog: CatalogService,
    private readonly fallback: PreferenceDataProvider,
  ) {}

  async getItemFeatures(
    userId: string,
    tmdbId: string,
    mediaType: "movie" | "tv",
  ): Promise<CandidateFeatures | null> {
    const cached = await this.catalog.getMetadata(tmdbId, mediaType);
    if (cached?.features) {
      this.hits += 1;
      return toCandidateFeatures(cached);
    }

    this.misses += 1;
    const features = await this.fallback.getItemFeatures(userId, tmdbId, mediaType);
    if (!features) {
      this.unresolved += 1;
      return null;
    }

    // Detached cold-fill write-back. Reads ⊥ block on the persist; write
    // failures are logged and dropped so a transient DB hiccup never poisons
    // a rebuild. `void … .catch` avoids the floating-promise lint.
    void this.coldFill({ tmdbId, type: mediaType }, features).catch((err) => {
      consola.warn("[catalog:provider] cold-fill write-back failed", err);
    });
    return features;
  }

  async getHistory(userId: string): Promise<HistorySignal[]> {
    const events = await this.catalog.getUserHistory(userId);
    if (events.length === 0) return this.fallback.getHistory(userId);
    return events.map((event) => ({
      tmdbId: event.tmdbId,
      mediaType: event.mediaType,
      watchedAt: event.watchedAt,
      progress: event.progress ?? null,
    }));
  }

  async getAllRatings(userId: string): Promise<RatingSignal[]> {
    const events = await this.catalog.getUserRatings(userId);
    if (events.length === 0) return this.fallback.getAllRatings(userId);
    return events.map((event) => ({
      tmdbId: event.tmdbId,
      mediaType: event.mediaType,
      rating: event.rating,
      ratedAt: event.ratedAt,
    }));
  }

  // V40: watchlist is volatile and intentionally not mirrored. Always
  // dispatch live so feedback rebuilds see the current set.
  getWatchlist(userId: string): Promise<WatchlistSignal[]> {
    return this.fallback.getWatchlist(userId);
  }

  // Comments mirror is out of scope for v1; keep delegating to the
  // fallback so the surface stays unchanged.
  getComments(userId: string): Promise<CommentSignal[]> {
    return this.fallback.getComments(userId);
  }

  /**
   * Reads and clears the feature cache counters. Callers (notably the manual
   * rebuild job) snapshot per partition so end-of-run logs can show the
   * canonical hit ratio for each partition independently.
   */
  consumeFeatureCacheMetrics(): FeatureCacheMetrics {
    const snapshot: FeatureCacheMetrics = {
      hits: this.hits,
      misses: this.misses,
      unresolved: this.unresolved,
    };
    this.hits = 0;
    this.misses = 0;
    this.unresolved = 0;
    return snapshot;
  }

  // fallow-ignore-next-line complexity
  private async coldFill(
    key: { tmdbId: string; type: "movie" | "tv" },
    features: CandidateFeatures,
  ): Promise<void> {
    // Cold-fill projects the PE-side `CandidateFeatures` back onto the
    // catalog row shape via the canonical serializer. We use the same
    // mapper as the metadata-refresh job so persisted rows have a single
    // shape regardless of whether they were warmed by a job or by a miss.
    const raw: RawCanonicalSource = {
      title: features.title,
      type: features.type,
      year: features.year ?? null,
      runtime: features.runtime ?? null,
      genres: features.genres ?? [],
      keywords: features.keywords ?? [],
      cast: features.cast ?? [],
      director: features.director ?? null,
      writers: features.writers ?? [],
      creators: features.creators ?? [],
      originalLanguage: features.originalLanguage ?? null,
      ids: { tmdb_id: key.tmdbId },
    };
    await this.catalog.writeMetadata([toCanonicalRow(key, raw)]);
  }
}
