import type { MediaService } from "../media/service";

type Status = "available" | "requested" | "processing" | "unavailable" | "unknown";

/**
 * Request-scoped memoizer for `MediaService.getStatusBatch`. Every row that
 * needs `status` enrichment hands its tmdb ids here; `get` collapses them
 * into a single `mediaRequest@v1.getStatusBatch` round-trip per request even
 * when multiple rows query overlapping ids.
 *
 * `mediaRequest@v1` is a `single` strategy capability so failures resolve to
 * an empty map at the dispatcher; `get` echoes that by defaulting missing
 * ids to `"unknown"`.
 */
export class StatusBatchMemo {
  private readonly cache = new Map<string, Status>();

  constructor(private readonly mediaService: MediaService) {}

  async get(ids: ReadonlyArray<string>): Promise<Record<string, Status>> {
    if (ids.length === 0) return {};
    const missing = ids.filter((id) => !this.cache.has(id));
    if (missing.length > 0) {
      const fetched = await this.mediaService.getStatusBatch(missing);
      for (const id of missing) {
        const status = fetched[id] as Status | undefined;
        this.cache.set(id, status ?? "unknown");
      }
    }
    const out: Record<string, Status> = {};
    for (const id of ids) {
      out[id] = this.cache.get(id) ?? "unknown";
    }
    return out;
  }
}
