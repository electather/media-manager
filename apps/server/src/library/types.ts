import type { ConsolaInstance } from "consola";
import type { MediaType } from "@ent-mcp/shared/media";
import type { WatchedState } from "@ent-mcp/shared/library";
import type { CatalogService } from "../catalog";
import type { MediaService } from "../media";

/**
 * One row the lens sources page off the `library_items` browse projection. It
 * is the raw row a `MediaSource.fetchRawSet` emits and the `enrichRows` hook
 * consumes; the denormalized columns (`servers`, `qualityTiers`, `watchedState`)
 * are read straight off it during enrich rather than re-probed live, which is
 * the whole point of the projection (design §Enrich). It is NOT the wire shape —
 * `enrichRows` maps it to a `CompactMediaItem`.
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

/**
 * A `LibraryRow` carrying the section it expanded into for the `json_each`
 * grouped lenses (server/quality). The server/quality SQL joins each owned row
 * against `json_each(servers)` / `json_each(quality_tiers)`, so one title yields
 * one expanded row per value; `section` is that value (design §The 5 lenses:
 * "row dup per value is INTENDED"). `section.id` is the keyset/group key (the
 * server connection id, or the quality tier label — which is its own id);
 * `section.label` is the human-readable header (the server label, or the tier
 * label). `rank` carries the Quality lens's SQL `CASE` ordinal back to the
 * source so the hop token reuses the EXACT rank that ordered the page; it is
 * absent on the Server lens, whose section id IS the sort key.
 */
export interface ExpandedLibraryRow extends LibraryRow {
  section: { id: string; label: string };
  rank?: number;
}

/**
 * Per-request context the library sync surface consumes. Mirrors
 * `WatchlistContext`: the resolved handles the read/sync paths need
 * (`mediaService` for the `collection@v1` feed, `catalog` for the metadata
 * pipeline that later phases hydrate from, and a logger). `log`/`logger` are
 * both accepted on the loose input so a home-style `RowContext` flows in
 * unchanged; `asLibraryContext` resolves it into this canonical shape.
 *
 * Phase 1 (membership sync) only needs `userId`, `mediaService`, and `log`;
 * `catalog` is carried so the phase-2 hydrate path can read it without
 * widening the context again.
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
