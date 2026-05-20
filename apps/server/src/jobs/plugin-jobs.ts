import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { serviceConnections } from "../db/schema";
import { selectEnabledPlugins } from "../db/queries";
import { encryptJson, decryptJson } from "../crypto/helpers";
// fallow-allow: phase-2 infra-to-module decoupling
// fallow-ignore-next-line boundary-violation
import { capabilityRegistry, pluginRuntime } from "../plugin-runtime";
import { isPluginError, type PluginJobHandler } from "@ent-mcp/plugin-sdk";
import type { ManifestJobEntry } from "@ent-mcp/shared/plugins";
import { registerScheduled } from "./scheduled";
import { registerScheduledPerRow } from "./scheduled-per-row";

// Default backoff for `plugin.rate_limited` errors that lack a retryAfterMs hint.
const DEFAULT_JOB_RATE_LIMIT_RETRY_SEC = 5 * 60;
// Upper bound applied to whatever `retryAfterMs` a plugin reports, so a buggy
// or malicious plugin throwing `retryAfterMs = Number.MAX_SAFE_INTEGER` cannot
// park a connection permanently. Matches the per-plugin 1h ceilings.
const MAX_JOB_RATE_LIMIT_RETRY_SEC = 60 * 60;

interface DeclaredPluginJob {
  pluginId: string;
  pluginName: string;
  id: string;
  schedule: string;
  handler: string;
  perConnection: boolean;
  perRowTimeoutSec?: number;
}

function extractDeclaredJobsFromRow(row: { id: string; manifest: string }): DeclaredPluginJob[] {
  const manifest = JSON.parse(row.manifest) as {
    name?: string;
    jobs?: ManifestJobEntry[];
  };
  const pluginName = manifest.name ?? row.id;
  return (manifest.jobs ?? []).map((job) => {
    const perConnection = job.perConnection === true;
    return {
      pluginId: row.id,
      pluginName,
      id: job.id,
      schedule: job.schedule,
      handler: job.handler,
      perConnection,
      // Only propagate the override on perConnection jobs — the global path
      // ignores it and carrying it would mask a manifest-validation bug.
      perRowTimeoutSec: perConnection ? job.perRowTimeoutSec : undefined,
    };
  });
}

/** Returns every declared job across all enabled plugins. */
export async function listAllPluginJobs(): Promise<DeclaredPluginJob[]> {
  const rows = await selectEnabledPlugins();
  return rows.flatMap(extractDeclaredJobsFromRow);
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
    // fallow-ignore-next-line complexity
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
  retryAfter: number | null;
}

function registerPerConnectionJob(job: DeclaredPluginJob): void {
  registerScheduledPerRow<ConnectionRow>({
    id: `plugin.${job.pluginId}.${job.id}`,
    name: `${job.pluginName} — ${job.id} (per connection)`,
    schedule: job.schedule,
    capture: { source: "plugin", pluginId: job.pluginId },
    perRowTimeoutSec: job.perRowTimeoutSec,
    rowSource: async () => {
      const db = getDb();
      const nowSec = Math.floor(Date.now() / 1000);
      const rows = await db
        .select({
          id: serviceConnections.id,
          userId: serviceConnections.userId,
          pluginId: serviceConnections.pluginId,
          userConfig: serviceConnections.userConfig,
          encryptedCredentials: serviceConnections.encryptedCredentials,
          credentialsIv: serviceConnections.credentialsIv,
          retryAfter: serviceConnections.retryAfter,
        })
        .from(serviceConnections)
        .where(eq(serviceConnections.pluginId, job.pluginId))
        .all();
      // Skip rows still inside an upstream-imposed cooldown window. `retryAfter`
      // is epoch-seconds, set by `invokePerConnectionHandler` below whenever a
      // job handler throws `plugin.rate_limited`. Without this, a per-connection
      // refresh job storms the upstream every tick after the first 429.
      return rows.filter((row) => row.retryAfter === null || row.retryAfter <= nowSec);
    },
    // fallow-ignore-next-line complexity
    handler: async (_ctx, row) => {
      const entry = capabilityRegistry.get(job.pluginId);
      if (!entry || !entry.enabled) return;
      const fn = entry.module.jobs?.[job.handler];
      if (typeof fn !== "function") return;

      await invokePerConnectionHandler({ job, row, handler: fn });
    },
  });
}

// fallow-ignore-next-line complexity
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
    if (isPluginError(err) && err.code === "plugin.rate_limited") {
      // Upstream told us to back off (e.g. Trakt OAuth 429). The connection is
      // healthy — only the next refresh attempt needs to wait. Park `retryAfter`
      // so the rowSource filter skips this connection until the window passes,
      // and leave `status` alone so the UI does not flag a non-existent error.
      const retryAfterMs = typeof err.retryAfterMs === "number" ? err.retryAfterMs : null;
      const retryAfterSec =
        retryAfterMs !== null && retryAfterMs >= 0
          ? Math.min(Math.ceil(retryAfterMs / 1000), MAX_JOB_RATE_LIMIT_RETRY_SEC)
          : DEFAULT_JOB_RATE_LIMIT_RETRY_SEC;
      const nowSec = Math.floor(Date.now() / 1000);
      await db
        .update(serviceConnections)
        .set({
          lastExhaustedAt: nowSec,
          retryAfter: nowSec + retryAfterSec,
          updatedAt: Date.now(),
        })
        .where(eq(serviceConnections.id, row.id));
      return;
    }
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
