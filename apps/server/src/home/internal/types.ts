import type { ConsolaInstance } from "consola";
import type { CompactMediaItem, RowKind } from "@ent-mcp/shared/home";
import type { TopContributor } from "@ent-mcp/shared/catalog";
import type { CatalogService } from "../../catalog";
import type { MediaService, StatusBatchMemo } from "../../media";

/**
 * Internal projection passed between rows + the orchestrator. We let rows
 * stash row-only context (e.g. seedTitle for `becauseYouWatched`,
 * topContributors snapshot for `recommendedForYou-*`) on this shape, the
 * orchestrator strips the doubled-underscore prefix before serialize so the
 * client wire stays clean.
 */
export interface InternalCompactMediaItem extends CompactMediaItem {
  /** Catalog rec-list `top_contributors` snapshot — drives match-reason chip. */
  __topContributors?: TopContributor[];
  /**
   * Wall-clock ms when the catalog row was first written. Used by the
   * `recently_added` match-reason resolver since `facets.releaseDate` is a
   * year string and can't drive a 7-day window. Stripped before serialize.
   */
  __addedAtMs?: number;
}

/** Result of a row's `fetchPage` call. */
export interface RowPage {
  items: InternalCompactMediaItem[];
  /** Opaque cursor for the next page, or null when the row is exhausted. */
  cursor: string | null;
  /** True when at least one provider errored alongside the surviving data. */
  partial: boolean;
}

/**
 * Per-row context the orchestrator hands to every provider. Service handles
 * are per-user instances so providers can call into them without re-deriving
 * the auth context.
 */
export interface RowContext {
  userId: string;
  mediaService: MediaService;
  catalog: CatalogService;
  /** Wall-clock cap for plugin calls — providers thread it onto aggregate calls. */
  deadlineMs?: number;
  /** Request-scoped memo for `mediaRequest@v1.getStatusBatch` ids. */
  statusBatch: StatusBatchMemo;
  logger: ConsolaInstance;
  /** Filled by `becauseYouWatched` and `similarTo` from their cursor seed; consumed by match-reason. */
  seedTitle?: string;
  /** Carried by `continueWatching-*` for the `matches_recent_picks` chip. */
  recentPickCount?: number;
}

/**
 * Row pipeline contract. Each row file exports a default `RowProvider` and
 * registers it in `rows/index.ts`. Adding a row is one drop-in file plus a
 * test under `rows/__tests__/`.
 */
export interface RowProvider {
  /** Stable wire slug, e.g. `"recommendedForYou-tv"`. Unique across the registry. */
  rowId: string;
  /** Display-category enum surfaced on `HomeRowStub.kind`. */
  kind: RowKind;
  /** Paraglide message key resolved by the client. */
  titleKey: string;
  eyebrowKey?: string;
  /**
   * Cheap check the orchestrator runs to decide whether to ship the row in
   * the layout. May call into the registry or catalog; should not run plugin
   * fetches.
   */
  eligibility(ctx: RowContext): Promise<boolean>;
  /**
   * Cursor the orchestrator stamps onto `HomeRowStub.initialCursor`. Most
   * rows return null (cursor-less first page); seeded rows like
   * `becauseYouWatched` encode a non-null seed payload.
   */
  initialCursor(ctx: RowContext): Promise<string | null>;
  /**
   * Page fetch. `cursor === null` is the first page unless
   * `requiresInitialCursor` is set. Bounded rows return `cursor: null` after
   * the single page they ship.
   */
  fetchPage(ctx: RowContext, cursor: string | null): Promise<RowPage>;
  /**
   * When true, the orchestrator rejects `fetchPage(ctx, null)` calls with
   * `HttpError 400 "cursor_required"`. Used by `becauseYouWatched`, where
   * the seed lives on the cursor.
   */
  requiresInitialCursor?: boolean;
}
