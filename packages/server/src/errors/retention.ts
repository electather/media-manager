import { lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { errorRecords, appConfig } from "../db/schema/errors";

const APP_CONFIG_ID = "global";
const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 365;

export interface AppConfigRow {
  errorRetentionDays: number;
}

/** Reads (and if missing, seeds) the global app config row. */
export async function getAppConfig(): Promise<AppConfigRow> {
  const db = getDb();
  const now = Date.now();
  const row = await db.select().from(appConfig).get();
  if (row) return { errorRetentionDays: row.errorRetentionDays };
  await db
    .insert(appConfig)
    .values({
      id: APP_CONFIG_ID,
      errorRetentionDays: DEFAULT_RETENTION_DAYS,
      updatedAt: now,
    })
    .onConflictDoNothing();
  return { errorRetentionDays: DEFAULT_RETENTION_DAYS };
}

/** Updates the error retention window, clamped to [MIN, MAX]. */
export async function setErrorRetentionDays(days: number): Promise<number> {
  const db = getDb();
  const clamped = Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, Math.floor(days)));
  await getAppConfig();
  await db.update(appConfig).set({ errorRetentionDays: clamped, updatedAt: Date.now() }).run();
  return clamped;
}

/** Deletes error records older than the configured retention window. Run nightly. */
export async function sweepExpiredErrors(): Promise<number> {
  const db = getDb();
  const { errorRetentionDays } = await getAppConfig();
  const cutoff = Date.now() - errorRetentionDays * 86_400_000;
  const result = await db
    .delete(errorRecords)
    .where(lt(errorRecords.createdAt, cutoff))
    .returning({ id: errorRecords.id });
  return result.length;
}
