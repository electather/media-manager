import type { HostErrorCode } from "../errors/codes";
import { isPluginError } from "../plugin-runtime/types";

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
