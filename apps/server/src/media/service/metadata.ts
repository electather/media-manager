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

// Validates "movie:<id>" or "tv:<id>" only; rejects malformed shapes like
// "movie:tt1:extra", "show:550", or "movie:" to avoid propagating invalid ids
// into the plugin dispatch layer.
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

// Wrapper for catalog cold-fill and metadata-refresh; returns null on no-plugin
// or no-data (callers fall back rather than throw).
export async function getMetadata(
  userId: string,
  tmdbId: string,
  type: "movie" | "tv",
  opts: { deadlineMs?: number } = {},
): Promise<RawCanonicalSource | null> {
  const result = await getMetadataResult(userId, tmdbId, type, opts);
  return result.data ?? null;
}

// Returns full AggregateResult so metadata-refresh can distinguish genuine
// upstream removal (null, no errors) from provider outage (null, all errors).
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

// Home-feed detail wrapper; returns null on no-plugin, no-data, or malformed
// payload so orchestrator omits field rather than failing the whole detail call.
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
