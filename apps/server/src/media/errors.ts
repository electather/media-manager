import type { HostErrorCode } from "@ent-mcp/shared/errors";
import { isPluginError } from "@ent-mcp/plugin-sdk";

/**
 * Result of a single plugin invocation at the dispatcher layer. Keeps errors as
 * structured data rather than thrown exceptions so fan-out can aggregate them.
 */
export interface InvocationOutcome<T = unknown> {
  pluginId: string;
  connectionId: string | null;
  /** `true` when a shared-credentials fallback was used. */
  shared: boolean;
  data?: T;
  error?: { code: HostErrorCode; devMessage: string };
}

/**
 * Typed error thrown by `single`-strategy dispatch when the sole call fails.
 * Callers catch this and surface `.code` directly.
 */
export class PluginCallError extends Error {
  constructor(
    public readonly code: HostErrorCode,
    message: string,
    public readonly pluginId: string,
    public readonly connectionId: string | null,
  ) {
    super(message);
    this.name = "PluginCallError";
  }
}

/**
 * Thrown by aggregate `MediaService` methods when every contributing plugin
 * returned an error. Callers (today: the home feed orchestrator) catch this
 * to mark a row's `FetchOutcome` as `all_failed`, distinct from a genuine
 * empty fetch where every plugin succeeded but had nothing to contribute.
 */
export class AllPluginsFailedError extends Error {
  constructor(
    public readonly capability: string,
    public readonly errors: ReadonlyArray<{ pluginId: string; code: HostErrorCode }>,
  ) {
    super(`every provider for ${capability} errored`);
    this.name = "AllPluginsFailedError";
  }
}

/** Normalizes a thrown value into a canonical `{ code, devMessage }` pair. */
export function normalizeError(err: unknown): { code: HostErrorCode; devMessage: string } {
  if (isPluginError(err)) {
    return { code: err.code as HostErrorCode, devMessage: err.message };
  }
  const devMessage = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && err.name === "AbortError") {
    return { code: "plugin.timeout", devMessage };
  }
  return { code: "plugin.upstream_error", devMessage };
}
