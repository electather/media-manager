import type { MediaDetailsExtra, MediaDetailsResponse } from "@nama/shared/home";
import type { MediaType } from "@nama/shared/media";
import { toCanonicalRow, type RawCanonicalSource } from "../../catalog";
import { HttpError } from "../../diagnostics/http-errors";
import { classifyError } from "./classify-error";
import { fromCanonicalMetadata } from "./adapters";
import { enrichHomeItems } from "./media-enrichment";
import type { RowContext } from "./types";

/**
 * Builds the detail payload from catalog metadata, live plugin details, and
 * the same media-owned enrichment surface used by home rows.
 */
// fallow-ignore-next-line complexity
export async function composeDetailsResponse(
  ctx: RowContext,
  tmdbId: string,
  mediaType: MediaType,
): Promise<MediaDetailsResponse> {
  const deadlineOpts = { deadlineMs: ctx.deadlineMs };
  let summary = await ctx.catalog.getMetadata(tmdbId, mediaType);
  if (!summary) {
    // On a cache miss this fetches live metadata for `tmdbId` and persists it,
    // so an unbounded `tmdbId` lets any caller force the server to fetch and
    // write a canonical row for an arbitrary id. Bound it to a numeric tmdb id
    // before the live fetch so the write-on-read path cannot be driven by
    // opaque input. The adapter route validates the same shape, but the guard
    // lives here too so the composer is safe regardless of caller.
    if (!/^\d+$/u.test(tmdbId)) {
      throw new HttpError(400, "home.bad_input", `invalid tmdbId: ${tmdbId}`);
    }
    const raw = (await ctx.mediaService.getMetadata(
      tmdbId,
      mediaType,
      deadlineOpts,
    )) as RawCanonicalSource | null;
    if (!raw) throw new HttpError(404, "http.not_found", `media not found: ${mediaType}:${tmdbId}`);
    await ctx.catalog.writeMetadata([toCanonicalRow({ tmdbId, type: mediaType }, raw)]);
    summary = await ctx.catalog.getMetadata(tmdbId, mediaType);
    if (!summary) throw new HttpError(500, "home.internal", "catalog write failed");
  }

  const summaryInternal = fromCanonicalMetadata(summary);
  const [detailsSettled, enrichedSummary, seasonsResult] = await Promise.all([
    ctx.mediaService.getDetails(tmdbId, mediaType, deadlineOpts).then(
      (data) => ({ ok: true as const, data }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
    enrichHomeItems([summaryInternal], ctx, { rowId: "details" }),
    mediaType === "tv"
      ? ctx.mediaService.getShowSeasons(tmdbId, deadlineOpts)
      : Promise.resolve(null),
  ]);
  const [summaryItem] = enrichedSummary.items;
  if (!summaryItem) throw new HttpError(500, "home.internal", "summary enrichment failed");
  if (!detailsSettled.ok) {
    return {
      summary: summaryItem,
      details: null,
      error: { code: classifyError(detailsSettled.err) },
    };
  }
  const details = toMediaDetailsExtra(detailsSettled.data);
  if (seasonsResult && seasonsResult.length > 0) details.seasons = seasonsResult;
  return { summary: summaryItem, details };
}

/**
 * Permissive shape narrowing for provider-specific detail payloads. Each
 * branch is null-tolerant so partial plugin responses do not block the row.
 */
// fallow-ignore-next-line complexity
function toMediaDetailsExtra(data: unknown): MediaDetailsExtra {
  const value = (data ?? {}) as Record<string, unknown>;
  const out: MediaDetailsExtra = {
    cast: Array.isArray(value.cast)
      ? (value.cast as unknown[]).map((castMember) => String(castMember)).slice(0, 12)
      : [],
  };
  const director = pickString(value.director);
  if (director) out.director = director;
  const ageRating = pickString(value.ageRating ?? value.contentRating ?? value.certification);
  if (ageRating) out.ageRating = ageRating;
  const audienceScore = pickNumber(value.audienceScore);
  if (audienceScore != null) out.audienceScore = audienceScore;
  const criticScore = pickNumber(value.criticScore);
  if (criticScore != null) out.criticScore = criticScore;
  const votes = pickNumber(value.votes);
  if (votes != null) out.votes = votes;
  const trailerUrl = pickString(value.trailerUrl);
  if (trailerUrl) out.trailerUrl = trailerUrl;
  const nextAirDate = pickString(value.nextAirDate);
  if (nextAirDate) out.nextAirDate = nextAirDate;
  const seriesStatus = pickString(value.seriesStatus);
  if (seriesStatus === "ongoing" || seriesStatus === "finished") out.seriesStatus = seriesStatus;
  const runtime = pickString(value.runtime);
  if (runtime) out.runtime = runtime;
  return out;
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pickNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
