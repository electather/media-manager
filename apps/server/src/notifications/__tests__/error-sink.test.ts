import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import type { ErrorRecord } from "@nama/shared/diagnostics";
import type { NotificationEvent } from "@nama/shared/notifications";
import { NotificationErrorSink } from "../internal/error-sink";

type PublishArg = Omit<NotificationEvent, "id" | "occurredAt">;

const publishMock = vi.fn<(event: PublishArg) => Promise<void>>(async () => undefined);

function makeRecord(overrides: Partial<ErrorRecord> = {}): ErrorRecord {
  return {
    id: "err-1",
    requestId: "req-1",
    severity: "error",
    source: "backend",
    code: "http.internal_error",
    devMessage: "boom",
    stack: null,
    resolvedStack: null,
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
  publishMock.mockReset();
});

describe("NotificationErrorSink", () => {
  it("publishes system.error for severity=error with admin audience", async () => {
    const sink = new NotificationErrorSink(publishMock);
    await sink.captureError(makeRecord({ devMessage: "kaboom", source: "plugin" }));

    expect(publishMock).toHaveBeenCalledTimes(1);
    const call = publishMock.mock.calls[0];
    if (!call) throw new Error("expected publish call");
    expect(call[0]).toMatchObject({
      type: "system.error",
      category: "system",
      severity: "error",
      audience: { kind: "admin", permission: "admin:server" },
      payload: { errorSource: "plugin", message: "kaboom" },
      correlationKey: "req-1",
    });
  });

  it("does not publish for severity=warning", async () => {
    const sink = new NotificationErrorSink(publishMock);
    await sink.captureError(makeRecord({ severity: "warning" }));
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("does not publish for severity=info", async () => {
    const sink = new NotificationErrorSink(publishMock);
    await sink.captureError(makeRecord({ severity: "info" }));
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("swallows publish failures so capture stays reliable", async () => {
    publishMock.mockRejectedValueOnce(new Error("publish boom"));
    const sink = new NotificationErrorSink(publishMock);
    await expect(sink.captureError(makeRecord())).resolves.toBeUndefined();
  });
});
