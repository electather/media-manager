import { consola } from "consola";
import type {
  ArtworkBundle,
  ArtworkError,
  ArtworkGetResponse,
  ArtworkIdMap,
  ArtworkRequestItem,
} from "@ent-mcp/shared/artwork";
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
    void this.catalogService
      .patchArtwork({ tmdbId: entry.ids.tmdb, type: entry.type }, urls)
      .catch((err) => {
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
  ids: ArtworkIdMap;
  type: "movie" | "tv";
  clientKeys: string[];
}

function dedupeByCanonicalKey(items: ArtworkRequestItem[]): Map<string, CanonicalEntry> {
  const out = new Map<string, CanonicalEntry>();
  for (const item of items) {
    const ck = canonicalKey(item.ids, item.type);
    let entry = out.get(ck);
    if (!entry) {
      entry = { ids: item.ids, type: item.type, clientKeys: [] };
      out.set(ck, entry);
    }
    entry.clientKeys.push(item.key);
  }
  return out;
}

function canonicalKey(ids: ArtworkIdMap, type: "movie" | "tv"): string {
  const parts: string[] = [type];
  for (const k of ["tmdb", "imdb", "tvdb"] as const) {
    const value = ids[k];
    if (value) parts.push(`${k}:${value}`);
  }
  return parts.join("|");
}

function mapDispatchError(reason: unknown): ArtworkError {
  if (reason instanceof PluginCallError && reason.code === "artwork.unsupported_id_combo") {
    return { code: "unsupported_id_combo", message: reason.message };
  }
  return { code: "internal", message: "artwork lookup failed" };
}
