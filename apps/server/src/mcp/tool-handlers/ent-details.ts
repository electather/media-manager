import { dispatchPrimary, dispatchAggregate } from "../../media/dispatcher";
import { capabilityRegistry } from "../../plugin-runtime/registry";
import { getPreferenceEngine } from "../../preferences";
import type { ToolCallContext, ToolHandler } from "../registry";
import { compactMediaItem, truncate } from "../response-shapes";
import { parseMediaId } from "../media-id";
import { notConnected } from "../errors";

interface EntDetailsInput {
  id: string;
}

interface DetailsResponse {
  id: string;
  title: string;
  year?: number;
  genres?: string[];
  overview?: string;
  poster?: string;
  type: "movie" | "tv";
  ratings?: Record<string, number>;
  status?: "available" | "requested" | "processing" | "unavailable" | "unknown";
  user_rated?: number;
  cast?: string[];
  keywords?: string[];
  runtime?: number;
  director?: string;
  streaming?: string[];
  trailer?: string;
  watch_progress?: Record<string, unknown> | null;
}

interface RatingEntry {
  item: { id: string; ids?: Record<string, string | undefined> };
  rating: number;
}

async function readOwnFeedback(
  userId: string,
  tmdbId: string,
  mediaType: "movie" | "tv",
): Promise<{ rating: number | null; liked?: boolean; noted?: boolean }> {
  const own = await getPreferenceEngine().getUserFeedbackFor(userId, tmdbId, mediaType);
  if (!own) return { rating: null };
  const out: { rating: number | null; liked?: boolean; noted?: boolean } = {
    rating: typeof own.rated === "number" ? own.rated : null,
  };
  if (own.liked !== undefined) out.liked = own.liked;
  if (own.noted) out.noted = true;
  return out;
}

async function readAvailability(
  userId: string,
  tmdbId: string,
  type: "movie" | "tv",
): Promise<DetailsResponse["status"] | undefined> {
  const providers = capabilityRegistry.listProviders("mediaRequest", "v1", "user");
  if (providers.length === 0) return undefined;
  try {
    const result = await dispatchAggregate<Array<{ status?: DetailsResponse["status"] }>>({
      userId,
      capability: "mediaRequest",
      version: "v1",
      method: "checkAvailability",
      input: { tmdbId, type },
    });
    const first = (result.data ?? []).find((row) => row && row.status);
    return first?.status;
  } catch {
    return undefined;
  }
}

type MetadataShape = {
  title?: string;
  year?: number | null;
  genres?: string[];
  overview?: string;
  posterUrl?: string | null;
  rating?: number | null;
  runtime?: number;
  director?: string;
  cast?: string[];
  keywords?: string[];
  trailerUrl?: string;
  streamingOn?: string[];
  ids?: Record<string, string | undefined>;
};

type OwnFeedback = { rating: number | null; liked?: boolean; noted?: boolean };

// fallow-ignore-next-line complexity
function applyExtendedMetadata(
  out: DetailsResponse,
  metadata: MetadataShape,
  ownFeedback: OwnFeedback,
  type: "movie" | "tv",
): void {
  if (typeof ownFeedback.rating === "number" && ownFeedback.rating > 0)
    out.user_rated = ownFeedback.rating;
  if (typeof metadata.runtime === "number") out.runtime = metadata.runtime;
  if (typeof metadata.director === "string") out.director = metadata.director;
  if (Array.isArray(metadata.cast)) out.cast = truncate(metadata.cast, 3);
  if (Array.isArray(metadata.keywords)) out.keywords = truncate(metadata.keywords, 8);
  if (typeof metadata.trailerUrl === "string") out.trailer = metadata.trailerUrl;
  if (Array.isArray(metadata.streamingOn) && metadata.streamingOn.length > 0)
    out.streaming = metadata.streamingOn;
  if (type === "tv") out.watch_progress = null;
}

// fallow-ignore-next-line complexity
async function readAggregatedRatings(
  userId: string,
  tmdbId: string,
  type: "movie" | "tv",
): Promise<Record<string, number>> {
  const providers = capabilityRegistry.listProviders("ratings", "v1", "user");
  if (providers.length === 0) return {};
  try {
    const result = await dispatchAggregate<RatingEntry[]>({
      userId,
      capability: "ratings",
      version: "v1",
      method: "getRatings",
      input: { type },
    });
    const out: Record<string, number> = {};
    for (const row of result.data ?? []) {
      const byExternalId = row.item?.ids?.tmdb_id === tmdbId;
      const byCompositeId = row.item.id === `${type}:${tmdbId}`;
      if ((byExternalId || byCompositeId) && typeof row.rating === "number") {
        // Mark with a generic key — we don't know which plugin wrote this under
        // aggregate. The design doc's per-plugin ratings key requires a helper
        // that tracks outcome-by-plugin; v1 surfaces the most-recent value.
        out.user = row.rating;
      }
    }
    return out;
  } catch {
    return {};
  }
}

// fallow-ignore-next-line complexity
export const entDetailsHandler: ToolHandler = async (ctx: ToolCallContext, input) => {
  const parsed = parseMediaId((input as EntDetailsInput).id);

  const metadataResult = await dispatchPrimary<Record<string, unknown>>({
    userId: ctx.userId,
    capability: "metadata",
    version: "v1",
    method: "getDetails",
    input: { id: parsed.tmdbId, type: parsed.type },
    mediaType: parsed.type,
  });
  if (!metadataResult.data) {
    throw notConnected("metadata@v1");
  }

  const metadata = metadataResult.data as MetadataShape;

  const [availability, aggregatedRatings, ownFeedback] = await Promise.all([
    readAvailability(ctx.userId, parsed.tmdbId, parsed.type),
    readAggregatedRatings(ctx.userId, parsed.tmdbId, parsed.type),
    readOwnFeedback(ctx.userId, parsed.tmdbId, parsed.type),
  ]);

  const compact = compactMediaItem(metadata, {
    status: availability,
    userRated: ownFeedback.rating,
  });

  const ratings: Record<string, number> = { ...aggregatedRatings };
  if (typeof metadata.rating === "number") ratings.tmdb = Math.round(metadata.rating * 10) / 10;
  if (ownFeedback.rating !== null) ratings.user = ownFeedback.rating;

  const out: DetailsResponse = {
    id: compact.id,
    title: compact.title,
    type: compact.type,
  };
  if (compact.year !== undefined) out.year = compact.year;
  if (compact.genres) out.genres = compact.genres;
  if (compact.overview) out.overview = compact.overview;
  if (compact.poster) out.poster = compact.poster;
  if (availability) out.status = availability;
  if (Object.keys(ratings).length > 0) out.ratings = ratings;
  applyExtendedMetadata(out, metadata, ownFeedback, parsed.type);
  return out;
};
