import { and, eq } from "drizzle-orm";
import type { PersonalKeyFallbackPolicy, ValidatedManifest } from "@nama/shared/plugins";
import { getDb } from "../../db/client";
import { pluginSharedCredentials } from "../../db/schema/plugin-runtime/plugin-shared-credentials";
import { plugins } from "../../db/schema/plugin-runtime/plugins";
import { decryptJson, encryptJson } from "../../crypto/helpers";
import { PluginError } from "@nama/plugin-sdk";

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
  /** True for the synthesized read-only bundled default entry (design §4). */
  bundled?: boolean;
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

export interface PluginRow {
  id: string;
  version: string;
  enabled: number;
  globalConfig: string | null;
  personalKeyFallback: PersonalKeyFallbackPolicy;
  manifest: string;
  installedAt: number;
  updatedAt: number;
}

/** Fetches the plugins row by id, throwing when the plugin is not installed. */
export async function requirePluginRow(pluginId: string): Promise<PluginRow> {
  const db = getDb();
  const row = await db.select().from(plugins).where(eq(plugins.id, pluginId)).get();
  if (!row) throw new PluginError("plugin.not_found", `plugin ${pluginId} not installed`);
  return row satisfies PluginRow;
}

async function requirePluginManifestJson(pluginId: string): Promise<string> {
  const row = await requirePluginRow(pluginId);
  return row.manifest;
}

/** Reserved id/label for the synthesized bundled default entry. By-id mutators
 *  reject this id; `add` rejects the label case-insensitively via `list`. */
export const BUNDLED_CREDENTIAL_ID = "__bundled__";
const BUNDLED_CREDENTIAL_LABEL = "Bundled (default)";

/** The bundled default has no DB row; every by-id mutator/reader rejects it so
 *  the admin "test"/edit/delete/toggle paths surface `bundled_readonly` rather
 *  than a misleading `shared_credential_not_found` (design §3). */
function assertNotBundled(credentialId: string, pluginId: string): void {
  if (credentialId === BUNDLED_CREDENTIAL_ID) {
    throw new PluginError(
      "plugin.bundled_readonly",
      `the bundled default credential for plugin ${pluginId} is read-only`,
    );
  }
}

/** The plugin's bundled default credential value, or null when absent or the
 *  manifest JSON is unparseable. */
function readBundledDefault(manifestJson: string): unknown {
  try {
    return (
      (JSON.parse(manifestJson) as Partial<ValidatedManifest>).defaultSharedCredentials ?? null
    );
  } catch {
    return null;
  }
}

/** Synthesized summary for the bundled default. Timestamps borrow the plugin's
 *  install/update times ("bundled since install") — stable across restarts,
 *  no epoch-0 churn (design §2). */
function buildBundledSummary(row: PluginRow): SharedCredentialSummary | null {
  if (readBundledDefault(row.manifest) === null) return null;
  return {
    id: BUNDLED_CREDENTIAL_ID,
    label: BUNDLED_CREDENTIAL_LABEL,
    enabled: true,
    lastExhaustedAt: null,
    retryAfter: null,
    createdAt: row.installedAt,
    updatedAt: row.updatedAt,
    bundled: true,
  };
}

export const sharedCredentialsService = {
  /** Summaries only; decrypted values are never leaked over this API. The
   *  bundled default (if any) is appended last so real rows take priority. */
  async list(pluginId: string): Promise<SharedCredentialSummary[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(pluginSharedCredentials)
      .where(eq(pluginSharedCredentials.pluginId, pluginId))
      .all();
    const summaries = rows.map(toSummary);
    const bundled = buildBundledSummary(await requirePluginRow(pluginId));
    if (bundled) summaries.push(bundled);
    return summaries;
  },

  /** Lists enabled entries in round-robin order alongside their decrypted
   *  values, then the bundled default last (lowest priority). A non-empty
   *  return keeps `buildCredentialPlan` off the `capability_unavailable` path. */
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
    const bundled = readBundledDefault((await requirePluginRow(pluginId)).manifest);
    if (bundled !== null) {
      picks.push({ id: BUNDLED_CREDENTIAL_ID, label: BUNDLED_CREDENTIAL_LABEL, value: bundled });
    }
    return picks;
  },

  async countEnabled(pluginId: string): Promise<number> {
    const rows = await this.list(pluginId);
    return rows.filter((r) => r.enabled).length;
  },

  /** Adds a new entry. Rejects multiple entries for non-poolable plugins and
   *  case-insensitive label collisions. */
  async add(args: { pluginId: string; label: string; value: unknown }): Promise<string> {
    const manifestJson = await requirePluginManifestJson(args.pluginId);
    const existing = await this.list(args.pluginId);
    // The synthetic bundled entry must not consume the single non-poolable slot,
    // or a non-poolable plugin with a bundled default could never add a real
    // override key (design §3). Count real rows only here; the label-collision
    // check below still sees the bundled entry so its label stays reserved.
    const realCount = existing.filter((e) => e.id !== BUNDLED_CREDENTIAL_ID).length;
    if (!isPoolable(manifestJson) && realCount > 0) {
      throw new PluginError(
        "plugin.not_poolable",
        `plugin ${args.pluginId} is not poolable — only one shared credential entry is permitted`,
        { field: "label" },
      );
    }
    const labelLower = args.label.trim().toLowerCase();
    if (existing.some((e) => e.label.trim().toLowerCase() === labelLower)) {
      throw new PluginError(
        "plugin.duplicate_label",
        `shared credential with label "${args.label}" already exists for plugin ${args.pluginId}`,
        { field: "label" },
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

  // fallow-ignore-next-line complexity
  async update(args: {
    pluginId: string;
    credentialId: string;
    label?: string;
    value?: unknown;
    enabled?: boolean;
  }): Promise<void> {
    assertNotBundled(args.credentialId, args.pluginId);
    const db = getDb();
    if (args.label !== undefined) {
      const labelLower = args.label.trim().toLowerCase();
      const existing = await this.list(args.pluginId);
      if (
        existing.some(
          (e) => e.id !== args.credentialId && e.label.trim().toLowerCase() === labelLower,
        )
      ) {
        throw new PluginError(
          "plugin.duplicate_label",
          `shared credential with label "${args.label}" already exists for plugin ${args.pluginId}`,
          { field: "label" },
        );
      }
    }
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
    assertNotBundled(args.credentialId, args.pluginId);
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
    assertNotBundled(args.credentialId, args.pluginId);
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
    // No bundled guard: the UPDATE matches 0 rows for "__bundled__" (no DB row),
    // a correct silent no-op — the public key is simply retried (design §3).
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
