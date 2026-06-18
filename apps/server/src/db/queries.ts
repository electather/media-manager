import { createHash } from "node:crypto";
import { consola } from "consola";
import { and, desc, eq } from "drizzle-orm";
import { getDb, type Db } from "./client";
import { plugins, serviceConnections } from "./schema";

export async function selectEnabledPlugins() {
  const db = getDb();
  return db.select().from(plugins).where(eq(plugins.enabled, 1)).all();
}

/**
 * Parses the stored `serviceConnections.userConfig` JSON text column. Returns
 * `null` on a missing value or malformed JSON rather than propagating a raw
 * `SyntaxError`, so a single corrupt row degrades to "no user config" instead
 * of throwing a 500 across every read path (connections list, media dispatch,
 * targeted dispatch, plugin jobs, MCP calls). `null` is already a valid value
 * for these callers — a row that never had a userConfig produces the same
 * result — so degrading to it is safe.
 */
export function parseUserConfig(raw: string | null | undefined, connectionId?: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    warnCorruptUserConfig(raw, err, connectionId);
    return null;
  }
}

/**
 * Tracks corrupt rows that have already been logged so each distinct one emits
 * exactly one warning per process lifetime. Evicted on restart, which is
 * acceptable — operators need to see the warning at least once.
 *
 * Keyed by `connectionId` plus content fingerprint, not content alone: the goal
 * is to stop a single bad row read on every request from flooding the log, while
 * still surfacing every distinct corrupt row an operator needs to locate. Two
 * different connections holding byte-identical corrupt blobs each warn once.
 */
const warnedFingerprints = new Set<string>();

/** Test-only escape hatch to clear the module-level dedupe state between tests. */
export const _testOnly_clearWarnedFingerprints = (): void => warnedFingerprints.clear();

/**
 * Surfaces a corrupt `userConfig` row so operators can locate it. The owning
 * connection id pinpoints the row; we deliberately do NOT log the raw value
 * because `x-private` fields live in `userConfig` as plaintext and an excerpt
 * could leak one into the logs. A length + short content hash is enough to tell
 * corrupt rows apart and confirm a re-occurrence without exposing any content.
 *
 * Each distinct fingerprint is logged at most once per process lifetime to
 * avoid flooding the log on hot read paths.
 */
function warnCorruptUserConfig(raw: string, err: unknown, connectionId?: string): void {
  const fingerprint = `${raw.length} chars, sha256=${createHash("sha256")
    .update(raw)
    .digest("hex")
    .slice(0, 8)}`;
  const dedupeKey = `${connectionId ?? ""}:${fingerprint}`;
  if (warnedFingerprints.has(dedupeKey)) return;
  warnedFingerprints.add(dedupeKey);
  consola.warn("Failed to parse serviceConnections.userConfig; treating as empty", {
    connectionId,
    fingerprint,
    error: err instanceof Error ? err.message : String(err),
  });
}

export async function queryEnabledConnectionsForPlugin(db: Db, userId: string, pluginId: string) {
  return db
    .select()
    .from(serviceConnections)
    .where(
      and(
        eq(serviceConnections.userId, userId),
        eq(serviceConnections.pluginId, pluginId),
        eq(serviceConnections.enabled, 1),
      ),
    )
    .orderBy(desc(serviceConnections.isDefault), desc(serviceConnections.createdAt))
    .all();
}

/**
 * Parks a connection on rate-limit cooldown. Stamps `lastExhaustedAt` with the
 * current epoch second and sets `retryAfter` that many seconds in the future so
 * the ready-now filter skips the connection until the window passes.
 */
export async function markConnectionExhausted(
  connectionId: string,
  retryAfterSec = 60,
): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(serviceConnections)
    .set({
      lastExhaustedAt: now,
      retryAfter: now + retryAfterSec,
      updatedAt: Date.now(),
    })
    .where(eq(serviceConnections.id, connectionId));
}
