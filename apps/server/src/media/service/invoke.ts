import { consola } from "consola";
import { pluginRuntime, capabilityRegistry } from "../../plugin-runtime";
import { harvestIds } from "./id-resolver";
import { type InvocationOutcome, normalizeError, TRANSIENT_PLUGIN_CODES } from "../errors";
import type { ResolvedConnection } from "../internal/resolve-connection";
import {
  refreshConnectionCredentials,
  markConnectionStatus,
  emitAuthExpired,
} from "./connection-lifecycle";
import { isNil } from "es-toolkit/predicate";

export interface InvokeRequest {
  userId: string;
  pluginId: string;
  capability: string;
  version: string;
  method: string;
  input: unknown;
  timeoutMs: number;
  /**
   * Wall-clock deadline in ms-epoch. When set, the rate-limit / transient
   * retry path skips its backoff sleep if the remaining budget is shorter
   * than the planned backoff plus a small call buffer. Caller (layout
   * orchestrator) sets this so a slow first call cannot cascade into a
   * timeout that drops the whole row from the response.
   */
  deadlineMs?: number;
}

type RetryDecision = "refresh" | "rate-limit" | "transient" | "fail";

interface RetryState {
  triedRefresh: boolean;
  triedRateLimit: boolean;
  triedTransient: boolean;
  isUserConnection: boolean;
}

const RATE_LIMIT_BACKOFF_MS = 2_000;
const TRANSIENT_BACKOFF_MS = 1_000;
// Bare-minimum headroom for the retry call itself once the backoff sleep
// elapses. Anything tighter would land us back in the same timeout that
// motivated #135.
const RETRY_CALL_BUFFER_MS = 200;

// fallow-ignore-next-line complexity
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

function deadlineAllowsRetry(deadlineMs: number | undefined, backoffMs: number): boolean {
  if (isNil(deadlineMs)) return true;
  const remaining = deadlineMs - Date.now();
  return remaining >= backoffMs + RETRY_CALL_BUFFER_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// When the caller-supplied `deadlineMs` budget would force a timer below this
// floor, the call short-circuits to a synthetic AbortError instead of arming a
// near-zero timer. Anything tighter just races the event loop and produces
// noisy timeouts without giving the plugin a real chance to respond.
const DEADLINE_SHORT_CIRCUIT_MS = 50;

function abortError(message: string): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function createTimeoutHandle(
  effectiveMs: number,
  capMs: number,
): { promise: Promise<never>; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(abortError(`plugin call timed out after ${effectiveMs}ms (cap ${capMs}ms)`)),
      effectiveMs,
    );
  });
  return {
    promise,
    clear: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

function buildInvokeArgs<T>(
  req: InvokeRequest,
  conn: ResolvedConnection,
): Parameters<typeof pluginRuntime.invokeWithCredentials<T>>[0] {
  return {
    pluginId: req.pluginId,
    capability: req.capability,
    version: req.version,
    method: req.method,
    input: req.input,
    userId: req.userId,
    credentials: conn.credentials,
    userConfig: conn.kind === "user" ? conn.userConfig : null,
  };
}

/**
 * Wraps `pluginRuntime.invoke` with a timeout. Timeouts surface as `timeout`,
 * treated like `transient_network` for retry purposes. When `req.deadlineMs`
 * is set, the effective timer is clipped to the remaining budget so a single
 * slow plugin call cannot consume the whole compose deadline.
 */
export async function invokeWithTimeout<T>(
  req: InvokeRequest,
  conn: ResolvedConnection,
): Promise<T> {
  const remaining = isNil(req.deadlineMs) ? Number.POSITIVE_INFINITY : req.deadlineMs - Date.now();
  // The short-circuit protects against an exhausted deadline budget, not a
  // small `timeoutMs`. Guard on `remaining` so a caller with no deadline and
  // a deliberately short `timeoutMs` (e.g. probes) still arms its own timer
  // instead of throwing `deadline_exceeded (remaining Infinityms)`.
  if (remaining < DEADLINE_SHORT_CIRCUIT_MS) {
    throw abortError(`deadline_exceeded (remaining ${remaining}ms)`);
  }
  const effectiveMs = Math.min(req.timeoutMs, remaining);
  const timeout = createTimeoutHandle(effectiveMs, req.timeoutMs);
  try {
    return (await Promise.race([
      pluginRuntime.invokeWithCredentials<T>(buildInvokeArgs<T>(req, conn)),
      timeout.promise,
    ])) as T;
  } finally {
    timeout.clear();
  }
}

function connectionId(conn: ResolvedConnection): string | null {
  return conn.kind === "user" ? conn.connectionId : null;
}

function successOutcome<T>(
  req: InvokeRequest,
  conn: ResolvedConnection,
  data: T,
): InvocationOutcome<T> {
  return {
    pluginId: req.pluginId,
    connectionId: connectionId(conn),
    shared: conn.kind === "shared",
    data,
  };
}

function errorOutcome<T>(
  req: InvokeRequest,
  conn: ResolvedConnection,
  error: { code: string; devMessage: string },
): InvocationOutcome<T> {
  return {
    pluginId: req.pluginId,
    connectionId: connectionId(conn),
    shared: conn.kind === "shared",
    error: error as InvocationOutcome<T>["error"],
  };
}

async function handleRefresh<T>(
  req: InvokeRequest,
  conn: ResolvedConnection,
  activeConn: ResolvedConnection,
  state: RetryState,
): Promise<{ refreshed: ResolvedConnection } | InvocationOutcome<T>> {
  // decideRetry only returns "refresh" when state.isUserConnection is true,
  // derived from conn.kind === "user" at construction time.
  const userConn = conn as Extract<ResolvedConnection, { kind: "user" }>;
  state.triedRefresh = true;
  try {
    const refreshed = await refreshConnectionCredentials({
      connectionId: userConn.connectionId,
      pluginId: req.pluginId,
      userId: req.userId,
      attemptedCredentials: activeConn.credentials,
    });
    return { refreshed: { ...activeConn, credentials: refreshed } };
  } catch (refreshErr) {
    const normalized = normalizeError(refreshErr);
    // Only a failure that reflects the refresh token's validity is terminal.
    // A transient refresh failure (Trakt rate-limiting `/oauth/token`, an
    // upstream 5xx, a timeout) says nothing about the token: marking the
    // connection expired and emitting an auth-expired notification there would
    // push the user to reconnect for no reason and re-fire on every retry.
    // Surface the real transient code and leave the connection intact so a
    // later call refreshes successfully once the condition clears.
    if (TRANSIENT_PLUGIN_CODES.has(normalized.code)) {
      return errorOutcome(req, conn, normalized);
    }
    await markConnectionStatus(userConn.connectionId, "expired", normalized.devMessage);
    await emitAuthExpired({
      connectionId: userConn.connectionId,
      pluginId: req.pluginId,
      userId: req.userId,
    });
    return {
      pluginId: req.pluginId,
      connectionId: userConn.connectionId,
      shared: false,
      error: { code: "plugin.token_expired", devMessage: normalized.devMessage },
    };
  }
}

async function handleBackoff(deadlineMs: number | undefined, backoffMs: number): Promise<boolean> {
  if (!deadlineAllowsRetry(deadlineMs, backoffMs)) return false;
  await sleep(backoffMs);
  return true;
}

async function handleTerminalError<T>(
  req: InvokeRequest,
  conn: ResolvedConnection,
  normalized: { code: string; devMessage: string },
): Promise<InvocationOutcome<T>> {
  // Only persist a terminal status for genuinely non-recoverable codes.
  // Transient codes (upstream_error, rate_limited, timeout) reflect a
  // temporary outage: writing "error" would permanently degrade the connection
  // in the UI for a blip that will self-heal. Mirror the same guard already
  // applied in handleRefresh, where transient refresh failures explicitly avoid
  // degrading the connection.
  if (normalized.code === "plugin.bad_credentials") {
    await markConnectionStatus(connectionId(conn), "error", normalized.devMessage);
  }
  return errorOutcome(req, conn, normalized);
}

/**
 * Invokes a single plugin with retry/refresh logic:
 *   • `token_expired` → refresh credentials, retry once.
 *   • `rate_limited`  → 2s backoff, retry once.
 *   • `transient_network` / `timeout` → 1s backoff, retry once.
 * Other codes propagate immediately as an outcome error.
 */
// fallow-ignore-next-line complexity
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
      return successOutcome(req, conn, data);
    } catch (err) {
      const normalized = normalizeError(err);
      const decision = decideRetry(normalized.code, state);

      if (decision === "refresh") {
        const result = await handleRefresh<T>(req, conn, activeConn, state);
        if ("refreshed" in result) {
          activeConn = result.refreshed;
          continue;
        }
        return result;
      }

      if (decision === "rate-limit") {
        state.triedRateLimit = true;
        const canRetry = await handleBackoff(req.deadlineMs, RATE_LIMIT_BACKOFF_MS);
        if (!canRetry) return errorOutcome(req, conn, normalized);
        continue;
      }

      if (decision === "transient") {
        state.triedTransient = true;
        const canRetry = await handleBackoff(req.deadlineMs, TRANSIENT_BACKOFF_MS);
        if (!canRetry) return errorOutcome(req, conn, normalized);
        continue;
      }

      return handleTerminalError(req, conn, normalized);
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
