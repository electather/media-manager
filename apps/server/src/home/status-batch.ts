import type { MediaService } from "../media";

type Status = "available" | "requested" | "processing" | "unavailable" | "unknown";

/**
 * Request-scoped memoizer for `MediaService.getStatusBatch`. Every row that
 * needs `status` enrichment hands its composite ids here; `get` collapses
 * them into a single `mediaRequest@v1.getStatusBatch` round-trip per
 * request even when multiple rows fetch concurrently with overlapping ids.
 *
 * The `inflight` map deduplicates concurrent calls — a row that asks for
 * `["movie:1","movie:2"]` while another's `["movie:2","movie:3"]` request
 * is mid-flight will join the existing fetch for `movie:2` and only
 * request `movie:3` on the wire.
 *
 * `mediaRequest@v1` is a `single` strategy capability so failures resolve
 * to an empty map at the dispatcher; `get` echoes that by defaulting
 * missing ids to `"unknown"`.
 */
export class StatusBatchMemo {
  private readonly cache = new Map<string, Status>();
  private readonly inflight = new Map<string, Promise<Status>>();

  constructor(private readonly mediaService: MediaService) {}

  async get(ids: ReadonlyArray<string>): Promise<Record<string, Status>> {
    if (ids.length === 0) return {};
    const toFetch = ids.filter((id) => !this.cache.has(id) && !this.inflight.has(id));
    if (toFetch.length > 0) {
      const fetchPromise = this.mediaService.getStatusBatch(toFetch).then((res) => {
        for (const id of toFetch) {
          const status = res[id] as Status | undefined;
          this.cache.set(id, status ?? "unknown");
        }
        return res;
      });
      for (const id of toFetch) {
        this.inflight.set(
          id,
          fetchPromise
            .then(() => this.cache.get(id) ?? "unknown")
            .finally(() => this.inflight.delete(id)),
        );
      }
    }
    // Wait on any in-flight fetches we are joining.
    await Promise.all(
      ids
        .filter((id) => !this.cache.has(id))
        .map((id) => this.inflight.get(id) ?? Promise.resolve()),
    );
    const out: Record<string, Status> = {};
    for (const id of ids) out[id] = this.cache.get(id) ?? "unknown";
    return out;
  }
}
