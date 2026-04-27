import { consola } from "consola";
import { pluginRuntime } from "../plugin-runtime/runtime";
import { capabilityRegistry } from "../plugin-runtime/registry";
import { harvestIds } from "./id-resolver";
import { type InvocationOutcome, normalizeError } from "./errors";
import type { ResolvedConnection } from "./resolve-connection";
import {
  persistRefreshedCredentials,
  markConnectionStatus,
  emitAuthExpired,
} from "./connection-lifecycle";

export interface InvokeRequest {
  userId: string;
  pluginId: string;
  capability: string;
  version: string;
  method: string;
  input: unknown;
  timeoutMs: number;
}

type RetryDecision = "refresh" | "rate-limit" | "transient" | "fail";

interface RetryState {
  triedRefresh: boolean;
  triedRateLimit: boolean;
  triedTransient: boolean;
  isUserConnection: boolean;
}

function decideRetry(errorCode: string, state: RetryState): RetryDecision {
  if (errorCode === "plugin.token_expired" && !state.triedRefresh && state.isUserConnection) {
    return "refresh";
  }
  if (errorCode === "plugin.rate_limited" && !state.triedRateLimit) {
    return "rate-limit";
  }
  if (
    (errorCode === "plugin.upstream_error" || errorCode === "plugin.timeout") &&
    !state.triedTransient
  ) {
    return "transient";
  }
  return "fail";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps `pluginRuntime.invoke` with a timeout. Timeouts surface as `timeout`,
 * treated like `transient_network` for retry purposes.
 */
export async function invokeWithTimeout<T>(
  req: InvokeRequest,
  conn: ResolvedConnection,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`plugin call timed out after ${req.timeoutMs}ms`);
      err.name = "AbortError";
      reject(err);
    }, req.timeoutMs);
  });
  try {
    return (await Promise.race([
      pluginRuntime.invokeWithCredentials<T>({
        pluginId: req.pluginId,
        capability: req.capability,
        version: req.version,
        method: req.method,
        input: req.input,
        userId: req.userId,
        credentials: conn.credentials,
        userConfig: conn.kind === "user" ? conn.userConfig : null,
      }),
      timeoutPromise,
    ])) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Invokes a single plugin with retry/refresh logic:
 *   • `token_expired` → refresh credentials, retry once.
 *   • `rate_limited`  → 2s backoff, retry once.
 *   • `transient_network` / `timeout` → 1s backoff, retry once.
 * Other codes propagate immediately as an outcome error.
 */
export async function invokeOne<T>(
  req: InvokeRequest,
  conn: ResolvedConnection,
): Promise<InvocationOutcome<T>> {
  let activeConn = conn;
  const state: RetryState = {
    triedRefresh: false,
    triedRateLimit: false,
    triedTransient: false,
    isUserConnection: conn.kind === "user",
  };

  while (true) {
    try {
      const data = await invokeWithTimeout<T>(req, activeConn);
      return {
        pluginId: req.pluginId,
        connectionId: conn.kind === "user" ? conn.connectionId : null,
        shared: conn.kind === "shared",
        data,
      };
    } catch (err) {
      const normalized = normalizeError(err);
      const decision = decideRetry(normalized.code, state);

      if (decision === "refresh" && conn.kind === "user") {
        state.triedRefresh = true;
        try {
          const refreshed = await pluginRuntime.refreshAuth(
            req.pluginId,
            req.userId,
            activeConn.credentials,
          );
          await persistRefreshedCredentials(conn.connectionId, refreshed);
          activeConn = { ...activeConn, credentials: refreshed };
          continue;
        } catch (refreshErr) {
          const refreshMsg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
          await markConnectionStatus(conn.connectionId, "expired", refreshMsg);
          await emitAuthExpired({
            connectionId: conn.connectionId,
            pluginId: req.pluginId,
            userId: req.userId,
          });
          return {
            pluginId: req.pluginId,
            connectionId: conn.connectionId,
            shared: false,
            error: { code: "plugin.token_expired", devMessage: refreshMsg },
          };
        }
      }

      if (decision === "rate-limit") {
        state.triedRateLimit = true;
        await sleep(2_000);
        continue;
      }

      if (decision === "transient") {
        state.triedTransient = true;
        await sleep(1_000);
        continue;
      }

      if (
        normalized.code === "plugin.bad_credentials" ||
        normalized.code === "plugin.upstream_error"
      ) {
        await markConnectionStatus(
          conn.kind === "user" ? conn.connectionId : null,
          "error",
          normalized.devMessage,
        );
      }
      return {
        pluginId: req.pluginId,
        connectionId: conn.kind === "user" ? conn.connectionId : null,
        shared: conn.kind === "shared",
        error: normalized,
      };
    }
  }
}

/**
 * Harvests opportunistic id_map entries from any successful outcome. Best-effort;
 * failures are swallowed (harvestIds logs internally).
 */
export async function harvestFromOutcomes(
  outcomes: Array<InvocationOutcome<unknown>>,
  mediaType?: "movie" | "tv",
): Promise<void> {
  const installed = new Set(capabilityRegistry.all().map((e) => e.pluginId));
  for (const outcome of outcomes) {
    if (!outcome.data) continue;
    try {
      await harvestIds(
        outcome.data,
        { pluginId: outcome.pluginId, installedPlugins: installed },
        mediaType,
      );
    } catch (err) {
      consola.debug(`[dispatcher] harvestIds failed for ${outcome.pluginId}`, err);
    }
  }
}
