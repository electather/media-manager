import { lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { appConfig, errorRecords, perfRecords } from "../db/schema/infra/diagnostics";

const APP_CONFIG_ID = "global";

const DEFAULT_ERROR_RETENTION_DAYS = 30;
const MIN_ERROR_RETENTION_DAYS = 7;
const MAX_ERROR_RETENTION_DAYS = 365;

const DEFAULT_PERF_RETENTION_DAYS = 7;
const MIN_PERF_RETENTION_DAYS = 1;
const MAX_PERF_RETENTION_DAYS = 90;

export interface AppConfigRow {
  errorRetentionDays: number;
  perfRetentionDays: number;
}

export interface SweepResult {
  errors: number;
  perf: number;
}

/** Reads (and if missing, seeds) the global app config row. */
export async function getAppConfig(): Promise<AppConfigRow> {
  const db = getDb();
  const now = Date.now();
  const row = await db.select().from(appConfig).get();
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

/** Deletes diagnostic records older than the configured retention windows.
 *  Each table is read once and swept independently — perf typically has a
 *  much shorter window than errors. Run nightly via the diagnostics cron. */
export async function sweepDiagnostics(): Promise<SweepResult> {
  const db = getDb();
  const { errorRetentionDays, perfRetentionDays } = await getAppConfig();
  const now = Date.now();
  const errCutoff = now - errorRetentionDays * 86_400_000;
  const perfCutoff = now - perfRetentionDays * 86_400_000;
  const [errResult, perfResult] = await Promise.all([
    db
      .delete(errorRecords)
      .where(lt(errorRecords.createdAt, errCutoff))
      .returning({ id: errorRecords.id }),
    db
      .delete(perfRecords)
      .where(lt(perfRecords.createdAt, perfCutoff))
      .returning({ id: perfRecords.id }),
  ]);
  return { errors: errResult.length, perf: perfResult.length };
}
