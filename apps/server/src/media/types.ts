import type { ConsolaInstance } from "consola";
import type { HostErrorCode } from "@nama/shared/diagnostics";
import type { ArtworkRequestItem, ArtworkBundle } from "@nama/shared/artwork";
import type { CanonicalMetadata, RecommendationList } from "@nama/shared/catalog";
import type { MediaRowBucket, MediaType, RowSort } from "@nama/shared/media";
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
  /** Wall-clock deadline in ms-epoch; `invokeOne` skips backoff retries when remaining budget is too short, surfaces original error so row renders `partial: true` instead of disappearing. */
  deadlineMs?: number;
}

export interface AggregateResult<T> {
  data: T | null;
  errors: Array<{
    pluginId: string;
    connectionId: string | null;
    code: HostErrorCode;
    devMessage: string;
  }>;
  /** Total providers contacted; disambiguates "no providers installed" (attempted=0) vs "all errored" (attempted=errors.length) vs "some succeeded, none contributed" (attempted > errors.length, data empty). */
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

/** Pipeline `filter` stage predicate (design §B): `"bucket"` filters to matched rows; `"preapplied"` marks source-side filter (mood only today, cannot leak out per V.WL3) so pipeline must NOT re-derive; `undefined` skips filtering. New pipeline cases must extend `"bucket"` branch in `applyBucketFilter`, never switch on `"preapplied"`. */
export type FilterKind = "bucket" | "preapplied" | undefined;

/** Opaque keyset hop token from persistent-table `fetchRawSet` (e.g., `addedAt:id`) so `paginate` stage mints next keyset cursor without re-deriving position (design §B/§E). Rides in next cursor's `k` string. Offset sources leave undefined—next page is in-memory slice index. */
export type RawPageToken = string;

/** Pipeline sort stage: extends shared `RowSort` with `"none"` (identity sort—source declares rows already in final order, pipeline must NOT re-order). Used by offset sources pre-sorted on watchlist `alpha`/`runtime`/`status` (unrepresentable in `RowSort`) and pre-ranked feeds (tonight). Stays media-internal, not persisted. */
export type PipelineSort = RowSort | "none";

/** Per-call context for `MediaSource` and pipeline (design §B): unified shape replacing home `RowContext` and watchlist `WatchlistContext`, carries per-user service handles needed by `fetchRawSet`. Eligibility stays consumer-side (invariant V.MC1). */
export interface SourceContext {
  userId: string;
  mediaService: MediaService;
  catalog: CatalogService;
  /** Wall-clock cap for plugin calls — sources thread it onto aggregate calls. */
  deadlineMs?: number;
  /** Request-scoped memo for `mediaRequest@v1.getStatusBatch` ids. */
  statusBatch: StatusBatchMemo;
  logger: ConsolaInstance;
  /** Request-scoped memo for user's `"default"` recommendation list (consumer-injected). Home `recommendedForYou-*` rows read from both eligibility check and `fetchRawSet` across tv+movies partitions—memo prevents up-to-4x fetches. Falls back to `catalog.getRecommendations` when absent. */
  recommendations?: () => Promise<RecommendationList | null>;
  /** Artwork fetcher callback (consumer-injected) to hydrate posters/backdrops without media importing artwork module (breaks artwork↔media cycle). Optional; when omitted, enrich skips hydration. Both consumers (watchlist `asWatchlistContext`, home `media-enrichment`) build this today. */
  getArtwork?: GetArtworkFn;
  /** Raw→canonical metadata mapper (consumer-injected) to normalize freshly fetched plugin metadata without media importing catalog module (breaks catalog↔media cycle). Optional; when omitted, cold-fill is skipped. */
  toCanonicalRow?: ToCanonicalRowFn;
  /** Consumer-side match-reason hint (design §B): home seed sources (`becauseYouWatched`/`similarTo`) resolve seed title during `fetchRawSet` and stash here so enrich's `match-reason` callback can surface it on same context. Media never reads it (callback is consumer-injected). NOTE—this is the ONE legitimate write-back slot on `SourceContext` (design §H exception); sources MUST NOT stash other state; thread hints via `fetchRawSet` return instead. */
  seedTitle?: string;
}

/** Consumer's config for `listRows` alongside a source (design §B/§C). `P` matches source's `fetchRawSet` params. `cursor` is pre-decoded `Cursor | null` (consumer owns null mapping per V.CU1: home→400, watchlist→first-page); `sort`/`filter` override source defaults when supplied. */
export interface PipelineConfig<P = void> {
  params: P;
  sort?: PipelineSort;
  filter?: FilterKind;
  /** Target bucket for `filter: "bucket"` run. `bucket` is media-owned (`MediaRowBucket`), so pipeline filter stage reads from typed config not opaque `params`; consumer maps its request param onto it. (Mood filtering stays source-side—media must not derive moods—so no mood field.) */
  bucket?: MediaRowBucket;
  cursor: Cursor | null;
  limit: number;
}

/** Single read-pipeline result shape (design §B/§C), replacing home `RowPage`. `items` are public `CompactMediaItem`s (internal `__*` stripped, V.MI1); `cursor` is encoded next-page string (null when exhausted); `partial` is true on source soft-fail. Re-exported from `@nama/shared/media` so client and server share canonical shape (design §A5, V.WIRE1). */
export type { Page } from "@nama/shared/media";
