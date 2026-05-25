import type { ConsolaInstance } from "consola";
import type { HostErrorCode } from "@ent-mcp/shared/diagnostics";
import type { ArtworkRequestItem, ArtworkBundle } from "@ent-mcp/shared/artwork";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import type { MediaType } from "@ent-mcp/shared/media";
import type { RawCanonicalSource } from "../catalog";

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
) => Promise<{ results: Record<string, ArtworkBundle> }>;

/** Canonical-row builder callback — injected into `MediaEnrichContext` to break the catalog ↔ media circular dep. */
export type ToCanonicalRowFn = (
  key: { tmdbId: string; type: MediaType },
  raw: RawCanonicalSource,
) => CanonicalMetadata;
