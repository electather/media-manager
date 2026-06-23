import { consola } from "consola";
import {
  canonicalArtworkKey,
  type ArtworkBundle,
  type ArtworkError,
  type ArtworkGetResponse,
  type ArtworkIdMap,
  type ArtworkRequestItem,
} from "@nama/shared/artwork";
import type { CatalogService } from "../catalog";
import { dispatchAggregatePerKind, PluginCallError } from "../media";

/**
 * Stateless orchestrator for `artwork.get` RPC. Dedupes by canonical `(idsHash, type)` so
 * batch requests for the same title pay one dispatch, then routes through `aggregate_per_kind`.
 * Per-item errors stay on the response; the batch never fails. Per V47, patches each fulfilled
 * dispatch into `CatalogService.patchArtwork` fire-and-forget to warm the canonical row.
 */
export class ArtworkService {
  constructor(
    public readonly userId: string,
    private readonly catalogService: CatalogService,
  ) {}

  // fallow-ignore-next-line complexity
  async getArtwork(
    items: ArtworkRequestItem[],
    languages: string[] = [...DEFAULT_LANGUAGES],
    opts: { deadlineMs?: number } = {},
  ): Promise<ArtworkGetResponse> {
    const canonical = dedupeByCanonicalKey(items);
    const entries = [...canonical.values()];

    const settled = await Promise.allSettled(
      entries.map((entry) =>
        dispatchAggregatePerKind<ArtworkBundle>({
          userId: this.userId,
          capability: "artwork",
          version: "v1",
          method: "getArtwork",
          input: { ids: entry.ids, type: entry.type, languages },
          deadlineMs: opts.deadlineMs,
        }),
      ),
    );

    const results: Record<string, ArtworkBundle> = {};
    const errors: Record<string, ArtworkError> = {};

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const outcome = settled[i]!;
      if (outcome.status === "fulfilled") {
        for (const key of entry.clientKeys) results[key] = outcome.value;
        this.writeBack(entry, outcome.value);
        continue;
      }
      const err = mapDispatchError(outcome.reason);
      for (const key of entry.clientKeys) errors[key] = err;
      // `unsupported_id_combo` is caller-visible expected behaviour, not a bug.
      // Anything else came from a dispatcher fault we should leave a trace of.
      if (err.code === "internal") {
        consola.error("[artwork] dispatch crashed", { entry, reason: outcome.reason });
      }
    }

    const out: ArtworkGetResponse = { results, generatedAt: Date.now() };
    if (Object.keys(errors).length > 0) out.errors = errors;
    return out;
  }

  // fallow-ignore-next-line complexity
  private writeBack(entry: CanonicalEntry, bundle: ArtworkBundle): void {
    if (!entry.ids.tmdb) return;
    const urls = top1(bundle);
    // Skip when the plugin returned no art at all. Patching with all-null
    // values is a no-op for the COALESCE write itself but still bumps
    // `lastRefreshedAt`, which would defer nightly `listStaleMetadata`
    // re-pickup for rows that legitimately have nothing yet.
    if (!urls.posterUrl && !urls.backdropUrl && !urls.clearLogoUrl) return;
    // Collapse write-backs for this canonical row inside the dedup window, e.g.
    // many users viewing the same hot title. The window keys on the title only,
    // so a partial first bundle (or a differing `languages` set) can defer a
    // newly resolved slot until the window lapses — an accepted, bounded
    // trade-off documented in the design doc's Concurrency section.
    const claim = claimWriteBack(entry.key, Date.now());
    if (claim === null) return;
    void this.catalogService
      .patchArtwork({ tmdbId: entry.ids.tmdb, type: entry.type }, urls)
      .catch((err) => {
        // The patch is best-effort: the next read should be free to write it
        // again. Release this claim so a rejected patch does not block retries
        // for the whole dedup window. Pass the claim token so a patch that
        // outlives its window cannot evict a newer claim that has since taken
        // the key — only the claim that still owns the entry releases it.
        releaseWriteBack(entry.key, claim);
        consola.error("[artwork] patch failed", err);
      });
  }
}

// fallow-ignore-next-line complexity
function top1(bundle: ArtworkBundle): {
  posterUrl: string | null;
  backdropUrl: string | null;
  clearLogoUrl: string | null;
} {
  return {
    posterUrl: bundle.poster[0]?.url ?? null,
    backdropUrl: bundle.backdrop[0]?.url ?? null,
    clearLogoUrl: bundle.clearLogo[0]?.url ?? null,
  };
}

const DEFAULT_LANGUAGES = ["en", "00"] as const;

interface CanonicalEntry {
  /** Stable canonical key, also used to dedupe write-backs across requests. */
  key: string;
  ids: ArtworkIdMap;
  type: "movie" | "tv";
  clientKeys: string[];
}

/**
 * Dedup window: how long a key stays "recently patched" before write-backs resume.
 * Shared canonical row across N users — without windowing, concurrent viewers each fire
 * an UPDATE, amplifying write/WAL traffic. One patch per window keeps it bounded.
 * @internal Exported so tests can assert the real value instead of a hand-copied literal.
 */
export const WRITE_BACK_DEDUP_MS = 60_000;

/**
 * Process-wide record of when each canonical key was last patched. Lives at
 * module scope because `ArtworkService` is constructed per request, so the
 * dedup state has to span requests to suppress cross-user amplification.
 */
const recentWriteBacks = new Map<string, number>();

/** Drops entries older than the dedup window so the map stays bounded by the
 *  number of distinct keys touched within a window rather than growing forever.
 *  Runs a linear scan on every `claimWriteBack`; that is a deliberate trade-off
 *  — the map is window-bounded so the scan is cheap under the single-process
 *  SQLite assumption, and it avoids a second timer/heap to track expiry. */
function pruneExpiredWriteBacks(now: number): void {
  for (const [k, at] of recentWriteBacks) {
    if (now - at >= WRITE_BACK_DEDUP_MS) recentWriteBacks.delete(k);
  }
}

/**
 * Returns a claim token (the timestamp) if write-back for `key` should proceed,
 * null if one already fired in the dedup window. Timestamp acts as a generation token
 * to distinguish stale claims from the current owner. Prunes expired entries each call.
 */
function claimWriteBack(key: string, now: number): number | null {
  pruneExpiredWriteBacks(now);
  const last = recentWriteBacks.get(key);
  if (last !== undefined && now - last < WRITE_BACK_DEDUP_MS) return null;
  recentWriteBacks.set(key, now);
  return now;
}

/**
 * Releases a claimed key (on patch rejection) so retries can proceed. Only releases
 * if `claim` still owns the key; a stale patch that outlives its window cannot evict
 * a newer claim. Assumes `Date.now()` is monotonically non-decreasing; backward clock
 * step could block claims indefinitely until recovery.
 */
function releaseWriteBack(key: string, claim: number): void {
  if (recentWriteBacks.get(key) === claim) recentWriteBacks.delete(key);
}

/**
 * Test-only: clears the process-wide write-back dedup state. Module-scope state
 * persists across tests in-process, so suites that exercise the window must
 * reset it in `beforeEach` rather than reaching for a globally-unique id.
 */
export function resetWriteBackDedupForTests(): void {
  recentWriteBacks.clear();
}

function dedupeByCanonicalKey(items: ArtworkRequestItem[]): Map<string, CanonicalEntry> {
  const out = new Map<string, CanonicalEntry>();
  for (const item of items) {
    const ck = canonicalArtworkKey(item.ids, item.type);
    let entry = out.get(ck);
    if (!entry) {
      entry = { key: ck, ids: { ...item.ids }, type: item.type, clientKeys: [] };
      out.set(ck, entry);
    } else {
      // Union id maps across collapsing items — batches carry different subsets
      // (e.g. `{tmdb}` then `{tmdb, imdb}`), and provider eligibility keys off
      // dispatched ids (fanart: TV=tvdb, movie=imdb/tmdb). Only first-seen subset
      // would drop ids and couple coverage to ordering. Existing ids win so the
      // canonical key never shifts.
      entry.ids = { ...item.ids, ...entry.ids };
    }
    entry.clientKeys.push(item.key);
  }
  return out;
}

function mapDispatchError(reason: unknown): ArtworkError {
  if (reason instanceof PluginCallError && reason.code === "artwork.unsupported_id_combo") {
    return { code: "unsupported_id_combo", message: reason.message };
  }
  return { code: "internal", message: "artwork lookup failed" };
}
