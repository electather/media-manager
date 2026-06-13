import type { ConsolaInstance } from "consola";
import type { CompactMediaItem, RowKind } from "@nama/shared/home";
import type { TopContributor } from "@nama/shared/catalog";
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
 * Row pipeline contract (post media-pipeline consolidation, design §H). Each
 * row file exports a default `RowProvider` and registers it in `rows/index.ts`.
 * Adding a row is one drop-in file plus a test under `rows/__tests__/`.
 *
 * The row no longer owns sort/slice/cursor: those live in the shared media
 * pipeline (`media.listRows`). A row supplies eligibility, the initial cursor,
 * its pagination `cursorMode` (so the envelope can decode the cursor, V.CU1),
 * and a `load` that runs the row through `listRows` with its source + raw-row
 * projection + the row-aware match-reason enrichment captured inside.
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
  /**
   * Cursor the orchestrator stamps onto `HomeRowStub.initialCursor`. Most
   * rows return null (cursor-less first page); seeded rows like
   * `becauseYouWatched` encode a non-null seed payload (a keyset cursor whose
   * `k` carries the seed).
   */
  initialCursor(ctx: RowContext): Promise<string | null>;
  /**
   * Load one page through the shared media pipeline (`listRows`), returning the
   * enriched `Page`. The source, the raw-row → compact projection, and the
   * row-aware match-reason live inside; `cursor` is already decoded (the
   * envelope owns the `null → 400` mapping). Bounded rows project a single
   * page so the pipeline mints `cursor: null`.
   */
  load(ctx: RowContext, cursor: Cursor | null): Promise<Page>;
  /**
   * Assemble the same pipeline pieces `load` runs — the source, the
   * decoded-cursor config, and the home enrich override — WITHOUT executing
   * them. The `/api/media` resolver (design §A3/§A4) feeds these straight into
   * `media.listRows`, so the home registration map (`homeMediaSources`) surfaces
   * a row through the generic resolver without re-deriving its wiring (invariant
   * V.A1: the assembly stays home-side). `load` is defined in terms of this, so
   * the two never drift.
   */
  buildPipeline(ctx: RowContext, cursor: Cursor | null): BuiltMediaSource<any, any>;
  /**
   * When true, the orchestrator rejects cursor-less `composeRow` calls with
   * `HttpError 400 "cursor_required"`. Used by `becauseYouWatched`/`similarTo`,
   * where the seed lives on the cursor.
   */
  requiresInitialCursor?: boolean;
}
