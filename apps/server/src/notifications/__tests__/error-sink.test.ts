import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import type { ErrorRecord } from "@ent-mcp/shared/diagnostics";
import type { emit as emitFn } from "../emit";

type EmitArg = Parameters<typeof emitFn>[0];

const emitMock = vi.fn<(event: EmitArg) => Promise<void>>(async () => undefined);

vi.mock("../emit", () => ({
  emit: emitMock,
}));

const { NotificationErrorSink } = await import("../error-sink");

function makeRecord(overrides: Partial<ErrorRecord> = {}): ErrorRecord {
  return {
    id: "err-1",
    requestId: "req-1",
    severity: "error",
    source: "backend",
    code: "http.internal_error",
    devMessage: "boom",
    stack: null,
    userId: null,
    pluginId: null,
    connectionId: null,
    route: null,
    httpStatus: 500,
    context: null,
    createdAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  emitMock.mockReset();
});

describe("NotificationErrorSink", () => {
  it("emits system.error for severity=error with admin audience", async () => {
    const sink = new NotificationErrorSink();
    await sink.captureError(makeRecord({ devMessage: "kaboom", source: "plugin" }));

    expect(emitMock).toHaveBeenCalledTimes(1);
    const call = emitMock.mock.calls[0];
    if (!call) throw new Error("expected emit call");
    expect(call[0]).toMatchObject({
      type: "system.error",
      category: "system",
      severity: "error",
      audience: { kind: "admin", permission: "admin:server" },
      payload: { errorSource: "plugin", message: "kaboom" },
      correlationKey: "req-1",
    });
  });

  it("does not emit for severity=warning", async () => {
    const sink = new NotificationErrorSink();
    await sink.captureError(makeRecord({ severity: "warning" }));
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("does not emit for severity=info", async () => {
    const sink = new NotificationErrorSink();
    await sink.captureError(makeRecord({ severity: "info" }));
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("swallows emit failures so capture stays reliable", async () => {
    emitMock.mockRejectedValueOnce(new Error("emit boom"));
    const sink = new NotificationErrorSink();
    await expect(sink.captureError(makeRecord())).resolves.toBeUndefined();
  });
});
