import { describe, it, expect, beforeEach } from "vite-plus/test";
import { captureError, registerErrorSink, resetErrorSinks } from "../capture";
import { runWithRequestContext } from "../request-context";
import type { ErrorRecord } from "@ent-mcp/shared/errors";
import type { ErrorSink } from "../types";

class CollectingSink implements ErrorSink {
  records: ErrorRecord[] = [];
  async capture(record: ErrorRecord): Promise<void> {
    this.records.push(record);
  }
}

class ThrowingSink implements ErrorSink {
  async capture(): Promise<void> {
    throw new Error("sink boom");
  }
}

describe("captureError", () => {
  let collector: CollectingSink;
  beforeEach(() => {
    resetErrorSinks();
    collector = new CollectingSink();
    registerErrorSink(collector);
  });

  it("writes records with the ambient request id, user id, and route", async () => {
    await runWithRequestContext(
      { requestId: "req-abc", userId: "user-123", route: "/api/test" },
      async () => {
        const id = await captureError(new Error("boom"), {
          severity: "error",
          source: "backend",
          code: "http.internal_error",
        });
        expect(typeof id).toBe("string");
      },
    );

    const record = collector.records.at(-1);
    expect(record).toBeDefined();
    expect(record!.requestId).toBe("req-abc");
    expect(record!.userId).toBe("user-123");
    expect(record!.route).toBe("/api/test");
    expect(record!.code).toBe("http.internal_error");
    expect(record!.severity).toBe("error");
    expect(record!.source).toBe("backend");
    expect(record!.devMessage).toBe("boom");
  });

  it("scrubs sensitive context before persistence", async () => {
    await captureError(new Error("x"), {
      severity: "warning",
      source: "plugin",
      pluginId: "trakt",
      context: { token: "secret", note: "ok" },
    });
    const record = collector.records.at(-1)!;
    const parsed = JSON.parse(record.context!) as { token: string; note: string };
    expect(parsed.token).toBe("[REDACTED]");
    expect(parsed.note).toBe("ok");
  });

  it("is resilient to a downstream sink throwing", async () => {
    registerErrorSink(new ThrowingSink());
    // Should not throw even though one sink fails.
    const id = await captureError(new Error("resilient"), {
      severity: "error",
      source: "backend",
    });
    expect(id).toBeDefined();
    expect(collector.records.at(-1)!.devMessage).toBe("resilient");
  });
});
