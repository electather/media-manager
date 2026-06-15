import { eq, gte } from "drizzle-orm";
import { uniqBy } from "es-toolkit/array";
import type { Db } from "../../db/client";
import { userHistoryMirror, userRatingsMirror } from "../../db/schema/catalog";
import type { HistoryEvent, PluginCursors, RatingEvent } from "@nama/shared/catalog";
import type { PerUserMutex } from "../internal/mutex";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Shared state the mirror append path needs: the DB plus the per-user mutex. */
export interface MirrorStore {
  db: Db;
  mutex: PerUserMutex;
}

export async function selectUserHistory(db: Db, userId: string): Promise<HistoryEvent[]> {
  const row = await db
    .select({ events: userHistoryMirror.events })
    .from(userHistoryMirror)
    .where(eq(userHistoryMirror.userId, userId))
    .get();
  return row?.events ?? [];
}

export async function selectUserRatings(db: Db, userId: string): Promise<RatingEvent[]> {
  const row = await db
    .select({ events: userRatingsMirror.events })
    .from(userRatingsMirror)
    .where(eq(userRatingsMirror.userId, userId))
    .get();
  return row?.events ?? [];
}

/**
 * Distinct ids of users whose history mirror was synced at or after `cutoff`.
 * Backs the home warm job's "active user" union via the catalog service
 * barrel, so the warm job never touches the catalog-owned mirror table.
 */
export async function selectUserIdsSyncedSince(db: Db, cutoff: number): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: userHistoryMirror.userId })
    .from(userHistoryMirror)
    .where(gte(userHistoryMirror.lastSyncedAt, cutoff))
    .all();
  return rows.map((row) => row.userId);
}

export async function selectHistoryCursors(db: Db, userId: string): Promise<PluginCursors> {
  const row = await db
    .select({ pluginCursors: userHistoryMirror.pluginCursors })
    .from(userHistoryMirror)
    .where(eq(userHistoryMirror.userId, userId))
    .get();
  return row?.pluginCursors ?? {};
}

export async function selectRatingsCursors(db: Db, userId: string): Promise<PluginCursors> {
  const row = await db
    .select({ pluginCursors: userRatingsMirror.pluginCursors })
    .from(userRatingsMirror)
    .where(eq(userRatingsMirror.userId, userId))
    .get();
  return row?.pluginCursors ?? {};
}

export async function appendHistoryEvents(
  store: MirrorStore,
  userId: string,
  events: HistoryEvent[],
  pluginId: string,
  cursorTs: number,
): Promise<void> {
  await appendMirrorRows(
    store,
    userId,
    events,
    pluginId,
    cursorTs,
    {
      select: (tx) =>
        tx.select().from(userHistoryMirror).where(eq(userHistoryMirror.userId, userId)).get(),
      upsert: (tx, merged, cursors, lastSyncedAt) =>
        tx
          .insert(userHistoryMirror)
          .values({ userId, events: merged, pluginCursors: cursors, lastSyncedAt })
          .onConflictDoUpdate({
            target: [userHistoryMirror.userId],
            set: { events: merged, pluginCursors: cursors, lastSyncedAt },
          }),
    },
    mergeHistory,
  );
}

export async function appendRatingEvents(
  store: MirrorStore,
  userId: string,
  events: RatingEvent[],
  pluginId: string,
  cursorTs: number,
): Promise<void> {
  await appendMirrorRows(
    store,
    userId,
    events,
    pluginId,
    cursorTs,
    {
      select: (tx) =>
        tx.select().from(userRatingsMirror).where(eq(userRatingsMirror.userId, userId)).get(),
      upsert: (tx, merged, cursors, lastSyncedAt) =>
        tx
          .insert(userRatingsMirror)
          .values({ userId, events: merged, pluginCursors: cursors, lastSyncedAt })
          .onConflictDoUpdate({
            target: [userRatingsMirror.userId],
            set: { events: merged, pluginCursors: cursors, lastSyncedAt },
          }),
    },
    mergeRatings,
  );
}

async function appendMirrorRows<E>(
  store: MirrorStore,
  userId: string,
  events: E[],
  pluginId: string,
  cursorTs: number,
  tableOps: {
    select: (
      tx: DbTransaction,
    ) => Promise<{ events: E[]; pluginCursors: PluginCursors } | undefined>;
    upsert: (
      tx: DbTransaction,
      events: E[],
      cursors: PluginCursors,
      lastSyncedAt: number,
    ) => PromiseLike<unknown>;
  },
  mergeEvents: (prior: E[], next: E[]) => E[],
): Promise<void> {
  if (events.length === 0) return;
  await store.mutex.run(userId, () =>
    // fallow-ignore-next-line complexity
    store.db.transaction(async (tx) => {
      const existing = await tableOps.select(tx);
      const merged = mergeEvents(existing?.events ?? [], events);
      const cursors = mergeCursor(existing?.pluginCursors ?? {}, pluginId, cursorTs);
      await tableOps.upsert(tx, merged, cursors, Date.now());
    }),
  );
}

/**
 * Append-only merge for the history mirror. Dedupe key is
 * `(tmdbId, mediaType, sourceConnectionId, watchedAt, episodeKey ?? '')`
 * so re-syncing the same plugin window is idempotent. Existing events keep
 * their original ordering; new events append in arrival order.
 */
function mergeHistory(prior: HistoryEvent[], next: HistoryEvent[]): HistoryEvent[] {
  return uniqBy([...prior, ...next], historyKey);
}

function mergeRatings(prior: RatingEvent[], next: RatingEvent[]): RatingEvent[] {
  return uniqBy([...prior, ...next], ratingKey);
}

function historyKey(event: HistoryEvent): string {
  return `${event.tmdbId}|${event.mediaType}|${event.sourceConnectionId}|${event.watchedAt}|${event.episodeKey ?? ""}`;
}

function ratingKey(event: RatingEvent): string {
  return `${event.tmdbId}|${event.mediaType}|${event.sourceConnectionId}|${event.ratedAt}`;
}

/**
 * Cursor merge: per V39 the cursor advances monotonically per connection.
 * `max(prior, incoming)` so a sync that lands an older window cannot
 * rewind a connection's progress, even if events themselves are
 * out-of-order.
 */
function mergeCursor(prior: PluginCursors, pluginId: string, cursorTs: number): PluginCursors {
  const previous = prior[pluginId] ?? 0;
  return { ...prior, [pluginId]: Math.max(previous, cursorTs) };
}
