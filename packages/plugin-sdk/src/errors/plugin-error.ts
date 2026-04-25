import type { HostErrorCode } from "@ent-mcp/shared/errors";

/**
 * Throwable error class plugins use to surface user-facing failures with a
 * stable code. Plugin code can also throw a plain `Error` with `name =
 * "PluginError"` and a `code` field — `isPluginError` is duck-typed so both
 * spellings work, which matters when a plugin is bundled separately and gets
 * a different class identity than the host.
 */
export class PluginError extends Error {
  constructor(
    public code: HostErrorCode,
    message: string,
    /**
     * Interpolation values and routing hints per the error design doc's wire
     * format. The host threads these onto the outgoing HTTP error body so the
     * frontend can route the error (e.g. `{ field: "externalServerUrl" }`
     * attaches the message to a specific form input).
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

/**
 * Lightweight factory used by plugin helpers (handleHttpStatus, resolveCredential)
 * that want to throw an error tagged with a HostErrorCode without importing the
 * full PluginError class. Returns a plain Error to keep call sites short — the
 * host's duck-type guard treats it identically to a PluginError instance.
 */
export function pluginError(code: HostErrorCode, message: string): Error {
  const err = new Error(message);
  err.name = "PluginError";
  (err as Error & { code: HostErrorCode }).code = code;
  return err;
}

export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
