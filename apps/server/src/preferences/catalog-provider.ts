import { consola } from "consola";
import type { CatalogService } from "../catalog";
import { toCanonicalRow, type RawCanonicalSource } from "../catalog/canonical";
import { toCandidateFeatures } from "../catalog/features";
import type {
  CommentSignal,
  HistorySignal,
  PreferenceDataProvider,
  RatingSignal,
  WatchlistSignal,
} from "./provider";
import type { CandidateFeatures } from "./types";

/**
 * Preference data provider backed by the catalog. Reads serve from
 * `canonical_metadata`; misses fall through to a wrapped fallback (typically
 * `MediaServicePreferenceProvider`) and, on success, schedule a detached
 * write-back so the next read is warm. History/ratings/watchlist/comments
 * stay on the fallback until Phase 5 wires the mirrors in.
 */
export class CatalogPreferenceProvider implements PreferenceDataProvider {
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
    if (cached?.features) return toCandidateFeatures(cached);

    const features = await this.fallback.getItemFeatures(userId, tmdbId, mediaType);
    if (!features) return null;

    // Detached cold-fill write-back. Reads ⊥ block on the persist; write
    // failures are logged and dropped so a transient DB hiccup never poisons
    // a rebuild. `void … .catch` avoids the floating-promise lint.
    void this.coldFill({ tmdbId, type: mediaType }, features).catch((err) => {
      consola.warn("[catalog:provider] cold-fill write-back failed", err);
    });
    return features;
  }

  getHistory(userId: string): Promise<HistorySignal[]> {
    return this.fallback.getHistory(userId);
  }

  getAllRatings(userId: string): Promise<RatingSignal[]> {
    return this.fallback.getAllRatings(userId);
  }

  getWatchlist(userId: string): Promise<WatchlistSignal[]> {
    return this.fallback.getWatchlist(userId);
  }

  getComments(userId: string): Promise<CommentSignal[]> {
    return this.fallback.getComments(userId);
  }

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
