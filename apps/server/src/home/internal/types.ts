import type { ConsolaInstance } from "consola";
import type { CompactMediaItem, RowKind } from "@nama/shared/home";
import type { RecommendationList, TopContributor } from "@nama/shared/catalog";
import type { CatalogService } from "../../catalog";
import type {
  BuiltMediaSource,
  Cursor,
  CursorMode,
  MediaService,
  Page,
  StatusBatchMemo,
} from "../../media";

/**
 * Internal projection with row-specific context (seedTitle, topContributors).
 * Orchestrator strips `__` prefix before serializing so client wire stays clean.
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
  /** Request-scoped memo for `"default"` recommendations; fetched once across tv+movies partitions instead of up to 4 times. Built in `buildContext`; falls back to `catalog.getRecommendations` if unset. */
  recommendations?: () => Promise<RecommendationList | null>;
  logger: ConsolaInstance;
  /** Filled by `becauseYouWatched` and `similarTo` from their cursor seed; consumed by match-reason. */
  seedTitle?: string;
  /** Carried by `continueWatching-*` for the `matches_recent_picks` chip. */
  recentPickCount?: number;
}

/**
 * Row pipeline contract (design §H). Sort/slice/cursor live in shared media pipeline (`media.listRows`).
 * Row supplies eligibility, initial cursor, pagination `cursorMode` (V.CU1), and `load` that runs through `listRows`.
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
   * The source's pagination mode (`source.stages.cursorMode`). The envelope
   * decodes an incoming cursor against it; a bad/foreign/mode-mismatched cursor
   * decodes to `null`, which the home feed maps to `HttpError 400` (V.CU1).
   */
  cursorMode: CursorMode;
  /**
   * Cheap check the orchestrator runs to decide whether to ship the row in
   * the layout. May call into the registry or catalog; should not run plugin
   * fetches.
   */
  eligibility(ctx: RowContext): Promise<boolean>;
  /** Cursor for `HomeRowStub.initialCursor`. Most rows return null; seeded rows like `becauseYouWatched` encode seed in keyset cursor `k`. */
  initialCursor(ctx: RowContext): Promise<string | null>;
  /** Load one page through media pipeline; cursor already decoded (envelope owns null→400 mapping). Bounded rows mint cursor: null. */
  load(ctx: RowContext, cursor: Cursor | null): Promise<Page>;
  /** Assemble pipeline pieces (source, decoded-cursor, home enrich) without executing. `/api/media` feeds into `media.listRows` via `homeMediaSources`; stays home-side (V.A1). `load` defined in terms of this to avoid drift (design §A3/§A4). */
  buildPipeline(ctx: RowContext, cursor: Cursor | null): BuiltMediaSource<any, any>;
  /**
   * When true, the orchestrator rejects cursor-less `composeRow` calls with
   * `HttpError 400 "cursor_required"`. Used by `becauseYouWatched`/`similarTo`,
   * where the seed lives on the cursor.
   */
  requiresInitialCursor?: boolean;
}
