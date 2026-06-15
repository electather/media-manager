import { eq } from "drizzle-orm";
import type { PersonalKeyFallbackPolicy } from "@nama/shared/plugins";
import { getDb } from "../../db/client";
import { plugins } from "../../db/schema/plugin-runtime/plugins";

/**
 * Minimal projection of a `plugins` row that the service needs during
 * bootstrap. Mapped to a plain type so drizzle row shapes stay below the repo
 * barrier.
 */
export interface InstalledPluginRow {
  enabled: number;
  checksum: string;
  version: string;
}

/** Values used to insert a freshly-discovered builtin plugin. */
export interface InsertBuiltinValues {
  id: string;
  version: string;
  checksum: string;
  manifest: string;
  now: number;
}

/** Returns the install state for a plugin, or `null` when it is not installed. */
export async function findInstalledPlugin(id: string): Promise<InstalledPluginRow | null> {
  const db = getDb();
  const row = await db
    .select({
      enabled: plugins.enabled,
      checksum: plugins.checksum,
      version: plugins.version,
    })
    .from(plugins)
    .where(eq(plugins.id, id))
    .get();
  return row ?? null;
}

/** Inserts a builtin plugin row, marking it enabled. */
export async function insertBuiltin(values: InsertBuiltinValues): Promise<void> {
  const db = getDb();
  await db.insert(plugins).values({
    id: values.id,
    version: values.version,
    sourceUrl: `builtin:${values.id}`,
    sourceType: "builtin",
    checksum: values.checksum,
    manifest: values.manifest,
    enabled: 1,
    installedAt: values.now,
    updatedAt: values.now,
  });
}

/** Refreshes a builtin's version, checksum, and manifest after a code change. */
export async function updateBuiltin(values: {
  id: string;
  version: string;
  checksum: string;
  manifest: string;
  now: number;
}): Promise<void> {
  const db = getDb();
  await db
    .update(plugins)
    .set({
      version: values.version,
      checksum: values.checksum,
      manifest: values.manifest,
      updatedAt: values.now,
    })
    .where(eq(plugins.id, values.id));
}

/** Toggles a plugin's enabled flag. */
export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const db = getDb();
  await db
    .update(plugins)
    .set({ enabled: enabled ? 1 : 0, updatedAt: Date.now() })
    .where(eq(plugins.id, id));
}

/** Deletes a plugin row. */
export async function deletePlugin(id: string): Promise<void> {
  const db = getDb();
  await db.delete(plugins).where(eq(plugins.id, id));
}

/** Persists a plugin's serialized global config (or clears it when `null`). */
export async function setGlobalConfig(id: string, configJson: string | null): Promise<void> {
  const db = getDb();
  await db
    .update(plugins)
    .set({ globalConfig: configJson, updatedAt: Date.now() })
    .where(eq(plugins.id, id));
}

/** Reads a plugin's raw serialized global config, or `null` when unset/uninstalled. */
export async function getGlobalConfigJson(id: string): Promise<string | null> {
  const db = getDb();
  const row = await db
    .select({ globalConfig: plugins.globalConfig })
    .from(plugins)
    .where(eq(plugins.id, id))
    .get();
  return row?.globalConfig ?? null;
}

/** Persists a plugin's personal-key fallback policy. */
export async function setPersonalKeyFallback(
  id: string,
  policy: PersonalKeyFallbackPolicy,
): Promise<void> {
  const db = getDb();
  await db
    .update(plugins)
    .set({ personalKeyFallback: policy, updatedAt: Date.now() })
    .where(eq(plugins.id, id));
}
