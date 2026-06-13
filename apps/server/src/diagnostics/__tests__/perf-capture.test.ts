import { describe, it, expect, beforeEach } from "vite-plus/test";
import { capturePerf, captureError, registerSink, resetSinks } from "../capture";
import { runWithRequestContext } from "../request-context";
import type { ErrorRecord, PerfRecord } from "@nama/shared/diagnostics";
import type { DiagnosticSink } from "../types";

class ErrorOnlySink implements DiagnosticSink {
  errors: ErrorRecord[] = [];
  async captureError(record: ErrorRecord): Promise<void> {
    this.errors.push(record);
  }
}

class PerfOnlySink implements DiagnosticSink {
  perf: PerfRecord[] = [];
  async capturePerf(record: PerfRecord): Promise<void> {
    this.perf.push(record);
  }
}

describe("DiagnosticSink dispatch", () => {
  beforeEach(() => {
    resetSinks();
  });

  it("does not call captureError on a perf-only sink", async () => {
    const errorSink = new ErrorOnlySink();
    const perfSink = new PerfOnlySink();
    registerSink(errorSink);
    registerSink(perfSink);
    await captureError(new Error("boom"), { source: "backend" });
    expect(errorSink.errors).toHaveLength(1);
    expect(perfSink.perf).toHaveLength(0);
  });

  it("does not call capturePerf on an error-only sink", async () => {
    const errorSink = new ErrorOnlySink();
    const perfSink = new PerfOnlySink();
    registerSink(errorSink);
    registerSink(perfSink);
    await capturePerf({ kind: "http", durationMs: 42, route: "/x" });
    expect(perfSink.perf).toHaveLength(1);
    expect(errorSink.errors).toHaveLength(0);
  });

  it("records the ambient request id and rounds non-integer durations", async () => {
    const sink = new PerfOnlySink();
    registerSink(sink);
    await runWithRequestContext({ requestId: "req-perf", userId: null, route: "/x" }, async () => {
      await capturePerf({ kind: "plugin", durationMs: 12.7, pluginId: "trakt" });
    });
    const record = sink.perf.at(-1)!;
    expect(record.requestId).toBe("req-perf");
    expect(record.durationMs).toBe(13);
    expect(record.kind).toBe("plugin");
    expect(record.pluginId).toBe("trakt");
  });
});
