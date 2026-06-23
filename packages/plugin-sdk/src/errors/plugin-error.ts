import type { HostErrorCode } from "@nama/shared/diagnostics";

/**
 * Throwable error class for user-facing failures. Plugins can also throw a plain
 * `Error` with `name = "PluginError"` and `code` field — `isPluginError` is
 * duck-typed so both spellings work when a plugin is bundled separately.
 */
export class PluginError extends Error {
  constructor(
    public code: HostErrorCode,
    message: string,
    /**
     * Interpolation values and routing hints per the error design doc's wire format.
     * Threads onto the HTTP error body so the frontend can route the error
     * (e.g. `{ field: "externalServerUrl" }` attaches to a form input).
     */
    public params?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "PluginError";
  }
}

/** The structural shape that the host recognizes as a plugin error. */
export interface PluginErrorShape {
  name: "PluginError";
  code: string;
  message: string;
  params?: Record<string, string | number>;
  /**
   * `retryable`: explicit signal; delivery job honors it instead of defensive default.
   * `retryAfterMs`: overrides backoff interval (e.g. from `Retry-After` header on 429).
   */
  retryable?: boolean;
  retryAfterMs?: number;
}

/**
 * Duck-type guard for plugin errors. Intentionally does not use `instanceof` so
 * plugins loaded in a separate bundle (or without importing this class) still
 * work as long as they set `err.name = "PluginError"` and `err.code`.
 */
export function isPluginError(err: unknown): err is PluginErrorShape {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as Error).name === "PluginError" &&
    typeof (err as PluginErrorShape).code === "string"
  );
}

/** Optional metadata attached to plugin errors. */
export interface PluginErrorOptions {
  params?: Record<string, string | number>;
  retryable?: boolean;
  retryAfterMs?: number;
}

/**
 * Factory for helpers to throw HostErrorCode-tagged errors without importing PluginError class.
 * Returns a plain Error (duck-typed identically by isPluginError) to keep call sites short.
 * Optional `opts` carry retry hints and `params` for translation/routing.
 */
// fallow-ignore-next-line complexity
export function pluginError(
  code: HostErrorCode,
  message: string,
  opts?: PluginErrorOptions,
): Error {
  const err = new Error(message) as Error & {
    code: HostErrorCode;
    params?: Record<string, string | number>;
    retryable?: boolean;
    retryAfterMs?: number;
  };
  err.name = "PluginError";
  err.code = code;
  if (opts?.params !== undefined) err.params = opts.params;
  if (opts?.retryable !== undefined) err.retryable = opts.retryable;
  if (opts?.retryAfterMs !== undefined) err.retryAfterMs = opts.retryAfterMs;
  return err;
}

export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
