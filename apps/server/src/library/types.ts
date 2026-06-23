import type { ConsolaInstance } from "consola";
import type { MediaType } from "@nama/shared/media";
import type { WatchedState } from "@nama/shared/library";
import type { CatalogService } from "../catalog";
import type { MediaService } from "../media";

/** Raw row from lens sources; `enrichRows` reads denormalized columns instead of re-probing (design §Enrich).
 * Not the wire shape — maps to `CompactMediaItem`.
 */
export interface LibraryRow {
  id: string;
  tmdbId: string;
  mediaType: MediaType;
  sortTitle: string;
  year: number | null;
  genres: string[];
  servers: { id: string; label: string }[];
  qualityTiers: string[];
  watchedState: WatchedState | null;
  collectionId: string | null;
  collectionName: string | null;
}

/** LibraryRow + section from `json_each(servers)`/`json_each(quality_tiers)` expansion (design §The 5 lenses).
 * One title yields one row per section; `rank` carries SQL `CASE` ordinal for Quality lens cursor threading.
 */
export interface ExpandedLibraryRow extends LibraryRow {
  section: { id: string; label: string };
  rank?: number;
}

/** Per-request context for library sync; mirrors `WatchlistContext`. Carries `mediaService` for `collection@v1` feed
 * and `catalog` for metadata hydration. `asLibraryContext` resolves `log`/`logger` variants to canonical shape.
 */
export interface LibraryContext {
  userId: string;
  mediaService: MediaService;
  catalog: CatalogService;
  deadlineMs?: number;
  log: ConsolaInstance;
}

/**
 * The loose per-request context the public surface accepts. `log`/`logger`
 * are interchangeable so a home `RowContext` (which names it `logger`) flows in
 * unchanged; `asLibraryContext` resolves it into the canonical `LibraryContext`.
 */
export interface MaybeLibraryContext {
  userId: string;
  mediaService: MediaService;
  catalog: CatalogService;
  deadlineMs?: number;
  log?: ConsolaInstance;
  logger?: ConsolaInstance;
}
