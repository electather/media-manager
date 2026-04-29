import { compact } from "es-toolkit/array";
import { zodToItemSchema } from "@ent-mcp/shared/common";
import { dispatchAggregate, dispatchPrimary } from "../../media/dispatcher";
import { capabilityRegistry } from "../../plugin-runtime/registry";
import {
  compactList,
  compactMediaResultSchema,
  type AvailabilityStatus,
  type CompactMediaResult,
} from "../response-shapes";
import { badInput, notConnected } from "../errors";
import type { ToolCallContext, ToolHandler, ToolRegistration } from "../registry";
import { formatMediaId } from "../media-id";
import { getPreferenceEngine } from "../../preferences";
import type { MediaItem } from "@ent-mcp/shared/media";

type DiscoverMode = "search" | "recommend" | "similar" | "trending" | "discover";

interface EntDiscoverInput {
  mode: DiscoverMode;
  query?: string;
  media_type?: "movie" | "tv" | "any";
  genres?: string;
  year_min?: number;
  year_max?: number;
  rating_min?: number;
  limit?: number;
}

interface DiscoverResponse {
  results: CompactMediaResult[];
  total: number;
  has_more: boolean;
}

interface StatusEntry {
  status?: AvailabilityStatus;
  tmdbId?: string;
  type?: "movie" | "tv";
}

interface RatingEntry {
  item?: { id?: string; ids?: { tmdb_id?: string } };
  rating?: number;
}

function resolveMediaType(raw: EntDiscoverInput["media_type"]): "movie" | "tv" | undefined {
  if (!raw || raw === "any") return undefined;
  return raw;
}

function parseGenres(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length ? items : undefined;
}

async function buildAvailabilityMap(
  userId: string,
  items: CompactMediaResult[],
): Promise<Map<string, AvailabilityStatus>> {
  const providers = capabilityRegistry.listProviders("mediaRequest", "v1", "user");
  if (providers.length === 0 || items.length === 0) return new Map();
  const map = new Map<string, AvailabilityStatus>();
  const pairs = compact(
    items.map((item) => {
      const [type, tmdbId] = item.id.split(":");
      if (!type || !tmdbId) return null;
      return { id: item.id, tmdbId, type: type as "movie" | "tv" };
    }),
  );

  await Promise.all(
    pairs.map(async (pair) => {
      try {
        const result = await dispatchAggregate<StatusEntry[]>({
          userId,
          capability: "mediaRequest",
          version: "v1",
          method: "checkAvailability",
          input: { tmdbId: pair.tmdbId, type: pair.type },
        });
        const first = (result.data ?? []).find((row) => row && row.status);
        if (first?.status) map.set(pair.id, first.status);
      } catch {
        // Availability is best-effort; ignore per-item failures.
      }
    }),
  );
  return map;
}

// fallow-ignore-next-line complexity
async function buildUserRatingMap(
  userId: string,
  type: "movie" | "tv" | undefined,
): Promise<Map<string, number>> {
  const providers = capabilityRegistry.listProviders("ratings", "v1", "user");
  if (providers.length === 0) return new Map();
  try {
    const result = await dispatchAggregate<RatingEntry[]>({
      userId,
      capability: "ratings",
      version: "v1",
      method: "getRatings",
      input: type ? { type } : {},
    });
    const map = new Map<string, number>();
    for (const row of result.data ?? []) {
      if (typeof row.rating !== "number") continue;
      const id = row.item?.id;
      if (id) map.set(id, row.rating);
    }
    return map;
  } catch {
    return new Map();
  }
}

function decorateResults(
  results: CompactMediaResult[],
  availability: Map<string, AvailabilityStatus>,
  userRatings: Map<string, number>,
): CompactMediaResult[] {
  return results.map((item) => {
    const out: CompactMediaResult = { ...item };
    const status = availability.get(item.id);
    if (status && status !== "unknown") out.status = status;
    const rated = userRatings.get(item.id);
    if (typeof rated === "number" && rated > 0) out.user_rated = rated;
    return out;
  });
}

async function runSearch(userId: string, input: EntDiscoverInput): Promise<CompactMediaResult[]> {
  if (!input.query) throw badInput("ent_discover", "query is required when mode=search");
  const type = resolveMediaType(input.media_type);
  const result = await dispatchPrimary<Array<{ item: unknown; score?: number }>>({
    userId,
    capability: "metadata",
    version: "v1",
    method: "search",
    input: { query: input.query, type, limit: input.limit ?? 10 },
    mediaType: type,
  });
  if (!result.data) throw notConnected("metadata@v1");
  return compactList(result.data, () => ({}), input.limit);
}

async function runTrending(userId: string, input: EntDiscoverInput): Promise<CompactMediaResult[]> {
  const type = resolveMediaType(input.media_type);
  const result = await dispatchAggregate<unknown[]>({
    userId,
    capability: "recommendations",
    version: "v1",
    method: "getTrending",
    input: { type, limit: input.limit ?? 10 },
  });
  return compactList(result.data ?? [], () => ({}), input.limit);
}

const RECOMMEND_OVERFETCH_MULTIPLIER = 3;

// fallow-ignore-next-line complexity
async function runRecommend(
  userId: string,
  input: EntDiscoverInput,
): Promise<CompactMediaResult[]> {
  const type = resolveMediaType(input.media_type);
  const limit = input.limit ?? 10;
  const result = await dispatchAggregate<unknown[]>({
    userId,
    capability: "recommendations",
    version: "v1",
    method: "getRecommendations",
    input: { type, limit: limit * RECOMMEND_OVERFETCH_MULTIPLIER },
  });
  if ((result.data ?? []).length === 0 && result.errors.length > 0) {
    // Providers returned errors and no data — the caller has nothing connected
    // productively.
    throw notConnected("recommendations@v1");
  }
  const candidates = compactList(result.data ?? [], () => ({}));
  return rerankCompactResults(userId, candidates, type, limit);
}

/**
 * Re-ranks the upstream candidate list through the preference engine. On
 * first-run users (no profile) the ordering is preserved and no match reasons
 * are attached — same shape as the pre-engine response.
 */
async function rerankCompactResults(
  userId: string,
  candidates: CompactMediaResult[],
  mediaType: "movie" | "tv" | undefined,
  limit: number,
): Promise<CompactMediaResult[]> {
  if (candidates.length === 0) return [];
  const engine = getPreferenceEngine();
  const items = candidates.map(compactToMediaItem);
  const ranked = await engine.rankCandidates(userId, items, {
    mediaType: mediaType ?? "any",
  });
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const ordered = ranked.map(
    (entry) => byId.get(entry.item.id) ?? compactFromMediaItem(entry.item),
  );
  const top = ordered.slice(0, limit);
  return Promise.all(
    top.map(async (item, index) => {
      const rankedEntry = ranked[index];
      if (!rankedEntry || rankedEntry.confidence === "low") return item;
      const reason = engine.renderMatchReason(rankedEntry);
      return reason ? { ...item, match_reason: reason } : item;
    }),
  );
}

// fallow-ignore-next-line complexity
function compactToMediaItem(compact: CompactMediaResult): MediaItem {
  return {
    id: compact.id,
    title: compact.title,
    year: compact.year ?? 0,
    type: compact.type,
    genres: compact.genres ?? [],
    rating: typeof compact.rating === "number" ? compact.rating : null,
    overview: compact.overview ?? "",
    posterUrl: compact.poster ?? null,
    status: compact.status ?? "unknown",
    userRating: typeof compact.user_rated === "number" ? compact.user_rated : null,
    matchReason: compact.match_reason ?? null,
  };
}

// fallow-ignore-next-line complexity
function compactFromMediaItem(item: MediaItem): CompactMediaResult {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    ...(item.year ? { year: item.year } : {}),
    ...(item.genres.length > 0 ? { genres: item.genres } : {}),
    ...(typeof item.rating === "number" ? { rating: Math.round(item.rating * 10) / 10 } : {}),
    ...(item.overview ? { overview: item.overview } : {}),
    ...(item.posterUrl ? { poster: item.posterUrl } : {}),
  };
}

// fallow-ignore-next-line complexity
async function resolveQueryToKey(
  userId: string,
  query: string,
  type: "movie" | "tv" | undefined,
): Promise<{ tmdbId: string; resolvedType: "movie" | "tv" }> {
  const colonIdx = query.indexOf(":");
  if (colonIdx !== -1) {
    const t = query.slice(0, colonIdx);
    const id = query.slice(colonIdx + 1);
    if ((t === "movie" || t === "tv") && id) return { tmdbId: id, resolvedType: t };
  }
  if (/^[0-9]+$/.test(query)) return { tmdbId: query, resolvedType: type ?? "movie" };
  const searchResult = await dispatchPrimary<Array<{ item: { id: string; type: "movie" | "tv" } }>>(
    {
      userId,
      capability: "metadata",
      version: "v1",
      method: "search",
      input: { query, type, limit: 1 },
      mediaType: type,
    },
  );
  const first = (searchResult.data ?? [])[0]?.item;
  if (!first) throw badInput("ent_discover", `no title matched "${query}"`);
  return { tmdbId: first.id, resolvedType: first.type };
}

async function runSimilar(userId: string, input: EntDiscoverInput): Promise<CompactMediaResult[]> {
  if (!input.query) throw badInput("ent_discover", "query is required when mode=similar");
  const type = resolveMediaType(input.media_type);
  const { tmdbId, resolvedType } = await resolveQueryToKey(userId, input.query, type);
  const result = await dispatchPrimary<unknown[]>({
    userId,
    capability: "metadata",
    version: "v1",
    method: "getSimilar",
    input: { id: tmdbId, type: resolvedType },
    mediaType: resolvedType,
  });
  if (!result.data) throw notConnected("metadata@v1");
  const similar = compactList(result.data, () => ({}), input.limit);
  return similar.map((item) => ({ ...item, id: item.id || formatMediaId(resolvedType, tmdbId) }));
}

// fallow-ignore-next-line complexity
async function runDiscover(userId: string, input: EntDiscoverInput): Promise<CompactMediaResult[]> {
  const genres = parseGenres(input.genres);
  const result = await dispatchPrimary<unknown[]>({
    userId,
    capability: "metadata",
    version: "v1",
    method: "discover",
    input: {
      ...(genres ? { genres } : {}),
      ...(typeof input.year_min === "number" ? { yearMin: input.year_min } : {}),
      ...(typeof input.year_max === "number" ? { yearMax: input.year_max } : {}),
      ...(typeof input.rating_min === "number" ? { ratingMin: input.rating_min } : {}),
      limit: input.limit ?? 10,
    },
  });
  if (!result.data) throw notConnected("metadata@v1");
  return compactList(result.data, () => ({}), input.limit);
}

// fallow-ignore-next-line complexity
async function runMode(
  ctx: ToolCallContext,
  input: EntDiscoverInput,
): Promise<CompactMediaResult[]> {
  switch (input.mode) {
    case "search":
      return runSearch(ctx.userId, input);
    case "trending":
      return runTrending(ctx.userId, input);
    case "recommend":
      return runRecommend(ctx.userId, input);
    case "similar":
      return runSimilar(ctx.userId, input);
    case "discover":
      return runDiscover(ctx.userId, input);
    default: {
      throw badInput("ent_discover", `unknown mode ${String(input.mode)}`);
    }
  }
}

export const entDiscoverHandler: ToolHandler = async (ctx, rawInput) => {
  const input = rawInput as EntDiscoverInput;
  const results = await runMode(ctx, input);
  const limit = input.limit ?? 10;
  const mediaType = resolveMediaType(input.media_type);
  const [availability, userRatings] = await Promise.all([
    buildAvailabilityMap(ctx.userId, results),
    buildUserRatingMap(ctx.userId, mediaType),
  ]);
  const decorated = decorateResults(results, availability, userRatings);
  const response: DiscoverResponse = {
    results: decorated.slice(0, limit),
    total: decorated.length,
    has_more: decorated.length > limit,
  };
  return response;
};

export const entDiscoverRegistration: Omit<ToolRegistration, "source"> & { id: string } = {
  id: "ent_discover",
  name: "ent_discover",
  description:
    "Search, browse, or get personalized recommendations for movies and TV. mode=search for text search, recommend for personalized picks, similar for items like a specific title, trending for popular now, discover for filtered browse.",
  inputSchema: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["search", "recommend", "similar", "trending", "discover"] },
      query: {
        type: "string",
        description: "Search text for search mode, or a title/id for similar mode",
      },
      media_type: { type: "string", enum: ["movie", "tv", "any"], default: "any" },
      genres: { type: "string", description: "Comma-separated genre names" },
      year_min: { type: "integer" },
      year_max: { type: "integer" },
      rating_min: { type: "number" },
      limit: { type: "integer", default: 10, maximum: 25 },
    },
    required: ["mode"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: zodToItemSchema(compactMediaResultSchema),
      },
      total: { type: "integer" },
      has_more: { type: "boolean" },
    },
    required: ["results", "total", "has_more"],
    additionalProperties: false,
  },
  requiredScopes: ["mcp.read"],
  annotations: { readOnlyHint: true },
  handler: entDiscoverHandler,
};
