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
 * Stateless per-request orchestrator for the `artwork.get` RPC. Given a batch
 * of `(key, ids, type)` request items it dedupes by canonical
 * `(idsHash, type)` so two rows referencing the same logical title pay one
 * dispatch, then routes each canonical entry through the
 * `aggregate_per_kind` strategy. Per-item errors are captured on the response
 * so a single bad item never breaks the batch — top-level RPC stays 200
 * unless the wrapping zod schema rejects the input.
 *
 * Per V47 every fulfilled dispatch is fanned back into
 * `CatalogService.patchArtwork` so the canonical row picks up any newly
 * resolved URL. The patch is fire-and-forget — it must not slow the RPC
 * response down or surface errors to the caller.
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
    if (!claimWriteBack(entry.key, Date.now())) return;
    void this.catalogService
      .patchArtwork({ tmdbId: entry.ids.tmdb, type: entry.type }, urls)
      .catch((err) => {
        // The patch is best-effort: the next read should be free to write it
        // again. Release the claim so a rejected patch does not block retries
        // for the whole dedup window.
        releaseWriteBack(entry.key);
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
 * How long a canonical key stays "recently patched" before another write-back
 * is allowed. The canonical metadata row is shared across all users, so when N
 * users view the same hot title in the same window every fulfilled dispatch
 * would otherwise fire its own COALESCE UPDATE against the one row. The patch
 * is idempotent, but the redundant write/WAL traffic scales with concurrent
 * viewers. Collapsing to at most one patch per key per window keeps a hot title
 * from amplifying writes while still letting later renders refresh the row.
 */
const WRITE_BACK_DEDUP_MS = 60_000;

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
 * Returns `true` and records the timestamp when a write-back for `key` should
 * proceed; returns `false` when one already fired inside the dedup window.
 * Prunes expired entries on each call.
 */
function claimWriteBack(key: string, now: number): boolean {
  pruneExpiredWriteBacks(now);
  const last = recentWriteBacks.get(key);
  if (last !== undefined && now - last < WRITE_BACK_DEDUP_MS) return false;
  recentWriteBacks.set(key, now);
  return true;
}

/**
 * Drops a previously claimed key so the next read can write it again. Called
 * when a fire-and-forget patch rejects — the claim must not outlive a failed
 * write or it would suppress retries for the rest of the window.
 */
function releaseWriteBack(key: string): void {
  recentWriteBacks.delete(key);
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
      // Union the id maps across every item that collapses onto this key. Two
      // rows for the same logical title can carry different id subsets (e.g.
      // `{tmdb}` then `{tmdb, imdb}`), and provider eligibility is computed
      // from the dispatched ids — fanart keys TV off `tvdb` and movies off
      // `imdb`/`tmdb`. Keeping only the first-seen subset would drop those ids
      // and make coverage depend on batch ordering, so accumulate the richest
      // set while still collapsing to one dispatch. Existing ids win so the
      // canonical key (highest-precedence id) never shifts.
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
