import { and, eq, isNull, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { pluginStore } from "../db/schema/plugins";
import type { PluginStoreApi, StoreScopeOpts } from "@ent-mcp/plugin-sdk";

export { isHostAllowed, TokenBucket, getBucket, buildFetch, buildLogger } from "./fetch-policy";

function matchScope(pluginId: string, userId: string | null, key: string) {
  return and(
    eq(pluginStore.pluginId, pluginId),
    userId === null ? isNull(pluginStore.userId) : eq(pluginStore.userId, userId),
    eq(pluginStore.key, key),
  );
}

function resolveScope(callerUserId: string | null, scope: StoreScopeOpts["scope"]): string | null {
  if (scope === "global") return null;
  return callerUserId;
}

/** Builds the ctx.store KV, scoped to (plugin_id, user_id|null, key). */
export function buildStore(pluginId: string, callerUserId: string | null): PluginStoreApi {
  const db = getDb();
  return {
    // fallow-ignore-next-line complexity
    async get(key, opts) {
      const effective = resolveScope(callerUserId, opts?.scope);
      const row = await db
        .select()
        .from(pluginStore)
        .where(matchScope(pluginId, effective, key))
        .get();
      if (!row) return undefined;
      if (row.expiresAt && row.expiresAt < Date.now()) return undefined;
      try {
        return JSON.parse(row.value);
      } catch {
        return row.value;
      }
    },
    async set(key, value, opts) {
      const now = Date.now();
      const effective = resolveScope(callerUserId, opts?.scope);
      const serialized = JSON.stringify(value);
      const expiresAt = opts?.ttlSec ? now + opts.ttlSec * 1000 : null;
      const row = {
        pluginId,
        userId: effective,
        key,
        value: serialized,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      };
      if (effective === null) {
        // SQLite treats NULL as distinct from other NULLs in unique/PK
        // indexes, so ON CONFLICT (plugin_id, user_id, key) never fires for
        // global-scope rows. Run UPDATE-then-INSERT inside a transaction to
        // keep the same TOCTOU guarantee the upsert gives user-scoped rows.
        await db.transaction(async (tx) => {
          const updated = await tx
            .update(pluginStore)
            .set({ value: serialized, expiresAt, updatedAt: now })
            .where(matchScope(pluginId, null, key))
            .returning({ pluginId: pluginStore.pluginId });
          if (updated.length === 0) {
            await tx.insert(pluginStore).values(row);
          }
        });
        return;
      }
      await db
        .insert(pluginStore)
        .values(row)
        .onConflictDoUpdate({
          target: [pluginStore.pluginId, pluginStore.userId, pluginStore.key],
          set: { value: serialized, expiresAt, updatedAt: now },
        });
    },
    async delete(key, opts) {
      const effective = resolveScope(callerUserId, opts?.scope);
      await db.delete(pluginStore).where(matchScope(pluginId, effective, key));
    },
  };
}

/** Removes all plugin_store rows whose expires_at has passed. Called by the sweeper cron. */
export async function sweepExpiredStore(): Promise<number> {
  const db = getDb();
  const result = await db
    .delete(pluginStore)
    .where(lt(pluginStore.expiresAt, Date.now()))
    .returning({ key: pluginStore.key });
  return result.length;
}
