import type { HostErrorCode } from "@nama/shared/diagnostics";
import { isPluginError } from "@nama/plugin-sdk";
import { HttpError } from "../diagnostics/http-errors";

/**
 * Error codes for transient/retryable conditions. Two dispatcher decisions use this:
 * (1) Token refresh failures don't degrade the connection (see `invoke.ts` `handleRefresh`).
 * (2) Aggregate with ALL providers failing these soft-degrades to empty partial instead of throwing `AllPluginsFailedError`.
 */
export const TRANSIENT_PLUGIN_CODES = new Set<HostErrorCode>([
  "plugin.rate_limited",
  "plugin.upstream_error",
  "plugin.timeout",
]);

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
 * Thrown when every contributing plugin fails. Home feed downgrades to `partial: true`.
 * Other callers get 503 `media.providers_failed` with `errors[]` in details for per-provider hints.
 */
export class AllPluginsFailedError extends HttpError {
  constructor(
    public readonly capability: string,
    public readonly errors: ReadonlyArray<{
      pluginId: string;
      code: HostErrorCode;
      devMessage?: string;
    }>,
  ) {
    super(503, "media.providers_failed", `every provider for ${capability} errored`, undefined, {
      errors,
    });
    this.name = "AllPluginsFailedError";
  }
}

/**
 * Maps `PluginCallError` from `mediaRequest@v1` dispatch to HTTP error envelope.
 * Returns `null` for non-`PluginCallError` or unmapped codes so callers can rethrow.
 */
// fallow-ignore-next-line complexity
export function mapRequestPluginError(err: unknown): HttpError | null {
  if (!(err instanceof PluginCallError)) return null;
  if (err.code === "mcp.target_not_found") {
    return new HttpError(404, "request.unknown_service", "service not found");
  }
  if (err.code === "media.no_connection") {
    return new HttpError(404, "request.no_provider", "no mediaRequest provider configured");
  }
  if (
    err.code === "plugin.input_invalid" ||
    err.code === "plugin.upstream_error" ||
    err.code === "plugin.timeout"
  ) {
    return new HttpError(502, "request.provider_failed", err.message);
  }
  return null;
}

/** Normalizes a thrown value into a canonical `{ code, devMessage }` pair. */
// fallow-ignore-next-line complexity
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
