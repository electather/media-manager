import { eq } from "drizzle-orm";
import { PLUGIN_RESERVED_HEADER_NAMES } from "@ent-mcp/shared/plugins";
import { getDb } from "../db/client";
import { plugins } from "../db/schema/plugins";
import { decryptJson, encryptJson } from "../crypto/helpers";
import { PluginError } from "./types";

/**
 * Admin policy resolved for one plugin. Passed into every `buildContext` call
 * site so `ctx.fetch` can enforce the allowlist narrowing and inject admin
 * headers uniformly across capability dispatch, auth flows, jobs, and test
 * probes.
 */
export interface PluginAdminPolicy {
  /**
   * Admin-imposed host allowlist. `null` means inherit — the manifest allowlist
   * applies as-is. An empty array blocks every static host while leaving
   * `x-allowed-host` dynamic hosts untouched.
   */
  adminAllowlist: string[] | null;
  /**
   * Decrypted admin headers keyed by header name. Undefined (or empty object)
   * means the plugin's own headers pass through unchanged.
   */
  adminHeaders?: Record<string, string>;
}

interface CacheEntry {
  allowlist: string[] | null;
  headers?: Record<string, string>;
}

const cache = new Map<string, CacheEntry>();

function parseAllowlist(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return null;
  }
}

/** Clears the cache entry for a plugin. Called after any admin-policy write. */
export function invalidatePluginPolicy(pluginId: string): void {
  cache.delete(pluginId);
}

/** Test helper — clears the whole cache. Not used in production. */
export function _resetPluginPolicyCacheForTests(): void {
  cache.clear();
}

/**
 * Loads and caches the admin policy for a plugin. Decrypted headers live only
 * in the process-memory cache; the cache is invalidated by the admin-policy
 * write paths so a PUT immediately takes effect on the next invocation.
 */
export async function loadPluginPolicy(pluginId: string): Promise<PluginAdminPolicy> {
  const cached = cache.get(pluginId);
  if (cached) return { adminAllowlist: cached.allowlist, adminHeaders: cached.headers };

  const db = getDb();
  const row = await db
    .select({
      adminAllowlist: plugins.adminAllowlist,
      adminHeadersEncrypted: plugins.adminHeadersEncrypted,
      adminHeadersIv: plugins.adminHeadersIv,
    })
    .from(plugins)
    .where(eq(plugins.id, pluginId))
    .get();
  if (!row) throw new PluginError("plugin.not_found", `plugin ${pluginId} not installed`);

  const allowlist = parseAllowlist(row.adminAllowlist);

  let headers: Record<string, string> | undefined;
  if (row.adminHeadersIv && row.adminHeadersEncrypted) {
    const decoded = (await decryptJson(row.adminHeadersIv, row.adminHeadersEncrypted)) as unknown;
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
      headers = {};
      for (const [name, value] of Object.entries(decoded as Record<string, unknown>)) {
        if (typeof value === "string") headers[name] = value;
      }
      if (Object.keys(headers).length === 0) headers = undefined;
    }
  }

  cache.set(pluginId, { allowlist, headers });
  return { adminAllowlist: allowlist, adminHeaders: headers };
}

/**
 * Persists the admin-set allowlist. `null` clears the override so the plugin
 * reverts to manifest-only behaviour. Lowercasing is applied before write so
 * later comparisons are case-insensitive.
 */
export async function setAdminAllowlist(
  pluginId: string,
  allowlist: string[] | null,
): Promise<void> {
  const db = getDb();
  const serialized =
    allowlist === null ? null : JSON.stringify(allowlist.map((entry) => entry.toLowerCase()));
  const result = await db
    .update(plugins)
    .set({ adminAllowlist: serialized, updatedAt: Date.now() })
    .where(eq(plugins.id, pluginId))
    .returning({ id: plugins.id });
  if (result.length === 0) {
    throw new PluginError("plugin.not_found", `plugin ${pluginId} not installed`);
  }
  invalidatePluginPolicy(pluginId);
}

/**
 * Lists configured admin header names for a plugin (no values). Used by the
 * admin UI to render the configured-headers table without round-tripping
 * decrypted values.
 */
export async function listAdminHeaderNames(pluginId: string): Promise<string[]> {
  const { adminHeaders } = await loadPluginPolicy(pluginId);
  return adminHeaders ? Object.keys(adminHeaders).sort() : [];
}

/**
 * Merges a partial headers patch into the stored map, applying the
 * `x-secret`-style semantics: omitted keys preserve, `null` deletes, strings
 * replace. Reserved header names are rejected — the shared schema already
 * validates these, but we double-check so the runtime layer can't be bypassed
 * by a direct service call.
 */
export async function updateAdminHeaders(
  pluginId: string,
  patch: Record<string, string | null>,
): Promise<void> {
  const { adminHeaders: existing } = await loadPluginPolicy(pluginId);
  const next: Record<string, string> = { ...existing };

  for (const [name, value] of Object.entries(patch)) {
    const lower = name.toLowerCase();
    if ((PLUGIN_RESERVED_HEADER_NAMES as readonly string[]).includes(lower)) {
      throw new PluginError("plugin.input_invalid", `header ${name} is reserved by the runtime`);
    }
    if (value === null) {
      delete next[name];
    } else {
      next[name] = value;
    }
  }

  const db = getDb();
  if (Object.keys(next).length === 0) {
    await db
      .update(plugins)
      .set({
        adminHeadersEncrypted: null,
        adminHeadersIv: null,
        updatedAt: Date.now(),
      })
      .where(eq(plugins.id, pluginId));
  } else {
    const { iv, data } = await encryptJson(next);
    await db
      .update(plugins)
      .set({
        adminHeadersEncrypted: data,
        adminHeadersIv: iv,
        updatedAt: Date.now(),
      })
      .where(eq(plugins.id, pluginId));
  }
  invalidatePluginPolicy(pluginId);
}
