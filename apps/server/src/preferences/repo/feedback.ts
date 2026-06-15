import { and, desc, eq, gt, gte, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { feedback, preferenceProfiles } from "../../db/schema";

export type FeedbackRow = typeof feedback.$inferSelect;

export interface InsertFeedbackRow {
  id: string;
  userId: string;
  tmdbId: string;
  mediaType: "movie" | "tv";
  action: "rate" | "like" | "dislike" | "note";
  rating: number | null;
  note: string | null;
  noteSentiment: "positive" | "negative" | "neutral" | null;
  noteKeywords: string | null;
  createdAt: number;
}

export async function insertFeedback(row: InsertFeedbackRow): Promise<void> {
  await getDb().insert(feedback).values(row);
}

export async function listFeedbackForUser(userId: string): Promise<FeedbackRow[]> {
  return getDb()
    .select()
    .from(feedback)
    .where(eq(feedback.userId, userId))
    .orderBy(desc(feedback.createdAt))
    .all();
}

export async function listFeedbackSince(userId: string, sinceMs: number): Promise<FeedbackRow[]> {
  return getDb()
    .select()
    .from(feedback)
    .where(and(eq(feedback.userId, userId), gt(feedback.createdAt, sinceMs)))
    .orderBy(desc(feedback.createdAt))
    .all();
}

/**
 * Distinct ids of users with any feedback event at or after `cutoff`. Backs
 * the home warm job's "active user" union via the preferences service barrel.
 */
export async function listUserIdsWithFeedbackSince(cutoff: number): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ userId: feedback.userId })
    .from(feedback)
    .where(gte(feedback.createdAt, cutoff))
    .all();
  return rows.map((row) => row.userId);
}

export async function listFeedbackForItem(
  userId: string,
  tmdbId: string,
  mediaType: "movie" | "tv",
): Promise<FeedbackRow[]> {
  return getDb()
    .select()
    .from(feedback)
    .where(
      and(
        eq(feedback.userId, userId),
        eq(feedback.tmdbId, tmdbId),
        eq(feedback.mediaType, mediaType),
      ),
    )
    .orderBy(desc(feedback.createdAt))
    .all();
}

export async function countFeedbackSince(userId: string, sinceMs: number): Promise<number> {
  const row = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(feedback)
    .where(and(eq(feedback.userId, userId), gt(feedback.createdAt, sinceMs)))
    .get();
  return row?.count ?? 0;
}

// ─── rebuild row source (cross-table joins between feedback + profiles) ──────

export async function listFirstRunUsers(): Promise<Array<{ userId: string }>> {
  return getDb()
    .selectDistinct({ userId: feedback.userId })
    .from(feedback)
    .leftJoin(preferenceProfiles, eq(preferenceProfiles.userId, feedback.userId))
    .where(sql`${preferenceProfiles.userId} IS NULL`)
    .all();
}

export async function listStaleProfileUsers(
  staleBeforeMs: number,
): Promise<Array<{ userId: string }>> {
  return getDb()
    .selectDistinct({ userId: preferenceProfiles.userId })
    .from(preferenceProfiles)
    .where(sql`${preferenceProfiles.lastRebuiltAt} < ${staleBeforeMs}`)
    .all();
}

export async function listBurstyFeedbackUsers(
  threshold: number,
): Promise<Array<{ userId: string }>> {
  return getDb()
    .select({ userId: feedback.userId })
    .from(feedback)
    .innerJoin(preferenceProfiles, eq(preferenceProfiles.userId, feedback.userId))
    .where(gt(feedback.createdAt, preferenceProfiles.lastRebuiltAt))
    .groupBy(feedback.userId)
    .having(sql`count(${feedback.id}) >= ${threshold}`)
    .all();
}

export async function listFreshCombinedUserIds(freshCutoffMs: number): Promise<string[]> {
  const rows = await getDb()
    .select({ userId: preferenceProfiles.userId })
    .from(preferenceProfiles)
    .where(
      and(
        eq(preferenceProfiles.mediaType, "combined"),
        sql`${preferenceProfiles.lastRebuiltAt} >= ${freshCutoffMs}`,
      ),
    )
    .all();
  return rows.map((row) => row.userId);
}
