import type { ConsolaInstance } from "consola";
import type { HostErrorCode } from "@ent-mcp/shared/diagnostics";
import type { ArtworkRequestItem, ArtworkBundle } from "@ent-mcp/shared/artwork";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { MediaType, RowSort } from "@ent-mcp/shared/media";
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
 * bucket; `"mood"` keeps only rows matching a requested mood cluster;
 * `undefined` skips filtering entirely.
 */
export type FilterKind = "bucket" | "mood" | undefined;

/**
 * Opaque keyset hop token a persistent-table source threads back from
 * `fetchRawSet` (e.g. the last row's `addedAt:id`) so the `paginate` stage can
 * mint the next keyset cursor without re-deriving the query's hop position
 * (design §B/§E). It rides inside the next cursor's `k` string. Offset sources
 * leave `nextRaw` undefined — their next page is an in-memory slice index.
 */
export type RawPageToken = string;

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
  sort?: RowSort;
  filter?: FilterKind;
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
