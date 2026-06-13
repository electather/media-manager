import { and, eq, inArray } from "drizzle-orm";
import { groupBy } from "es-toolkit/array";
import type { Db } from "../../db/client";
import { canonicalMetadata } from "../../db/schema/catalog";
import type { MetadataKey } from "@nama/shared/catalog";
import { candidateId } from "../features";

/**
 * Per-process throttle state owned by `CatalogService`. The map is keyed by
 * `${type}:${tmdbId}`; each entry is the last-seen monotonic timestamp.
 */
export interface AccessThrottleState {
  db: Db;
  throttle: Map<string, number>;
  throttleMs: number;
}

// fallow-ignore-next-line complexity
export function recordMetadataAccess(state: AccessThrottleState, items: MetadataKey[]): void {
  if (items.length === 0) return;
  const now = Date.now();
  const dueItems = items.filter((item) => {
    const key = candidateId(item);
    const prior = state.throttle.get(key);
    if (prior !== undefined && now - prior < state.throttleMs) return false;
    state.throttle.set(key, now);
    return true;
  });
  if (dueItems.length === 0) return;
  // Detached batch update — reads must not block on the write. Failures
  // log and drop; the next access cycle picks the row back up.
  void flushAccessUpdates(
    state.db,
    groupBy(dueItems, (item) => item.type),
    now,
  );
  evictStaleThrottleEntries(state, now);
}

async function flushAccessUpdates(
  db: Db,
  dueByType: Record<string, MetadataKey[]>,
  now: number,
): Promise<void> {
  for (const [type, typeItems] of Object.entries(dueByType) as Array<
    ["movie" | "tv", MetadataKey[]]
  >) {
    try {
      await db
        .update(canonicalMetadata)
        .set({ lastAccessedAt: now })
        .where(
          and(
            eq(canonicalMetadata.mediaType, type),
            inArray(
              canonicalMetadata.tmdbId,
              typeItems.map((i) => i.tmdbId),
            ),
          ),
        );
    } catch (err) {
      // Per V37, the catalog tolerates a dropped access bump; the next
      // read for the same row will re-enqueue it.
      // eslint-disable-next-line no-console
      console.warn("[catalog:recordAccess] update failed:", err);
    }
  }
}

function evictStaleThrottleEntries(state: AccessThrottleState, now: number): void {
  // Cap memory by dropping entries that have aged past 2× the throttle
  // window — long enough to absorb back-to-back access bursts but
  // bounded so the map cannot grow without limit on long-lived processes.
  const cutoff = now - state.throttleMs * 2;
  for (const [key, ts] of state.throttle) {
    if (ts < cutoff) state.throttle.delete(key);
  }
}
