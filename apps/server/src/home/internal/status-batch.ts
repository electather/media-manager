import type { MediaService } from "../../media";

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

  async get(
    ids: ReadonlyArray<string>,
    opts: { deadlineMs?: number } = {},
  ): Promise<Record<string, Status>> {
    if (ids.length === 0) return {};
    // `opts.deadlineMs` is intentionally not applied to in-flight dedup hits:
    // the first caller's deadline governs the shared promise, matching the
    // deadline-agnostic memo identity used in `MediaService.getMatchingServers`.
    const toFetch = ids.filter((id) => !this.cache.has(id) && !this.inflight.has(id));
    if (toFetch.length > 0) this.scheduleFetch(toFetch, opts);
    await this.awaitPending(ids);
    return this.collectResults(ids);
  }

  private awaitPending(ids: ReadonlyArray<string>): Promise<unknown> {
    return Promise.all(
      ids
        .filter((id) => !this.cache.has(id))
        .map((id) => this.inflight.get(id) ?? Promise.resolve()),
    );
  }

  private collectResults(ids: ReadonlyArray<string>): Record<string, Status> {
    const out: Record<string, Status> = {};
    for (const id of ids) out[id] = this.cache.get(id) ?? "unknown";
    return out;
  }

  private scheduleFetch(toFetch: ReadonlyArray<string>, opts: { deadlineMs?: number }): void {
    const fetchPromise = this.mediaService.getStatusBatch(toFetch, opts).then((res) => {
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
}
