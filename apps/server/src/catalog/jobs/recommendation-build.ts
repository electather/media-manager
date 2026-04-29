import type { ProfileMediaType } from "@ent-mcp/shared/preferences";
import { listUsersNeedingRebuild, type RebuildRow } from "../../preferences/rebuild-row-source";
import { getPreferenceEngine } from "../../preferences";
import { profileStorage } from "../../preferences/storage";
import { MediaService } from "../../media/service";
import type { CatalogService } from "../../catalog";
import { registerScheduledPerRow } from "../../jobs/scheduled-per-row";
import type { JobRunContext } from "../../jobs/types";
import type { RecItem } from "../types";

const TOP_N = 60;
const CANDIDATE_LIMIT = 180;
const PER_ROW_TIMEOUT_SEC = 120;
const RUN_TIMEOUT_SEC = 90 * 60;
const PER_ROW_DEADLINE_SEC = 60;
const PARTITIONS: ProfileMediaType[] = ["movie", "tv", "combined"];

export const CATALOG_RECOMMENDATION_BUILD_JOB_ID = "host.catalog.recommendation_build";

export interface CatalogRecommendationBuildDeps {
  catalog: CatalogService;
}

/**
 * Registers the nightly per-user recommendation builder. Drives the same
 * row source as the existing `host.preference.daily_rebuild` so users
 * needing a fresh profile also get a fresh rec list. Each user: rebuild
 * the three profile partitions, rank a candidate set against the combined
 * profile, persist the top-N onto `recommendation_lists`. Runs at 02:00,
 * before the metadata-refresh and discover-snapshot jobs at 04:00 / 06:00
 * so each can rely on a coherent profile/version coordinate.
 */
export function registerCatalogRecommendationBuildJob(deps: CatalogRecommendationBuildDeps): void {
  registerScheduledPerRow<RebuildRow>({
    id: CATALOG_RECOMMENDATION_BUILD_JOB_ID,
    name: "Catalog recommendation build",
    description: "Rebuilds preference profiles and persists per-user recommendation lists.",
    schedule: "0 2 * * *",
    perRowTimeoutSec: PER_ROW_TIMEOUT_SEC,
    runTimeoutSec: RUN_TIMEOUT_SEC,
    adminTriggerable: true,
    continueOnRowError: true,
    rowSource: () => listUsersNeedingRebuild(),
    handler: (ctx, row) => buildRecommendationsForUser(deps, ctx, row.userId),
  });
}

/**
 * Per-row body for the nightly job: rebuild the three profile partitions
 * and persist a fresh rec list.
 */
async function buildRecommendationsForUser(
  deps: CatalogRecommendationBuildDeps,
  ctx: JobRunContext,
  userId: string,
): Promise<void> {
  const engine = getPreferenceEngine();
  for (const partition of PARTITIONS) {
    ctx.abortSignal.throwIfAborted();
    await engine.rebuildProfile(userId, partition, ctx.abortSignal);
  }
  await writeRecommendationsForUser(
    deps,
    userId,
    ctx.abortSignal,
    ctx.logger.info.bind(ctx.logger),
  );
}

/**
 * Rec-list-only entry point. Assumes the profile partitions are already
 * current — used by `feature.preference.rebuild`'s manual handler, which
 * runs the rebuild loop itself and would double-bump `profile_version`
 * if it called `buildRecommendationsForUser` directly.
 */
// fallow-ignore-next-line complexity
export async function writeRecommendationsForUser(
  deps: CatalogRecommendationBuildDeps,
  userId: string,
  abortSignal: AbortSignal,
  log: (msg: string) => void = () => {},
): Promise<void> {
  const engine = getPreferenceEngine();
  abortSignal.throwIfAborted();
  // Capture the profile version *before* ranking so a concurrent rebuild
  // (manual `feature.preference.rebuild` or a future webhook ingestion)
  // cannot bump the version mid-flight and leave the rec list referencing
  // a profile state it was not actually ranked against. The rec list now
  // pins the exact version that drove the ranking.
  const profile = await profileStorage.read(userId, "combined");
  const profileVersion = profile?.version ?? 0;

  const media = new MediaService(userId);
  const candidates = await media.getRecommendationsFeed({ limit: CANDIDATE_LIMIT });
  // The dispatcher does not consume an abort signal yet; the wall-clock
  // `perRowTimeoutSec` cap guards runaway plugin calls. Re-checking here
  // shortens the window where a cancelled job still does post-fetch work.
  abortSignal.throwIfAborted();
  const candidateItems = candidates.items as Array<{
    id?: string;
    type?: "movie" | "tv";
    title?: string;
    ids?: { tmdb_id?: string };
    year?: number | null;
    overview?: string;
    posterUrl?: string | null;
    rating?: number | null;
  }>;
  if (candidateItems.length === 0) return;

  const adapted = candidateItems
    .map((item) => adaptCandidate(item))
    .filter((item): item is NonNullable<ReturnType<typeof adaptCandidate>> => item !== null);
  if (adapted.length === 0) return;

  const deadlineMs = Date.now() + PER_ROW_DEADLINE_SEC * 1000;
  const ranked = await engine.rankCandidates(userId, adapted, { deadlineMs });
  abortSignal.throwIfAborted();
  const topN = ranked.slice(0, TOP_N);
  if (topN.length === 0) return;

  const recItems: RecItem[] = await Promise.all(
    topN.map(async (entry) => {
      const reason = await engine.explainRanked(userId, entry).catch(() => null);
      return {
        tmdbId: extractTmdbId(entry.item.id) ?? "",
        mediaType: entry.item.type,
        matchReason: reason,
        score: entry.score,
      };
    }),
  );
  const validItems = recItems.filter((entry) => entry.tmdbId.length > 0);
  if (validItems.length === 0) return;

  abortSignal.throwIfAborted();
  await deps.catalog.writeRecommendationList(userId, "default", validItems, profileVersion);
  log(
    `[catalog:recommendation-build] user=${userId} wrote ${validItems.length} recs (pv=${profileVersion})`,
  );
}

type RawCandidate = {
  id?: string;
  type?: "movie" | "tv";
  title?: string;
  ids?: { tmdb_id?: string };
  year?: number | null;
  overview?: string;
  posterUrl?: string | null;
  rating?: number | null;
};

// fallow-ignore-next-line complexity
function parseIdentity(item: RawCandidate): { id: string; type: "movie" | "tv" } | null {
  const tmdbId = item.ids?.tmdb_id ?? extractTmdbId(item.id);
  const type = item.type ?? extractType(item.id);
  if (!tmdbId || (type !== "movie" && type !== "tv")) return null;
  return { id: `${type}:${tmdbId}`, type };
}

// fallow-ignore-next-line complexity
function adaptCandidate(item: RawCandidate): {
  id: string;
  title: string;
  year: number;
  type: "movie" | "tv";
  genres: string[];
  rating: number | null;
  overview: string;
  posterUrl: string | null;
  status: "unknown";
  userRating: null;
  matchReason: null;
} | null {
  const identity = parseIdentity(item);
  if (!identity) return null;
  return {
    id: identity.id,
    title: item.title ?? identity.id,
    year: typeof item.year === "number" ? item.year : 0,
    type: identity.type,
    genres: [],
    rating: item.rating ?? null,
    overview: item.overview ?? "",
    posterUrl: item.posterUrl ?? null,
    status: "unknown",
    userRating: null,
    matchReason: null,
  };
}

function extractTmdbId(combined: string | undefined): string | undefined {
  if (!combined) return undefined;
  const [, id] = combined.split(":");
  return id || undefined;
}

function extractType(combined: string | undefined): "movie" | "tv" | undefined {
  if (!combined) return undefined;
  const [type] = combined.split(":");
  return type === "movie" || type === "tv" ? type : undefined;
}
