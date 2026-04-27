import { and, eq, inArray } from "drizzle-orm";
import { capabilityRegistry } from "../../plugin-runtime/registry";
import { getDb } from "../../db/client";
import { serviceConnections } from "../../db/schema/credentials";
import { MediaService } from "../../media/service";
import type { CatalogService } from "../../catalog";
import { registerScheduledPerRow } from "../../jobs/scheduled-per-row";
import type { JobRunContext } from "../../jobs/types";
import type { HistoryEvent, RatingEvent } from "../types";

const PER_ROW_TIMEOUT_SEC = 60;
const RUN_TIMEOUT_SEC = 30 * 60;

export const CATALOG_USER_MIRROR_SYNC_JOB_ID = "host.catalog.user_mirror_sync";

export interface CatalogUserMirrorSyncDeps {
  catalog: CatalogService;
}

interface SyncRow {
  userId: string;
  pluginId: string;
}

/**
 * Registers the every-six-hours catalog mirror sync. One row per
 * `(userId, pluginId)` pair where the plugin contributes either
 * `watchHistory@v1` or `ratings@v1`. History and ratings sync inside
 * separate `try` blocks so a transient plugin failure on one capability
 * does not stall the other; cursor advancement is per-table per V39.
 */
export function registerCatalogUserMirrorSyncJob(deps: CatalogUserMirrorSyncDeps): void {
  registerScheduledPerRow<SyncRow>({
    id: CATALOG_USER_MIRROR_SYNC_JOB_ID,
    name: "Catalog user mirror sync",
    description:
      "Syncs watch history and ratings from connected plugins into the catalog mirror tables.",
    schedule: "0 */6 * * *",
    perRowTimeoutSec: PER_ROW_TIMEOUT_SEC,
    runTimeoutSec: RUN_TIMEOUT_SEC,
    adminTriggerable: true,
    continueOnRowError: true,
    rowSource: () => listSyncRows(),
    handler: (ctx, row) => syncUserPluginPair(deps, ctx, row),
  });
}

export async function syncUserPluginPair(
  deps: CatalogUserMirrorSyncDeps,
  ctx: JobRunContext,
  row: SyncRow,
): Promise<void> {
  const media = new MediaService(row.userId);

  ctx.abortSignal.throwIfAborted();
  try {
    const events = await collectHistoryEvents(media, row.pluginId);
    if (events.length > 0) {
      const cursorTs = events.reduce((max, ev) => Math.max(max, ev.watchedAt), 0);
      await deps.catalog.appendUserHistory(row.userId, events, row.pluginId, cursorTs);
    }
  } catch (err) {
    // Cancellation must propagate; any other failure on this capability
    // logs a warning and lets the ratings block still run so a transient
    // history-plugin error does not block ratings sync.
    if (isAbortError(err, ctx)) throw err;
    ctx.logger.warn(
      `[catalog:user-mirror-sync] history dispatch failed for ${row.userId}/${row.pluginId}: ${formatError(err)}`,
    );
  }

  ctx.abortSignal.throwIfAborted();
  try {
    const events = await collectRatingEvents(media, row.pluginId);
    if (events.length > 0) {
      const cursorTs = events.reduce((max, ev) => Math.max(max, ev.ratedAt), 0);
      await deps.catalog.appendUserRatings(row.userId, events, row.pluginId, cursorTs);
    }
  } catch (err) {
    if (isAbortError(err, ctx)) throw err;
    ctx.logger.warn(
      `[catalog:user-mirror-sync] ratings dispatch failed for ${row.userId}/${row.pluginId}: ${formatError(err)}`,
    );
  }
}

function isAbortError(err: unknown, ctx: JobRunContext): boolean {
  if (ctx.abortSignal.aborted) return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

async function collectHistoryEvents(
  media: MediaService,
  pluginId: string,
): Promise<HistoryEvent[]> {
  const raw = (await media.getAllHistory(pluginId)) as Array<{
    item?: { ids?: { tmdb_id?: string }; id?: string; type?: "movie" | "tv" };
    watchedAt?: string;
    progress?: number | null;
    episodeKey?: string | null;
  }>;
  return raw.flatMap((entry) => toHistoryEvent(entry, pluginId));
}

async function collectRatingEvents(media: MediaService, pluginId: string): Promise<RatingEvent[]> {
  const raw = (await media.getAllRatings(pluginId)) as Array<{
    item?: { ids?: { tmdb_id?: string }; id?: string; type?: "movie" | "tv" };
    rating?: number;
    ratedAt?: string;
  }>;
  return raw.flatMap((entry) => toRatingEvent(entry, pluginId));
}

function toHistoryEvent(
  entry: {
    item?: { ids?: { tmdb_id?: string }; id?: string; type?: "movie" | "tv" };
    watchedAt?: string;
    progress?: number | null;
    episodeKey?: string | null;
  },
  pluginId: string,
): HistoryEvent[] {
  const identity = identify(entry.item);
  if (!identity) return [];
  const watchedAt = parseDate(entry.watchedAt);
  if (watchedAt === null) return [];
  return [
    {
      tmdbId: identity.tmdbId,
      mediaType: identity.type,
      watchedAt,
      sourceConnectionId: pluginId,
      episodeKey: entry.episodeKey ?? null,
      progress: typeof entry.progress === "number" ? entry.progress : null,
    },
  ];
}

function toRatingEvent(
  entry: {
    item?: { ids?: { tmdb_id?: string }; id?: string; type?: "movie" | "tv" };
    rating?: number;
    ratedAt?: string;
  },
  pluginId: string,
): RatingEvent[] {
  const identity = identify(entry.item);
  if (!identity || typeof entry.rating !== "number") return [];
  // The dedupe key includes `ratedAt`; falling back to `Date.now()` would
  // mint a fresh key every sync run and let the same plugin entry land
  // repeatedly. Drop malformed events instead, mirroring the history path.
  const ratedAt = parseDate(entry.ratedAt);
  if (ratedAt === null) return [];
  return [
    {
      tmdbId: identity.tmdbId,
      mediaType: identity.type,
      rating: entry.rating,
      ratedAt,
      sourceConnectionId: pluginId,
    },
  ];
}

function identify(
  item: { ids?: { tmdb_id?: string }; id?: string; type?: "movie" | "tv" } | undefined,
): { tmdbId: string; type: "movie" | "tv" } | null {
  if (!item) return null;
  const tmdbId = item.ids?.tmdb_id ?? splitId(item.id)?.id;
  const type = item.type ?? splitId(item.id)?.type;
  if (!tmdbId || (type !== "movie" && type !== "tv")) return null;
  return { tmdbId, type };
}

function splitId(combined: string | undefined): { type: "movie" | "tv"; id: string } | null {
  if (!combined) return null;
  const [type, id] = combined.split(":");
  if ((type !== "movie" && type !== "tv") || !id) return null;
  return { type, id };
}

function parseDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : null;
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Row source: every active service connection whose plugin contributes
 * either `watchHistory@v1` or `ratings@v1`. Disabled or pending-auth
 * connections are skipped — the sync only runs against credentials that
 * the dispatcher would itself accept.
 */
async function listSyncRows(): Promise<SyncRow[]> {
  const historyProviders = capabilityRegistry.listProviders("watchHistory", "v1", "user");
  const ratingsProviders = capabilityRegistry.listProviders("ratings", "v1", "user");
  const wantedPluginIds = Array.from(new Set([...historyProviders, ...ratingsProviders]));
  if (wantedPluginIds.length === 0) return [];

  const db = getDb();
  const rows = await db
    .selectDistinct({ userId: serviceConnections.userId, pluginId: serviceConnections.pluginId })
    .from(serviceConnections)
    .where(
      and(
        eq(serviceConnections.enabled, 1),
        eq(serviceConnections.status, "connected"),
        inArray(serviceConnections.pluginId, wantedPluginIds),
      ),
    );
  return rows.map((row) => ({ userId: row.userId, pluginId: row.pluginId }));
}
