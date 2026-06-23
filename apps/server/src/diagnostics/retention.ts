import { eq, lt, max, notInArray, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { appConfig, errorRecords, perfRecords, sourcemaps } from "../db/schema/infra/diagnostics";

const APP_CONFIG_ID = "global";

const DEFAULT_ERROR_RETENTION_DAYS = 30;
const MIN_ERROR_RETENTION_DAYS = 7;
const MAX_ERROR_RETENTION_DAYS = 365;

const DEFAULT_PERF_RETENTION_DAYS = 7;
const MIN_PERF_RETENTION_DAYS = 1;
const MAX_PERF_RETENTION_DAYS = 90;

/** Keep maps for the 50 most recently active builds. Bounds the `sourcemaps`
 *  table by build count rather than age, so a long-lived deploy never loses its
 *  maps just because it shipped a while ago — only superseded builds age out. */
const SOURCEMAP_RETAINED_BUILDS = 50;

export interface AppConfigRow {
  errorRetentionDays: number;
  perfRetentionDays: number;
}

export interface NotificationRetentionRow {
  inboxRetentionDays: number;
  deliveryRetentionDays: number;
}

export interface SweepResult {
  errors: number;
  perf: number;
  /** Sourcemap rows pruned for builds outside the retained-builds window. */
  sourcemaps: number;
}

/** Reads (and if missing, seeds) the global app config row. */
export async function getAppConfig(): Promise<AppConfigRow> {
  const db = getDb();
  const now = Date.now();
  const row = await db.select().from(appConfig).where(eq(appConfig.id, APP_CONFIG_ID)).get();
  if (row) {
    return {
      errorRetentionDays: row.errorRetentionDays,
      perfRetentionDays: row.perfRetentionDays,
    };
  }
  await db
    .insert(appConfig)
    .values({
      id: APP_CONFIG_ID,
      errorRetentionDays: DEFAULT_ERROR_RETENTION_DAYS,
      perfRetentionDays: DEFAULT_PERF_RETENTION_DAYS,
      updatedAt: now,
    })
    .onConflictDoNothing();
  return {
    errorRetentionDays: DEFAULT_ERROR_RETENTION_DAYS,
    perfRetentionDays: DEFAULT_PERF_RETENTION_DAYS,
  };
}

/** Updates the error retention window, clamped to [MIN, MAX]. The seed +
 *  update pair runs inside a single transaction so two concurrent admin PUTs
 *  cannot interleave and overwrite each other. */
export async function setErrorRetentionDays(days: number): Promise<number> {
  const db = getDb();
  const clamped = Math.max(
    MIN_ERROR_RETENTION_DAYS,
    Math.min(MAX_ERROR_RETENTION_DAYS, Math.floor(days)),
  );
  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx
      .insert(appConfig)
      .values({
        id: APP_CONFIG_ID,
        errorRetentionDays: clamped,
        perfRetentionDays: DEFAULT_PERF_RETENTION_DAYS,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: appConfig.id,
        set: { errorRetentionDays: clamped, updatedAt: now },
      });
  });
  return clamped;
}

/** Updates the perf retention window, clamped to [MIN, MAX]. The seed +
 *  update pair runs inside a single transaction so two concurrent admin PUTs
 *  cannot interleave and overwrite each other. */
export async function setPerfRetentionDays(days: number): Promise<number> {
  const db = getDb();
  const clamped = Math.max(
    MIN_PERF_RETENTION_DAYS,
    Math.min(MAX_PERF_RETENTION_DAYS, Math.floor(days)),
  );
  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx
      .insert(appConfig)
      .values({
        id: APP_CONFIG_ID,
        errorRetentionDays: DEFAULT_ERROR_RETENTION_DAYS,
        perfRetentionDays: clamped,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: appConfig.id,
        set: { perfRetentionDays: clamped, updatedAt: now },
      });
  });
  return clamped;
}

/** Prunes sourcemaps for builds outside the most-recently-active window. Maps
 *  are bounded by build count, not age: the N builds with the newest stored map
 *  are retained and every row for any other build is deleted. A build with no
 *  newer build to displace it is always inside the window, so the current
 *  deploy's maps can never be pruned. Returns the number of rows deleted. */
async function pruneSourcemaps(): Promise<number> {
  const db = getDb();
  // N most recently active distinct builds, newest map first.
  const retained = await db
    .select({ buildId: sourcemaps.buildId })
    .from(sourcemaps)
    .groupBy(sourcemaps.buildId)
    .orderBy(sql`${max(sourcemaps.createdAt)} desc`)
    .limit(SOURCEMAP_RETAINED_BUILDS)
    .all();
  // Fewer builds than the window means nothing is outside it.
  if (retained.length < SOURCEMAP_RETAINED_BUILDS) return 0;
  const keepIds = retained.map((r) => r.buildId);
  const deleted = await db
    .delete(sourcemaps)
    .where(notInArray(sourcemaps.buildId, keepIds))
    .returning({ id: sourcemaps.id });
  return deleted.length;
}

const DEFAULT_INBOX_RETENTION_DAYS = 90;
const DEFAULT_DELIVERY_RETENTION_DAYS = 30;
const MIN_NOTIFICATION_RETENTION_DAYS = 1;
const MAX_NOTIFICATION_RETENTION_DAYS = 3650;

function clampNotificationRetention(days: number): number {
  return Math.max(
    MIN_NOTIFICATION_RETENTION_DAYS,
    Math.min(MAX_NOTIFICATION_RETENTION_DAYS, Math.floor(days)),
  );
}

/** Clamps each provided window and drops the ones the caller omitted, so the
 *  upsert's `set` touches only the columns actually being changed. */
function clampNotificationPatch(input: {
  inboxRetentionDays?: number;
  deliveryRetentionDays?: number;
}): { inboxRetentionDays?: number; deliveryRetentionDays?: number } {
  const patch: { inboxRetentionDays?: number; deliveryRetentionDays?: number } = {};
  if (input.inboxRetentionDays !== undefined) {
    patch.inboxRetentionDays = clampNotificationRetention(input.inboxRetentionDays);
  }
  if (input.deliveryRetentionDays !== undefined) {
    patch.deliveryRetentionDays = clampNotificationRetention(input.deliveryRetentionDays);
  }
  return patch;
}

/**
 * Reads (and if missing, seeds) the notification retention columns from the
 * global app_config row. The notifications module routes all app_config access
 * through this function so diagnostics owns the single-row contract.
 */
export async function getNotificationRetention(): Promise<NotificationRetentionRow> {
  const db = getDb();
  const now = Date.now();
  const row = await db.select().from(appConfig).where(eq(appConfig.id, APP_CONFIG_ID)).get();
  if (row) {
    return {
      inboxRetentionDays: row.inboxRetentionDays ?? DEFAULT_INBOX_RETENTION_DAYS,
      deliveryRetentionDays: row.deliveryRetentionDays ?? DEFAULT_DELIVERY_RETENTION_DAYS,
    };
  }
  await db
    .insert(appConfig)
    .values({
      id: APP_CONFIG_ID,
      errorRetentionDays: DEFAULT_ERROR_RETENTION_DAYS,
      perfRetentionDays: DEFAULT_PERF_RETENTION_DAYS,
      inboxRetentionDays: DEFAULT_INBOX_RETENTION_DAYS,
      deliveryRetentionDays: DEFAULT_DELIVERY_RETENTION_DAYS,
      updatedAt: now,
    })
    .onConflictDoNothing();
  return {
    inboxRetentionDays: DEFAULT_INBOX_RETENTION_DAYS,
    deliveryRetentionDays: DEFAULT_DELIVERY_RETENTION_DAYS,
  };
}

/**
 * Updates notification retention windows [1, 3650] days; `onConflictDoUpdate`
 * with selective `set` ensures concurrent PUTs don't clobber the non-patched
 * window via stale snapshots.
 */
export async function setNotificationRetention(input: {
  inboxRetentionDays?: number;
  deliveryRetentionDays?: number;
}): Promise<NotificationRetentionRow> {
  const db = getDb();
  const now = Date.now();
  const patch = clampNotificationPatch(input);
  const [row] = await db
    .insert(appConfig)
    .values({
      id: APP_CONFIG_ID,
      errorRetentionDays: DEFAULT_ERROR_RETENTION_DAYS,
      perfRetentionDays: DEFAULT_PERF_RETENTION_DAYS,
      inboxRetentionDays: patch.inboxRetentionDays ?? DEFAULT_INBOX_RETENTION_DAYS,
      deliveryRetentionDays: patch.deliveryRetentionDays ?? DEFAULT_DELIVERY_RETENTION_DAYS,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appConfig.id,
      set: { ...patch, updatedAt: now },
    })
    .returning({
      inboxRetentionDays: appConfig.inboxRetentionDays,
      deliveryRetentionDays: appConfig.deliveryRetentionDays,
    });
  // A single-row upsert always returns exactly one row; guard so a silent schema
  // or driver change surfaces loudly instead of returning stale defaults.
  if (!row) throw new Error("setNotificationRetention: upsert returned no row");
  return {
    inboxRetentionDays: row.inboxRetentionDays,
    deliveryRetentionDays: row.deliveryRetentionDays,
  };
}

/** Deletes diagnostic records older than the configured retention windows and
 *  prunes sourcemaps for superseded builds. Each table is read once and swept
 *  independently — perf typically has a much shorter window than errors. Run
 *  nightly via the diagnostics cron. */
export async function sweepDiagnostics(): Promise<SweepResult> {
  const db = getDb();
  const { errorRetentionDays, perfRetentionDays } = await getAppConfig();
  const now = Date.now();
  const errCutoff = now - errorRetentionDays * 86_400_000;
  const perfCutoff = now - perfRetentionDays * 86_400_000;
  const [errResult, perfResult, sourcemapCount] = await Promise.all([
    db
      .delete(errorRecords)
      .where(lt(errorRecords.createdAt, errCutoff))
      .returning({ id: errorRecords.id }),
    db
      .delete(perfRecords)
      .where(lt(perfRecords.createdAt, perfCutoff))
      .returning({ id: perfRecords.id }),
    pruneSourcemaps(),
  ]);
  return { errors: errResult.length, perf: perfResult.length, sourcemaps: sourcemapCount };
}
