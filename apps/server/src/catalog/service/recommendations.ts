import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { recommendationLists } from "../../db/schema/catalog";
import type { RecItem, RecommendationList, RecommendationListKind } from "@nama/shared/catalog";

export async function selectRecommendations(
  db: Db,
  userId: string,
  kind: RecommendationListKind,
): Promise<RecommendationList | null> {
  const row = await db
    .select()
    .from(recommendationLists)
    .where(and(eq(recommendationLists.userId, userId), eq(recommendationLists.listKind, kind)))
    .get();
  if (!row) return null;
  // `topContributors` was added in the home-feed backend phase. Rows
  // persisted before that ship without the field; default to `[]` so
  // callers don't have to handle `undefined`. The next nightly rec-build
  // run fills the snapshot for real.
  const items: RecItem[] = row.items.map((item) => ({
    ...item,
    topContributors: item.topContributors ?? [],
  }));
  return {
    items,
    profileVersion: row.profileVersion,
    generatedAt: row.generatedAt,
  };
}

export async function upsertRecommendationList(
  db: Db,
  userId: string,
  kind: RecommendationListKind,
  items: RecItem[],
  profileVersion: number,
): Promise<void> {
  const generatedAt = Date.now();
  await db
    .insert(recommendationLists)
    .values({ userId, listKind: kind, items, profileVersion, generatedAt })
    .onConflictDoUpdate({
      target: [recommendationLists.userId, recommendationLists.listKind],
      set: { items, profileVersion, generatedAt },
    });
}
