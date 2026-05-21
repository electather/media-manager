import { eq } from "drizzle-orm";
import { PLUGIN_ADMIN_HEADERS_MAX, PLUGIN_RESERVED_HEADER_NAMES } from "@ent-mcp/shared/plugins";
import { getDb } from "../../db/client";
import { plugins } from "../../db/schema/plugin-runtime/plugins";
import { decryptJson, encryptJson } from "../../crypto/helpers";
import { PluginError } from "@ent-mcp/plugin-sdk";

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

// Module-level cache. Not shared across cluster workers — a PUT on worker A
// invalidates A's cache only, so workers B/C serve stale decrypted headers
// until their own cache misses. Acceptable for single-process deployments and
// matches the `globalConfig` pattern. TODO: revisit when multi-worker mode
// lands.
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

// fallow-ignore-next-line complexity
async function decryptAdminHeaders(
  iv: string,
  encrypted: string,
): Promise<Record<string, string> | undefined> {
  const decoded = (await decryptJson(iv, encrypted)) as unknown;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return undefined;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(decoded as Record<string, unknown>)) {
    // Header names are stored and compared in lowercase so later edits and
    // deletes match regardless of the casing the admin supplied. Legacy
    // rows that predate this normalisation get canonicalised on read and
    // rewritten on the next update.
    if (typeof value === "string") headers[name.toLowerCase()] = value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Loads and caches the admin policy for a plugin. Decrypted headers live only
 * in the process-memory cache; the cache is invalidated by the admin-policy
 * write paths so a PUT immediately takes effect on the next invocation.
 */
// fallow-ignore-next-line complexity
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
  const headers =
    row.adminHeadersIv && row.adminHeadersEncrypted
      ? await decryptAdminHeaders(row.adminHeadersIv, row.adminHeadersEncrypted)
      : undefined;

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
 * Merges a partial headers patch into the stored map, applying the
 * `x-secret`-style semantics: omitted keys preserve, `null` deletes, strings
 * replace. Reserved header names are rejected — the shared schema already
 * validates these, but we double-check so the runtime layer can't be bypassed
 * by a direct service call.
 */
// fallow-ignore-next-line complexity
export async function updateAdminHeaders(
  pluginId: string,
  patch: Record<string, string | null>,
): Promise<void> {
  const { adminHeaders: existing } = await loadPluginPolicy(pluginId);
  // Rebuild `next` with lowercased keys so case-insensitive delete and update
  // work regardless of the casing the existing entry was first stored under.
  const next: Record<string, string> = {};
  for (const [name, value] of Object.entries(existing ?? {})) {
    next[name.toLowerCase()] = value;
  }

  for (const [name, value] of Object.entries(patch)) {
    const lower = name.toLowerCase();
    if ((PLUGIN_RESERVED_HEADER_NAMES as readonly string[]).includes(lower)) {
      throw new PluginError("plugin.input_invalid", `header ${name} is reserved by the runtime`);
    }
    if (value === null) {
      delete next[lower];
    } else {
      next[lower] = value;
    }
  }

  // The shared schema already bounds the patch size; re-check the stored total
  // so an admin can't bypass the ceiling by sending a sequence of small
  // additive patches.
  if (Object.keys(next).length > PLUGIN_ADMIN_HEADERS_MAX) {
    throw new PluginError(
      "plugin.input_invalid",
      `plugin ${pluginId} would exceed the maximum of ${PLUGIN_ADMIN_HEADERS_MAX} headers`,
    );
  }

  const db = getDb();
  const result =
    Object.keys(next).length === 0
      ? await db
          .update(plugins)
          .set({
            adminHeadersEncrypted: null,
            adminHeadersIv: null,
            updatedAt: Date.now(),
          })
          .where(eq(plugins.id, pluginId))
          .returning({ id: plugins.id })
      : await (async () => {
          const { iv, data } = await encryptJson(next);
          return db
            .update(plugins)
            .set({
              adminHeadersEncrypted: data,
              adminHeadersIv: iv,
              updatedAt: Date.now(),
            })
            .where(eq(plugins.id, pluginId))
            .returning({ id: plugins.id });
        })();
  if (result.length === 0) {
    throw new PluginError("plugin.not_found", `plugin ${pluginId} not installed`);
  }
  invalidatePluginPolicy(pluginId);
}
