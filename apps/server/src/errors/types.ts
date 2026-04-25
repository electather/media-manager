import type { ErrorRecord } from "@ent-mcp/shared/errors";

/** Pluggable destination for captured errors. V1 ships a DatabaseSink only.
 *  Downstream sinks fail independently via Promise.allSettled. */
export interface ErrorSink {
  capture(record: ErrorRecord): Promise<void>;
}
