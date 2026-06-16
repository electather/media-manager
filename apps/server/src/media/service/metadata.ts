/**
 * Primary `metadata@v1` dispatch wrappers backing the MediaService facade.
 * Every function dispatches through the primary-plugin strategy and shapes the
 * result so MCP tools and RPC procedures can consume arrays/objects directly.
 */
import type { SeasonInfo } from "@nama/shared/home";
import { isNil } from "es-toolkit/predicate";
import type { RawCanonicalSource } from "../../catalog";
import { badRequest } from "../../diagnostics/http-errors";
import type { AggregateResult } from "../types";
import { dispatchPrimary } from "./dispatch";

const COMBINED_ID_KINDS = new Set(["movie", "tv"] as const);

/**
 * Validates a colon-delimited combined id and returns its typed tuple. Rejects
 * any shape other than exactly `movie:<id>` or `tv:<id>` with a non-empty id —
 * a malformed value like `movie:tt1:extra`, `show:550`, or `movie:` (empty
 * segment) must surface as a bad-request rather than be force-cast into the
 * typed tuple and propagate an empty id into the plugin dispatch layer.
 */
function parseValidCombinedId(combined: string): ["movie" | "tv", string] {
  const [kind, id, ...rest] = combined.split(":");
  const valid = COMBINED_ID_KINDS.has(kind as "movie" | "tv") && id && rest.length === 0;
  if (!valid) {
    throw badRequest("media.invalid_combined_id", `combined id must be "movie:<id>" or "tv:<id>"`, {
      id: combined,
    });
  }
  return [kind as "movie" | "tv", id!];
}

function parseCombinedId(idOrCombined: string, type?: "movie" | "tv"): ["movie" | "tv", string] {
  if (isNil(type) && idOrCombined.includes(":")) {
    return parseValidCombinedId(idOrCombined);
  }
  return [type ?? "movie", idOrCombined];
}

/** Filter set accepted by `metadata@v1.discover`. */
export interface DiscoverFilters {
  genres?: string[];
  yearMin?: number;
  yearMax?: number;
  ratingMin?: number;
  limit?: number;
}

export async function search(userId: string, query: string, type?: "movie" | "tv", limit?: number) {
  const result = await dispatchPrimary<Array<{ item: unknown; score?: number }>>({
    userId,
    capability: "metadata",
    version: "v1",
    method: "search",
    input: { query, type, limit },
    mediaType: type,
  });
  return result.data ?? [];
}

export async function trending(userId: string, type?: "movie" | "tv", limit?: number) {
  const result = await dispatchPrimary<unknown[]>({
    userId,
    capability: "metadata",
    version: "v1",
    method: "getTrending",
    input: { type, limit },
    mediaType: type,
  });
  return result.data ?? [];
}

export async function discover(userId: string, filters: DiscoverFilters) {
  const result = await dispatchPrimary<unknown[]>({
    userId,
    capability: "metadata",
    version: "v1",
    method: "discover",
    input: filters,
  });
  return result.data ?? [];
}

export async function getDetails(
  userId: string,
  idOrCombined: string,
  type?: "movie" | "tv",
  opts: { deadlineMs?: number } = {},
) {
  const [parsedType, parsedId] = parseCombinedId(idOrCombined, type);
  const result = await dispatchPrimary<unknown>({
    userId,
    capability: "metadata",
    version: "v1",
    method: "getDetails",
    input: { id: parsedId, type: parsedType },
    mediaType: parsedType,
    deadlineMs: opts.deadlineMs,
  });
  return result.data ?? null;
}

/**
 * Typed `metadata@v1.getDetails` wrapper used by the catalog cold-fill
 * provider and the nightly metadata-refresh job. Returns `null` when no
 * primary plugin is available or the dispatch yields no data — callers
 * fall back to other paths in that case rather than throwing.
 */
export async function getMetadata(
  userId: string,
  tmdbId: string,
  type: "movie" | "tv",
  opts: { deadlineMs?: number } = {},
): Promise<RawCanonicalSource | null> {
  const result = await getMetadataResult(userId, tmdbId, type, opts);
  return result.data ?? null;
}

/**
 * Same dispatch as `getMetadata` but returns the full `AggregateResult` so the
 * caller can inspect `errors`/`attempted` rather than only the data. The
 * nightly metadata-refresh job needs this to tell a genuine upstream removal
 * (`data: null` with no errors) apart from a total provider outage (`data:
 * null` with every provider in `errors`), which would otherwise both collapse
 * to `null` and be miscounted as not-found.
 */
export async function getMetadataResult(
  userId: string,
  tmdbId: string,
  type: "movie" | "tv",
  opts: { deadlineMs?: number } = {},
): Promise<AggregateResult<RawCanonicalSource>> {
  return dispatchPrimary<RawCanonicalSource>({
    userId,
    capability: "metadata",
    version: "v1",
    method: "getDetails",
    input: { id: tmdbId, type },
    mediaType: type,
    deadlineMs: opts.deadlineMs,
  });
}

/**
 * Typed `metadata@v1.getShowSeasons` wrapper used by the home-feed detail
 * composer. Returns `null` when no primary plugin is available, the dispatch
 * yields no data, or the payload is malformed — the orchestrator omits the
 * field rather than failing the detail call so movies and shows w/o season
 * payloads still render the rest of the response.
 */
export async function getShowSeasons(
  userId: string,
  tmdbId: string,
  opts: { deadlineMs?: number } = {},
): Promise<SeasonInfo[] | null> {
  try {
    const result = await dispatchPrimary<{ seasons?: SeasonInfo[] }>({
      userId,
      capability: "metadata",
      version: "v1",
      method: "getShowSeasons",
      input: { id: tmdbId },
      mediaType: "tv",
      deadlineMs: opts.deadlineMs,
    });
    const seasons = result.data?.seasons;
    return Array.isArray(seasons) ? seasons : null;
  } catch {
    return null;
  }
}

export async function getSimilar(userId: string, idOrCombined: string, type?: "movie" | "tv") {
  const [parsedType, parsedId] = parseCombinedId(idOrCombined, type);
  const result = await dispatchPrimary<unknown[]>({
    userId,
    capability: "metadata",
    version: "v1",
    method: "getSimilar",
    input: { id: parsedId, type: parsedType },
    mediaType: parsedType,
  });
  return result.data ?? [];
}
