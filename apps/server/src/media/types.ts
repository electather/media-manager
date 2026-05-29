import type { ConsolaInstance } from "consola";
import type { HostErrorCode } from "@ent-mcp/shared/diagnostics";
import type { ArtworkRequestItem, ArtworkBundle } from "@ent-mcp/shared/artwork";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { MediaRowBucket, MediaType, RowSort } from "@ent-mcp/shared/media";
import type { RawCanonicalSource, CatalogService } from "../catalog";
import type { Cursor } from "./cursor";
import type { MediaService, StatusBatchMemo } from "./service";

export interface DispatchRequest {
  userId: string;
  capability: string;
  version: string;
  method: string;
  input: unknown;
  /** Optional explicit plugin id (overrides registry enumeration; used by gap-fill). */
  pluginId?: string;
  /** Optional media type for primary-connection lookup (metadata@v1). */
  mediaType?: "movie" | "tv";
  /** Skip cache read/write (e.g. for mutations or forced refresh). */
  skipCache?: boolean;
  /**
   * Wall-clock deadline in ms-epoch. When set, `invokeOne` skips a backoff
   * retry if the remaining budget is shorter than the backoff plus a small
   * call buffer. Aggregate dispatch then surfaces the original error so the
   * row stays in the layout as `partial: true` rather than disappearing.
   */
  deadlineMs?: number;
}

export interface AggregateResult<T> {
  data: T;
  errors: Array<{
    pluginId: string;
    connectionId: string | null;
    code: HostErrorCode;
    devMessage: string;
  }>;
  /**
   * Total number of providers contacted (successes + errors). Lets callers
   * disambiguate "no providers installed" (attempted=0) from "every provider
   * errored" (attempted=errors.length) from "some succeeded but had nothing
   * to contribute" (attempted > errors.length, data empty).
   */
  attempted: number;
}

/** Plugin chip displayed under `CompactMediaItem.availability.servers`. */
export interface MatchingServer {
  id: string;
  label: string;
}

/** Minimal media surface needed by shared availability-cache helpers. */
export interface MediaAvailabilityService {
  getMatchingServers(
    tmdbId: string,
    type: "movie" | "tv",
    opts?: { deadlineMs?: number },
  ): Promise<MatchingServer[]>;
}

/** Minimal media surface needed by shared enrichment helpers. */
export interface MediaEnrichService extends MediaAvailabilityService {
  getStatusBatch(
    ids: ReadonlyArray<string>,
    opts?: { deadlineMs?: number },
  ): Promise<Record<string, string>>;
  getMetadata(
    tmdbId: string,
    type: "movie" | "tv",
    opts?: { deadlineMs?: number },
  ): Promise<RawCanonicalSource | null>;
}

/** Minimal media surface needed by shared progress helpers. */
export interface MediaProgressService {
  getContinueWatchingFeed(opts?: {
    limit?: number;
    deadlineMs?: number;
  }): Promise<{ items: unknown[]; partial: boolean }>;
}

/** Shared context shape for progress-loading helpers (`loadProgressMap`). */
export interface MediaProgressContext {
  mediaService: MediaProgressService;
  log: ConsolaInstance;
  deadlineMs?: number;
}

/** Artwork fetcher callback — injected into `MediaEnrichContext` to break the artwork ↔ media circular dep. */
export type GetArtworkFn = (
  requests: ArtworkRequestItem[],
  opts?: { deadlineMs?: number },
) => Promise<{ results: Record<string, ArtworkBundle> }>;

/** Canonical-row builder callback — injected into `MediaEnrichContext` to break the catalog ↔ media circular dep. */
export type ToCanonicalRowFn = (
  key: { tmdbId: string; type: MediaType },
  raw: RawCanonicalSource,
) => CanonicalMetadata;

/**
 * Which predicate the pipeline `filter` stage applies, driven by the source's
 * request params (design §B). `"bucket"` keeps only rows matching a requested
 * bucket; `"preapplied"` is a marker the source uses to declare it has already
 * applied its filter source-side (mood is the only one today — the predicate
 * cannot leak out of the watchlist module per V.WL3) so the pipeline stage
 * must NOT re-derive it. `undefined` skips filtering entirely. Adding a real
 * pipeline-side case must extend the explicit `"bucket"` branch in
 * `applyBucketFilter`, never silently switch on `"preapplied"`.
 */
export type FilterKind = "bucket" | "preapplied" | undefined;

/**
 * Opaque keyset hop token a persistent-table source threads back from
 * `fetchRawSet` (e.g. the last row's `addedAt:id`) so the `paginate` stage can
 * mint the next keyset cursor without re-deriving the query's hop position
 * (design §B/§E). It rides inside the next cursor's `k` string. Offset sources
 * leave `nextRaw` undefined — their next page is an in-memory slice index.
 */
export type RawPageToken = string;

/**
 * The sort the pipeline's sort stage applies. Extends the shared recency
 * `RowSort` with `"none"` — an identity sort a source declares when it already
 * returned rows in their final order, so the pipeline must NOT re-order them.
 * Two sources need it: an offset source that pre-sorted by catalog metadata
 * (watchlist `alpha`/`runtime`/`status`, which `RowSort` cannot express) and a
 * pre-ranked feed (the tonight source). It stays media-internal — it is not a
 * persisted/repo sort, so it does not widen the shared `RowSort` enum.
 */
export type PipelineSort = RowSort | "none";

/**
 * Per-call context the consumer envelope hands to a `MediaSource` and the
 * pipeline. Unifies the home `RowContext` and watchlist `WatchlistContext`
 * (design §B): one media-owned shape carrying the per-user service handles a
 * source needs to fetch its raw set. Eligibility stays a consumer concern, off
 * this shape (invariant V.MC1).
 */
export interface SourceContext {
  userId: string;
  mediaService: MediaService;
  catalog: CatalogService;
  /** Wall-clock cap for plugin calls — sources thread it onto aggregate calls. */
  deadlineMs?: number;
  /** Request-scoped memo for `mediaRequest@v1.getStatusBatch` ids. */
  statusBatch: StatusBatchMemo;
  logger: ConsolaInstance;
  /**
   * Artwork fetcher the consumer injects so the pipeline's enrich stage can
   * hydrate posters/backdrops without media importing the artwork module
   * (breaks the artwork ↔ media cycle). Optional: when omitted, enrich skips
   * artwork hydration. Both consumers (watchlist `asWatchlistContext`, home
   * `media-enrichment`) already build this callback today.
   */
  getArtwork?: GetArtworkFn;
  /**
   * Raw → canonical metadata mapper the consumer injects so enrich's cold-fill
   * can normalize freshly fetched plugin metadata without media importing the
   * catalog mapper (breaks the catalog ↔ media cycle). Optional: when omitted,
   * cold-fill is skipped.
   */
  toCanonicalRow?: ToCanonicalRowFn;
  /**
   * Consumer-side match-reason hint, completing the `RowContext ∪ WatchlistContext`
   * unification (design §B): the home seed sources (`becauseYouWatched`/`similarTo`)
   * resolve the seed title during `fetchRawSet` and stash it here so the home
   * enrich override's `match-reason` callback can surface it on the same context
   * object. Media itself never reads it (enrich's match-reason is consumer-injected).
   *
   * NOTE — this is the ONE legitimate write-back slot on `SourceContext`
   * (documented exception to source purity per design §H). Sources MUST NOT
   * stash any other state on the context; thread additional hints back via the
   * `fetchRawSet` return shape instead.
   */
  seedTitle?: string;
}

/**
 * Config the consumer passes alongside a source to `listRows` (design §B/§C).
 * `P` matches the source's `fetchRawSet` params. `cursor` is already decoded
 * to a `Cursor | null` by the consumer (which owns the null mapping per
 * invariant V.CU1: home feed → 400, watchlist → first-page); `sort`/`filter`
 * override the source's stage defaults when supplied.
 */
export interface PipelineConfig<P = void> {
  params: P;
  sort?: PipelineSort;
  filter?: FilterKind;
  /**
   * The target bucket for a `filter: "bucket"` run. `bucket` is a media-owned
   * concept (`MediaRowBucket`), so the pipeline's filter stage reads it from
   * the typed config rather than from the opaque per-source `params`; the
   * consumer maps its own request param onto it. (Mood filtering stays
   * source-side — media must not derive moods — so there is no mood field
   * here.)
   */
  bucket?: MediaRowBucket;
  cursor: Cursor | null;
  limit: number;
}

/**
 * The single read-pipeline result shape (design §B/§C), replacing the home
 * `RowPage`. `items` are public `CompactMediaItem`s (internal `__*` fields
 * already stripped, invariant V.MI1); `cursor` is the encoded next-page string
 * (`null` when exhausted); `partial` is true when a source soft-failed.
 */
export interface Page {
  items: CompactMediaItem[];
  cursor: string | null;
  partial: boolean;
}
