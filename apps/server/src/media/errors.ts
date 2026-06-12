import type { HostErrorCode } from "@nama/shared/diagnostics";
import { isPluginError } from "@nama/plugin-sdk";
import { HttpError } from "../diagnostics/http-errors";

/**
 * Plugin error codes that reflect a transient/retryable condition rather than a
 * terminal one. Two dispatcher decisions key off this set:
 *   - A token refresh failing with one of these must NOT degrade the connection
 *     or emit an auth-expired notification (see `invoke.ts` `handleRefresh`) —
 *     e.g. Trakt rate-limits `/oauth/token` independent of token validity.
 *   - An aggregate where EVERY provider failed with one of these soft-degrades
 *     to an empty partial result instead of throwing `AllPluginsFailedError`
 *     (see `interpretAggregate`): the data is temporarily unavailable, not gone.
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
 * Thrown by aggregate `MediaService` methods when every contributing plugin
 * returned an error. The home feed orchestrator catches this and downgrades
 * the affected row to `partial: true` with an empty page so the surface
 * stays visible. For any other caller it escapes to `errorHandler` as a
 * 503 `media.providers_failed` with the per-provider `errors[]` exposed in
 * `details`, so the client can render per-provider hints instead of a
 * generic 500.
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
 * Maps a `PluginCallError` thrown by a `mediaRequest@v1` dispatch to the
 * request-flow HTTP error envelope. Returns `null` for non-`PluginCallError`
 * inputs and for `PluginCallError` codes outside the documented map so
 * callers can rethrow.
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
