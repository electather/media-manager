import { AllPluginsFailedError, PluginCallError } from "../../media";

/**
 * Per-row plugin failures mark the row partial rather than crashing the HTTP
 * request. Unexpected errors still propagate to the shared error handler.
 */
export function isRowSoftFailure(err: unknown): boolean {
  return (
    err instanceof AllPluginsFailedError ||
    err instanceof PluginCallError ||
    (err instanceof Error && err.name === "AbortError")
  );
}
