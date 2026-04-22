import { and, eq } from "drizzle-orm";
import type { ValidatedManifest } from "@ent-mcp/shared/plugins";
import { getDb } from "../db/client";
import { pluginSharedCredentials } from "../db/schema/plugin-shared-credentials";
import { plugins } from "../db/schema/plugins";
import { decryptJson, encryptJson } from "../crypto/helpers";
import { PluginError } from "./types";

function randomId(): string {
  return crypto.randomUUID();
}

export interface SharedCredentialRow {
  id: string;
  pluginId: string;
  label: string;
  enabled: boolean;
  lastExhaustedAt: number | null;
  retryAfter: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SharedCredentialSummary {
  id: string;
  label: string;
  enabled: boolean;
  lastExhaustedAt: number | null;
  retryAfter: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * One decrypted credential picked from the pool. The plugin only ever sees the
 * `value`; `id` is the host's bookkeeping handle.
 */
export interface PoolPick {
  id: string;
  label: string;
  value: unknown;
}

function isPoolable(manifestJson: string): boolean {
  try {
    const manifest = JSON.parse(manifestJson) as Partial<ValidatedManifest>;
    return !!manifest.poolable;
  } catch {
    return false;
  }
}

async function requirePluginManifestJson(pluginId: string): Promise<string> {
  const db = getDb();
  const row = await db.select().from(plugins).where(eq(plugins.id, pluginId)).get();
  if (!row) throw new PluginError("plugin.not_found", `plugin ${pluginId} not installed`);
  return row.manifest;
}

export const sharedCredentialsService = {
  /** Summaries only; decrypted values are never leaked over this API. */
  async list(pluginId: string): Promise<SharedCredentialSummary[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(pluginSharedCredentials)
      .where(eq(pluginSharedCredentials.pluginId, pluginId))
      .all();
    return rows.map(toSummary);
  },

  /** Lists enabled entries in round-robin order alongside their decrypted values. */
  async listDecryptedActive(pluginId: string): Promise<PoolPick[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(pluginSharedCredentials)
      .where(
        and(eq(pluginSharedCredentials.pluginId, pluginId), eq(pluginSharedCredentials.enabled, 1)),
      )
      .all();
    const picks: PoolPick[] = [];
    for (const row of rows) {
      const { iv, encryptedValue } = row;
      const value = await decryptJson(iv, encryptedValue);
      picks.push({ id: row.id, label: row.label, value });
    }
    return picks;
  },

  async countEnabled(pluginId: string): Promise<number> {
    const rows = await this.list(pluginId);
    return rows.filter((r) => r.enabled).length;
  },

  /** Adds a new entry. Rejects multiple entries for non-poolable plugins. */
  async add(args: { pluginId: string; label: string; value: unknown }): Promise<string> {
    const manifestJson = await requirePluginManifestJson(args.pluginId);
    const existing = await this.list(args.pluginId);
    if (!isPoolable(manifestJson) && existing.length > 0) {
      throw new PluginError(
        "plugin.not_poolable",
        `plugin ${args.pluginId} is not poolable — only one shared credential entry is permitted`,
      );
    }
    const { iv, data } = await encryptJson(args.value);
    const now = Date.now();
    const id = randomId();
    const db = getDb();
    await db.insert(pluginSharedCredentials).values({
      id,
      pluginId: args.pluginId,
      label: args.label,
      encryptedValue: data,
      iv,
      enabled: 1,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },

  async update(args: {
    pluginId: string;
    credentialId: string;
    label?: string;
    value?: unknown;
    enabled?: boolean;
  }): Promise<void> {
    const db = getDb();
    const patch: Partial<{
      label: string;
      encryptedValue: string;
      iv: string;
      enabled: number;
      updatedAt: number;
    }> = { updatedAt: Date.now() };
    if (args.label !== undefined) patch.label = args.label;
    if (args.enabled !== undefined) patch.enabled = args.enabled ? 1 : 0;
    if (args.value !== undefined) {
      const { iv, data } = await encryptJson(args.value);
      patch.iv = iv;
      patch.encryptedValue = data;
    }
    const updated = await db
      .update(pluginSharedCredentials)
      .set(patch)
      .where(
        and(
          eq(pluginSharedCredentials.id, args.credentialId),
          eq(pluginSharedCredentials.pluginId, args.pluginId),
        ),
      )
      .returning({ id: pluginSharedCredentials.id });
    if (updated.length === 0) {
      throw new PluginError(
        "plugin.shared_credential_not_found",
        `shared credential ${args.credentialId} not found`,
      );
    }
  },

  async delete(args: { pluginId: string; credentialId: string }): Promise<void> {
    const db = getDb();
    await db
      .delete(pluginSharedCredentials)
      .where(
        and(
          eq(pluginSharedCredentials.id, args.credentialId),
          eq(pluginSharedCredentials.pluginId, args.pluginId),
        ),
      );
  },

  async getDecrypted(args: { pluginId: string; credentialId: string }): Promise<PoolPick> {
    const db = getDb();
    const row = await db
      .select()
      .from(pluginSharedCredentials)
      .where(
        and(
          eq(pluginSharedCredentials.id, args.credentialId),
          eq(pluginSharedCredentials.pluginId, args.pluginId),
        ),
      )
      .get();
    if (!row) {
      throw new PluginError(
        "plugin.shared_credential_not_found",
        `shared credential ${args.credentialId} not found`,
      );
    }
    const value = await decryptJson(row.iv, row.encryptedValue);
    return { id: row.id, label: row.label, value };
  },

  /**
   * Marks an entry exhausted. `retryAfterSec` is optional; absent means "back
   * off for a reasonable default". Host stores epoch-seconds in `retry_after`
   * so `<= now()` means "ready again".
   */
  async markExhausted(args: {
    pluginId: string;
    credentialId: string;
    retryAfterSec?: number;
  }): Promise<void> {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const backoffSec = args.retryAfterSec ?? 60;
    await db
      .update(pluginSharedCredentials)
      .set({
        lastExhaustedAt: now,
        retryAfter: now + backoffSec,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(pluginSharedCredentials.id, args.credentialId),
          eq(pluginSharedCredentials.pluginId, args.pluginId),
        ),
      );
  },
};

function toSummary(row: typeof pluginSharedCredentials.$inferSelect): SharedCredentialSummary {
  return {
    id: row.id,
    label: row.label,
    enabled: row.enabled === 1,
    lastExhaustedAt: row.lastExhaustedAt ?? null,
    retryAfter: row.retryAfter ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
