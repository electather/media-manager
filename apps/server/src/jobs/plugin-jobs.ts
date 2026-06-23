import { consola } from "consola";
import { and, eq, isNull, lte, ne, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { serviceConnections } from "../db/schema";
import { markConnectionExhausted, parseUserConfig, selectEnabledPlugins } from "../db/queries";
import { decryptJson } from "../crypto/helpers";
import { captureError } from "../diagnostics/capture";
// fallow-allow: phase-2 infra-to-module decoupling
// fallow-ignore-next-line boundary-violation
import { capabilityRegistry, pluginRuntime } from "../plugin-runtime";
// fallow-ignore-next-line boundary-violation
import { emitAuthExpired, markConnectionStatus, persistRefreshedCredentials } from "../media";
import { isPluginError, type PluginJobHandler } from "@nama/plugin-sdk";
import { manifestJobEntrySchema } from "@nama/shared/plugins";
import type { ConnectionStatus } from "@nama/shared/connections";
import { registerScheduled } from "./scheduled";
import { registerScheduledPerRow } from "./scheduled-per-row";
import type { JobRunContext } from "./types";

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

// All-or-nothing: one bad job entry skips the whole plugin. Keep z.array(...) strict —
// no .catch() and no per-entry .optional() (the outer .optional() on jobs only allows the
// field to be absent; once present every entry must validate).
const manifestForJobsSchema = z.object({
  name: z.string().min(1).optional(),
  jobs: z.array(manifestJobEntrySchema).optional(),
});

function reportManifestInvalid(
  pluginId: string,
  stage: "json-parse" | "schema-validate",
  err: unknown,
): void {
  consola.error(`[plugin-jobs] manifest ${stage} failed for "${pluginId}"`, err);
  // Fire-and-forget: the diagnostic sink writes to the database, but startup
  // job registration must not block on it. An unhandled rejection here would
  // be a sink bug worth surfacing, not a startup failure.
  void captureError(err, {
    source: "cron",
    code: "cron.manifest_invalid",
    pluginId,
    context: { stage },
  });
}

type ParsedJobsManifest = z.infer<typeof manifestForJobsSchema>;
type ParsedJobEntry = z.infer<typeof manifestJobEntrySchema>;

function parseManifestForJobs(row: { id: string; manifest: string }): ParsedJobsManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.manifest);
  } catch (err) {
    reportManifestInvalid(row.id, "json-parse", err);
    return null;
  }
  const result = manifestForJobsSchema.safeParse(parsed);
  if (!result.success) {
    reportManifestInvalid(row.id, "schema-validate", result.error);
    return null;
  }
  return result.data;
}

function toDeclaredJob(
  pluginId: string,
  pluginName: string,
  job: ParsedJobEntry,
): DeclaredPluginJob {
  const perConnection = job.perConnection === true;
  return {
    pluginId,
    pluginName,
    id: job.id,
    schedule: job.schedule,
    handler: job.handler,
    perConnection,
    // Only propagate the override on perConnection jobs — the global path
    // ignores it and carrying it would mask a manifest-validation bug.
    perRowTimeoutSec: perConnection ? job.perRowTimeoutSec : undefined,
  };
}

function extractDeclaredJobsFromRow(row: { id: string; manifest: string }): DeclaredPluginJob[] {
  const manifest = parseManifestForJobs(row);
  if (!manifest) return [];
  const pluginName = manifest.name ?? row.id;
  return (manifest.jobs ?? []).map((job) => toDeclaredJob(row.id, pluginName, job));
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
  status: ConnectionStatus;
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
      // Skip rows inside cooldown (`retryAfter` epoch-seconds, set on `plugin.rate_limited`)
      // and terminal `expired` state (no auto recovery — user must reconnect). Predicates in SQL
      // so parked rows don't load credentials and expired rows don't burn upstream round-trips.
      return await db
        .select({
          id: serviceConnections.id,
          userId: serviceConnections.userId,
          pluginId: serviceConnections.pluginId,
          userConfig: serviceConnections.userConfig,
          encryptedCredentials: serviceConnections.encryptedCredentials,
          credentialsIv: serviceConnections.credentialsIv,
          status: serviceConnections.status,
          retryAfter: serviceConnections.retryAfter,
        })
        .from(serviceConnections)
        .where(
          and(
            eq(serviceConnections.pluginId, job.pluginId),
            ne(serviceConnections.status, "expired"),
            or(isNull(serviceConnections.retryAfter), lte(serviceConnections.retryAfter, nowSec)),
          ),
        )
        .all();
    },
    // fallow-ignore-next-line complexity
    handler: async (ctx, row) => {
      const entry = capabilityRegistry.get(job.pluginId);
      if (!entry || !entry.enabled) return;
      const fn = entry.module.jobs?.[job.handler];
      if (typeof fn !== "function") return;

      await invokePerConnectionHandler({ job, row, handler: fn, logger: ctx.logger });
    },
  });
}

// Exported for unit testing the connection-status routing in the catch path.
// fallow-ignore-next-line complexity
export async function invokePerConnectionHandler(args: {
  job: DeclaredPluginJob;
  row: ConnectionRow;
  handler: PluginJobHandler;
  logger: JobRunContext["logger"];
}): Promise<void> {
  const { job, row, handler, logger } = args;
  const db = getDb();
  try {
    const credentials = await decryptJson(row.credentialsIv, row.encryptedCredentials);
    if (credentials === null) {
      // Skip rows with no stored ciphertext (null iv or data). A null result
      // means no credentials were ever written; passing null to the plugin
      // handler would produce a silent unauthenticated invocation. Mirrors the
      // guard in plugin-runtime/internal/user-pool.ts.
      logger.warn("Skipping connection with missing credentials", {
        pluginId: job.pluginId,
        jobId: job.id,
        connectionId: row.id,
      });
      return;
    }
    const userConfig = parseUserConfig(row.userConfig, row.id);
    const ctx = await pluginRuntime.buildJobContext(
      job.pluginId,
      row.userId,
      credentials,
      userConfig,
    );
    const result = await handler(ctx);
    if (result) {
      // persistRefreshedCredentials clears the rate-limit cooldown too.
      await persistRefreshedCredentials(row.id, result);
    } else if (row.retryAfter !== null) {
      // Handler succeeded without rotating credentials. Still clear any prior
      // cooldown so a recovered connection does not carry a stale epoch.
      await db
        .update(serviceConnections)
        .set({ retryAfter: null, updatedAt: Date.now() })
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
      await markConnectionExhausted(row.id, retryAfterSec);
      logger.warn("Plugin connection rate-limited; parked until cooldown elapses", {
        pluginId: job.pluginId,
        jobId: job.id,
        connectionId: row.id,
        retryAfterSec,
      });
      return;
    }
    // Job path mirrors the capability-call path: token_expired → "expired", anything else → "error" (#423; docs/media-service.md §Q3).
    const expired = isPluginError(err) && err.code === "plugin.token_expired";
    const message = err instanceof Error ? err.message : String(err);
    await markConnectionStatus(row.id, expired ? "expired" : "error", message);
    // Emit only on first transition into "expired" — otherwise this fires every tick a revoked token is still revoked.
    if (expired && row.status !== "expired") {
      await emitAuthExpired({
        connectionId: row.id,
        pluginId: job.pluginId,
        userId: row.userId,
      });
    }
    throw err;
  }
}
