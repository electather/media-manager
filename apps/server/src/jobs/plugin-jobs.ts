import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { plugins, serviceConnections } from "../db/schema";
import { encryptJson, decryptJson } from "../crypto/helpers";
import { capabilityRegistry } from "../plugin-runtime/registry";
import { pluginRuntime } from "../plugin-runtime/runtime";
import type { PluginJobHandler } from "@ent-mcp/plugin-sdk";
import { registerScheduled } from "./scheduled";
import { registerScheduledPerRow } from "./scheduled-per-row";

interface DeclaredPluginJob {
  pluginId: string;
  pluginName: string;
  id: string;
  schedule: string;
  handler: string;
  perConnection: boolean;
}

/** Returns every declared job across all enabled plugins. */
export async function listAllPluginJobs(): Promise<DeclaredPluginJob[]> {
  const db = getDb();
  const rows = await db.select().from(plugins).where(eq(plugins.enabled, 1)).all();
  const out: DeclaredPluginJob[] = [];
  for (const row of rows) {
    const manifest = JSON.parse(row.manifest) as {
      name?: string;
      jobs?: Array<{ id: string; schedule: string; handler: string; perConnection?: boolean }>;
    };
    const pluginName = manifest.name ?? row.id;
    for (const job of manifest.jobs ?? []) {
      out.push({
        pluginId: row.id,
        pluginName,
        id: job.id,
        schedule: job.schedule,
        handler: job.handler,
        perConnection: job.perConnection === true,
      });
    }
  }
  return out;
}

/** Registers every declared plugin job with the job service. Called at startup. */
export async function registerAllPluginJobs(): Promise<number> {
  const declared = await listAllPluginJobs();
  for (const job of declared) {
    if (job.perConnection) {
      registerPerConnectionJob(job);
    } else {
      registerGlobalPluginJob(job);
    }
  }
  return declared.length;
}

function registerGlobalPluginJob(job: DeclaredPluginJob): void {
  registerScheduled({
    id: `plugin.${job.pluginId}.${job.id}`,
    name: `${job.pluginName} — ${job.id}`,
    schedule: job.schedule,
    capture: { source: "plugin", pluginId: job.pluginId },
    handler: async () => {
      const entry = capabilityRegistry.get(job.pluginId);
      if (!entry || !entry.enabled) return;
      const fn = entry.module.jobs?.[job.handler];
      if (typeof fn !== "function") return;
      const ctx = await pluginRuntime.buildJobContext(job.pluginId, null, null, null);
      await fn(ctx);
    },
  });
}

interface ConnectionRow {
  id: string;
  userId: string;
  pluginId: string;
  userConfig: string | null;
  encryptedCredentials: string | null;
  credentialsIv: string | null;
}

function registerPerConnectionJob(job: DeclaredPluginJob): void {
  registerScheduledPerRow<ConnectionRow>({
    id: `plugin.${job.pluginId}.${job.id}`,
    name: `${job.pluginName} — ${job.id} (per connection)`,
    schedule: job.schedule,
    capture: { source: "plugin", pluginId: job.pluginId },
    rowSource: async () => {
      const db = getDb();
      return db
        .select({
          id: serviceConnections.id,
          userId: serviceConnections.userId,
          pluginId: serviceConnections.pluginId,
          userConfig: serviceConnections.userConfig,
          encryptedCredentials: serviceConnections.encryptedCredentials,
          credentialsIv: serviceConnections.credentialsIv,
        })
        .from(serviceConnections)
        .where(eq(serviceConnections.pluginId, job.pluginId))
        .all();
    },
    handler: async (_ctx, row) => {
      const entry = capabilityRegistry.get(job.pluginId);
      if (!entry || !entry.enabled) return;
      const fn = entry.module.jobs?.[job.handler];
      if (typeof fn !== "function") return;

      await invokePerConnectionHandler({ job, row, handler: fn });
    },
  });
}

async function invokePerConnectionHandler(args: {
  job: DeclaredPluginJob;
  row: ConnectionRow;
  handler: PluginJobHandler;
}): Promise<void> {
  const { job, row, handler } = args;
  const db = getDb();
  try {
    const credentials = await decryptJson(row.credentialsIv, row.encryptedCredentials);
    const userConfig = row.userConfig ? (JSON.parse(row.userConfig) as unknown) : null;
    const ctx = await pluginRuntime.buildJobContext(
      job.pluginId,
      row.userId,
      credentials,
      userConfig,
    );
    const result = await handler(ctx);
    if (result) {
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
    await db
      .update(serviceConnections)
      .set({
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
        updatedAt: Date.now(),
      })
      .where(eq(serviceConnections.id, row.id));
    throw err;
  }
}
