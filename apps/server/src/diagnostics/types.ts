import type { ErrorRecord, PerfRecord } from "@nama/shared/diagnostics";

/** Pluggable destination for diagnostic records. Each method is optional so a
 *  sink can subscribe to one record kind. Sinks fail independently via
 *  `Promise.allSettled`; failures never propagate to the caller. */
export interface DiagnosticSink {
  captureError?(record: ErrorRecord): Promise<void>;
  capturePerf?(record: PerfRecord): Promise<void>;
}
