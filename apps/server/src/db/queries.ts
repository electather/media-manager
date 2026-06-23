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
 * Returns `null` on malformed JSON instead of throwing `SyntaxError`.
 * Degrades corrupt rows to "no user config" across all read paths rather than 500-ing;
 * `null` is already a valid value for callers.
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
 * Dedupes warnings: keyed by `connectionId` + fingerprint (not content alone)
 * to stop a single bad row from flooding logs while surfacing every distinct corrupt row.
 * Each distinct key warns exactly once per process lifetime.
 */
const warnedFingerprints = new Set<string>();

/** Test-only escape hatch to clear the module-level dedupe state between tests. */
export const _testOnly_clearWarnedFingerprints = (): void => warnedFingerprints.clear();

/**
 * Logs corrupt `userConfig` by connectionId + fingerprint (length + sha256 prefix).
 * Does NOT log raw value: `x-private` fields in plaintext could leak to logs.
 * Deduped per process lifetime to avoid flooding on hot paths.
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
