import { describe, it, expect, beforeEach } from "vite-plus/test";
import { Hono } from "hono";
import { registerSink, resetSinks } from "../capture";
import { errorHandler, httpPerfMiddleware, requestContextMiddleware } from "../middleware";
import { internal } from "../http-errors";
import type { PerfRecord } from "@ent-mcp/shared/diagnostics";
import type { DiagnosticSink } from "../types";

class PerfCollector implements DiagnosticSink {
  records: PerfRecord[] = [];
  async capturePerf(record: PerfRecord): Promise<void> {
    this.records.push(record);
  }
}

function buildApp() {
  const app = new Hono();
  app.use("*", requestContextMiddleware());
  app.use("*", httpPerfMiddleware());
  app.get("/api/ok", (c) => c.json({ ok: true }));
  app.get("/api/boom", () => {
    throw internal("http.internal_error", "boom");
  });
  app.get("/api/diagnostics/errors", (c) => c.json({ ok: true }));
  app.get("/api/admin/diagnostics/perf/aggregate", (c) => c.json({ ok: true }));
  app.get("/api/admin/diagnostics/errors", (c) => c.json({ ok: true }));
  app.get("/api/stream", (c) => {
    c.header("content-type", "text/event-stream");
    return c.body("");
  });
  app.onError(errorHandler);
  return app;
}

async function flush() {
  await new Promise((r) => setTimeout(r, 10));
}

describe("httpPerfMiddleware", () => {
  let collector: PerfCollector;
  beforeEach(() => {
    resetSinks();
    collector = new PerfCollector();
    registerSink(collector);
  });

  it("writes a perf row on a successful response", async () => {
    const app = buildApp();
    const res = await app.request("/api/ok");
    expect(res.status).toBe(200);
    await flush();
    expect(collector.records).toHaveLength(1);
    const rec = collector.records[0]!;
    expect(rec.kind).toBe("http");
    expect(rec.method).toBe("GET");
    expect(rec.route).toBe("/api/ok");
    expect(rec.status).toBe(200);
    expect(rec.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("writes a perf row even when the handler throws a 5xx", async () => {
    const app = buildApp();
    const res = await app.request("/api/boom");
    expect(res.status).toBe(500);
    await flush();
    expect(collector.records).toHaveLength(1);
    expect(collector.records[0]!.status).toBe(500);
  });

  it("skips routes inside /api/diagnostics to prevent recursion", async () => {
    const app = buildApp();
    await app.request("/api/diagnostics/errors");
    await flush();
    expect(collector.records).toHaveLength(0);
  });

  it("skips routes inside /api/admin/diagnostics to prevent recursion", async () => {
    const app = buildApp();
    await app.request("/api/admin/diagnostics/perf/aggregate");
    await app.request("/api/admin/diagnostics/errors");
    await flush();
    expect(collector.records).toHaveLength(0);
  });

  it("skips diagnostics routes when registered relative to a sub-app", async () => {
    // Mirrors production: appRouter is mounted at "/api" so its middleware
    // sees routePath relative to the router (e.g. "/admin/diagnostics/...").
    const sub = new Hono();
    sub.use("*", requestContextMiddleware());
    sub.use("*", httpPerfMiddleware());
    sub.get("/admin/diagnostics/perf/aggregate", (c) => c.json({ ok: true }));
    sub.get("/diagnostics/errors", (c) => c.json({ ok: true }));
    const outer = new Hono();
    outer.route("/api", sub);
    await outer.request("/api/admin/diagnostics/perf/aggregate");
    await outer.request("/api/diagnostics/errors");
    await flush();
    expect(collector.records).toHaveLength(0);
  });

  it("skips streaming responses", async () => {
    const app = buildApp();
    await app.request("/api/stream");
    await flush();
    expect(collector.records).toHaveLength(0);
  });

  it("skips unmatched routes (no perf for 404)", async () => {
    const app = buildApp();
    const res = await app.request("/api/does-not-exist");
    expect(res.status).toBe(404);
    await flush();
    expect(collector.records).toHaveLength(0);
  });
});
