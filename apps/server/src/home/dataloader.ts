import type { MediaService } from "../media/service";

/** Plugin requirement encoded as `"<capability>@v<n>"`. */
export type PluginRequirement = `${string}@v${number}`;

/** Composite media id used across the home feed (`"movie:550"`, `"tv:1396"`). */
export type MediaId = string;

/**
 * Per-request memoization layer. Construction is cheap; one loader is built
 * by the home orchestrator at the entrance to `getLayout` / `getRowContent`
 * and discarded when the request returns. The loader's job is purely to
 * coalesce repeated reads — never to introduce cross-request cache scope, so
 * row fetchers can call its methods freely without thinking about cost.
 */
export class RequestScopedLoader {
  private readonly metadataCache = new Map<MediaId, Promise<unknown>>();
  private inProgressSetPromise: Promise<Set<MediaId>> | null = null;
  private readonly hasPluginCache = new Map<PluginRequirement, Promise<boolean>>();

  // Status batch coalescing state. Each row may call `getStatusBatch` during
  // its fetch; the loader collects every id requested in the same microtask
  // pass and fires one underlying call before resolving each caller.
  private pendingStatusIds: Set<MediaId> | null = null;
  private pendingStatusFlush: Promise<Record<MediaId, string>> | null = null;
  private statusBudgetMs = 1_000;

  constructor(
    private readonly mediaService: MediaService,
    public readonly userId: string,
  ) {}

  /**
   * Memoized metadata read keyed on composite id. Two rows surfacing the same
   * title share a single underlying call. Errors propagate to every awaiter.
   */
  // fallow-ignore-next-line unused-class-member
  async getMetadata(id: MediaId): Promise<unknown> {
    const existing = this.metadataCache.get(id);
    if (existing) return existing;
    const promise = this.mediaService.getDetails(id).catch((err) => {
      this.metadataCache.delete(id);
      throw err;
    });
    this.metadataCache.set(id, promise);
    return promise;
  }

  /**
   * Microtask-coalesced status enrichment. Every caller arriving in the same
   * microtask shares one upstream `getStatusBatch` call; the response is
   * split per caller before resolution. The 1s timeout is tighter than the
   * per-row 3s budget — status is enrichment, not core row content.
   */
  // fallow-ignore-next-line unused-class-member
  async getStatusBatch(ids: MediaId[]): Promise<Record<MediaId, string>> {
    if (ids.length === 0) return {};
    if (!this.pendingStatusIds) {
      this.pendingStatusIds = new Set();
      this.pendingStatusFlush = new Promise((resolve) => {
        queueMicrotask(() => {
          const collected = this.pendingStatusIds ?? new Set<MediaId>();
          this.pendingStatusIds = null;
          this.pendingStatusFlush = null;
          void this.runStatusBatch([...collected]).then(resolve);
        });
      });
    }
    for (const id of ids) this.pendingStatusIds.add(id);
    const all = await this.pendingStatusFlush!;
    const out: Record<MediaId, string> = {};
    for (const id of ids) {
      if (all[id]) out[id] = all[id]!;
    }
    return out;
  }

  /**
   * Memoized "what's the user's current in-progress set" read. Returned as
   * a `Set` so cross-row exclusion (notably `becauseYouWatched`) is an O(1)
   * membership test. Shared with the layout signal computation; a row
   * fetcher invoking this on page 1 hits warm memoization rather than a
   * fresh aggregate call.
   */
  // fallow-ignore-next-line unused-class-member
  async getInProgressSet(): Promise<Set<MediaId>> {
    if (this.inProgressSetPromise) return this.inProgressSetPromise;
    this.inProgressSetPromise = this.mediaService.getInProgress().then(
      (result) => {
        const out = new Set<MediaId>();
        for (const item of result.items) {
          const id = readEntryCompositeId(item);
          if (id) out.add(id);
        }
        return out;
      },
      () => new Set<MediaId>(),
    );
    return this.inProgressSetPromise;
  }

  /**
   * Memoized "does the user have an enabled provider for this capability?"
   * lookup. Two rows asking the same question share a single registry +
   * connection scan. Backs both layout-time signal computation (which
   * populates `hasXPlugin` booleans) and `RowFetcher.isEligible` checks.
   */
  // fallow-ignore-next-line unused-class-member
  hasPlugin(requirement: PluginRequirement): Promise<boolean> {
    const existing = this.hasPluginCache.get(requirement);
    if (existing) return existing;
    const [capability, version] = requirement.split("@") as [string, string];
    const promise = this.mediaService.hasCapabilityProvider(capability, version).catch(() => false);
    this.hasPluginCache.set(requirement, promise);
    return promise;
  }

  private async runStatusBatch(ids: MediaId[]): Promise<Record<MediaId, string>> {
    if (ids.length === 0) return {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<Record<MediaId, string>>((resolve) => {
      timer = setTimeout(() => resolve({}), this.statusBudgetMs);
    });
    try {
      return await Promise.race([this.mediaService.getStatusBatch(ids), timeout]);
    } catch {
      return {};
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * Pulls the composite media id (`"movie:550"`) off a watchHistory in-progress
 * entry. Different plugin shapes carry the id in slightly different places;
 * this function tolerates the common ones used by the SDK schemas.
 */
// fallow-ignore-next-line complexity
function readEntryCompositeId(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const item = e.item as Record<string, unknown> | undefined;
  if (!item) return null;
  if (typeof item.id === "string" && item.id.includes(":")) return item.id;
  const ids = item.ids as Record<string, unknown> | undefined;
  const tmdbId = typeof ids?.tmdb_id === "string" ? ids.tmdb_id : null;
  const type = item.type;
  if (tmdbId && (type === "movie" || type === "tv")) return `${type}:${tmdbId}`;
  return null;
}
