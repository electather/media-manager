import type { MediaEnrichService } from "./types";

type Status = "available" | "requested" | "processing" | "unavailable" | "unknown";

/**
 * Request-scoped memoizer for `MediaService.getStatusBatch`. Overlapping
 * callers share in-flight lookups so row and hero enrichment do not duplicate
 * the same `mediaRequest@v1.getStatusBatch` call inside one request.
 */
export class StatusBatchMemo {
  private readonly cache = new Map<string, Status>();
  private readonly inflight = new Map<string, Promise<Status>>();

  constructor(private readonly mediaService: MediaEnrichService) {}

  async get(
    ids: ReadonlyArray<string>,
    opts: { deadlineMs?: number } = {},
  ): Promise<Record<string, Status>> {
    if (ids.length === 0) return {};
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
