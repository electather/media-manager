import { eq } from "drizzle-orm";
import { consola } from "consola";
import { getDb } from "../db/client";
import { plugins, serviceConnections } from "../db/schema";
import { env } from "../env";
import { encrypt, decrypt } from "../crypto/vault";
import { capabilityRegistry } from "../plugin-runtime/registry";
import { pluginRuntime } from "../plugin-runtime/runtime";

function split(combined: string): { iv: string; data: string } {
  const [iv, ...rest] = combined.split(":");
  if (!iv || rest.length === 0) throw new Error("invalid ciphertext");
  return { iv, data: rest.join(":") };
}

async function encryptJson(value: unknown): Promise<{ iv: string; data: string }> {
  const combined = await encrypt(JSON.stringify(value), env.ENCRYPTION_KEY);
  return split(combined);
}

async function decryptJson(iv: string | null, data: string | null): Promise<unknown> {
  if (!iv || !data) return null;
  const plain = await decrypt(`${iv}:${data}`, env.ENCRYPTION_KEY);
  try {
    return JSON.parse(plain);
  } catch {
    return plain;
  }
}

/**
 * Runs one declared plugin job. For per-connection jobs, iterates every connection
 * for the plugin. For plugin-global jobs, runs once with a user-less context.
 */
export async function runPluginJob(pluginId: string, jobHandler: string): Promise<void> {
  const entry = capabilityRegistry.get(pluginId);
  if (!entry || !entry.enabled) return;
  const fn = entry.module.jobs?.[jobHandler];
  if (typeof fn !== "function") return;

  const job = (entry.module.manifest.jobs ?? []).find((j) => j.handler === jobHandler);
  if (!job) return;

  if (job.perConnection) {
    const db = getDb();
    const rows = await db
      .select()
      .from(serviceConnections)
      .where(eq(serviceConnections.pluginId, pluginId))
      .all();
    for (const row of rows) {
      try {
        const credentials = await decryptJson(row.credentialsIv, row.encryptedCredentials);
        const userConfig = await decryptJson(row.userConfigIv, row.encryptedUserConfig);
        const ctx = await pluginRuntime.buildContextForInvocation(
          pluginId,
          row.userId,
          credentials,
          userConfig,
        );
        const result = await fn(ctx);
        if (result) {
          // Handlers that return a value convey new credentials; host re-encrypts.
          const enc = await encryptJson(result);
          await db
            .update(serviceConnections)
            .set({
              encryptedCredentials: enc.data,
              credentialsIv: enc.iv,
              updatedAt: Date.now(),
            })
            .where(eq(serviceConnections.id, row.id));
        }
      } catch (err) {
        consola.error(`[plugin-job:${pluginId}.${jobHandler}] connection ${row.id} failed`, err);
        await getDb()
          .update(serviceConnections)
          .set({
            status: "error",
            errorMessage: err instanceof Error ? err.message : String(err),
            updatedAt: Date.now(),
          })
          .where(eq(serviceConnections.id, row.id));
      }
    }
  } else {
    try {
      const ctx = await pluginRuntime.buildContextForInvocation(pluginId, null, null, null);
      await fn(ctx);
    } catch (err) {
      consola.error(`[plugin-job:${pluginId}.${jobHandler}] failed`, err);
    }
  }
}

/** Returns every declared job across all enabled plugins. */
export async function listAllPluginJobs(): Promise<
  Array<{ pluginId: string; id: string; schedule: string; handler: string }>
> {
  const db = getDb();
  const rows = await db.select().from(plugins).where(eq(plugins.enabled, 1)).all();
  const out: Array<{ pluginId: string; id: string; schedule: string; handler: string }> = [];
  for (const row of rows) {
    const manifest = JSON.parse(row.manifest) as {
      jobs?: Array<{ id: string; schedule: string; handler: string }>;
    };
    for (const job of manifest.jobs ?? []) {
      out.push({ pluginId: row.id, id: job.id, schedule: job.schedule, handler: job.handler });
    }
  }
  return out;
}
