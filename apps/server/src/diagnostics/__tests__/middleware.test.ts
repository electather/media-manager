import { describe, it, expect, beforeEach } from "vite-plus/test";
import { Hono } from "hono";
import { captureError, registerSink, resetSinks } from "../capture";
import { errorHandler, requestContextMiddleware } from "../middleware";
import { HttpError, badRequest, internal, notFound, unauthorized } from "../http-errors";
import { zValidator } from "../validator";
import { z } from "zod";
import type { ErrorRecord } from "@ent-mcp/shared/diagnostics";
import type { DiagnosticSink } from "../types";

class CollectingSink implements DiagnosticSink {
  records: ErrorRecord[] = [];
  async captureError(record: ErrorRecord): Promise<void> {
    this.records.push(record);
  }
}

function buildApp() {
  const app = new Hono();
  app.use("*", requestContextMiddleware());
  app.get("/ok", (c) => c.json({ ok: true }));
  app.get("/user-4xx", () => {
    throw notFound("connection.not_found", "nope");
  });
  app.get("/auth", () => {
    throw unauthorized();
  });
  app.get("/bad", () => {
    throw badRequest("http.invalid_input", "bad thing", { field: "x" });
  });
  app.get("/boom-http", () => {
    throw internal("http.internal_error", "explicit 500");
  });
  app.get("/boom-plain", () => {
    throw new Error("unexpected");
  });
  app.post("/validate", zValidator("json", z.object({ name: z.string() })), (c) =>
    c.json({ ok: true, received: c.req.valid("json") }),
  );
  app.onError(errorHandler);
  return app;
}

async function flushCaptures() {
  // captureError is fire-and-forget from onError; yield so the promise queue drains.
  await new Promise((r) => setTimeout(r, 5));
}

describe("errorHandler", () => {
  let collector: CollectingSink;
  beforeEach(() => {
    resetSinks();
    collector = new CollectingSink();
    registerSink(collector);
  });

  it("returns structured body with request id for HttpError", async () => {
    const app = buildApp();
    const res = await app.request("/user-4xx");
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      code: string;
      devMessage: string;
      requestId: string;
    };
    expect(body.code).toBe("connection.not_found");
    expect(body.devMessage).toBe("nope");
    expect(typeof body.requestId).toBe("string");
    expect(res.headers.get("x-request-id")).toBe(body.requestId);
  });

  it("does not capture expected 4xx into the error store", async () => {
    const app = buildApp();
    await app.request("/user-4xx");
    await app.request("/auth");
    await app.request("/bad");
    await flushCaptures();
    expect(collector.records).toHaveLength(0);
  });

  it("captures explicit 5xx HttpError", async () => {
    const app = buildApp();
    const res = await app.request("/boom-http");
    expect(res.status).toBe(500);
    await flushCaptures();
    expect(collector.records).toHaveLength(1);
    expect(collector.records[0]!.code).toBe("http.internal_error");
  });

  it("maps unknown throws to 500 and captures them", async () => {
    const app = buildApp();
    const res = await app.request("/boom-plain");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; devMessage: string };
    expect(body.code).toBe("http.internal_error");
    expect(body.devMessage).toBe("unexpected");
    await flushCaptures();
    expect(collector.records).toHaveLength(1);
  });

  it("reuses incoming X-Request-Id on responses", async () => {
    const app = buildApp();
    const res = await app.request("/ok", { headers: { "x-request-id": "req-from-client" } });
    expect(res.headers.get("x-request-id")).toBe("req-from-client");
  });

  it("validation failures surface as structured 400", async () => {
    const app = buildApp();
    const res = await app.request("/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ not_name: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("http.invalid_input");
    await flushCaptures();
    expect(collector.records).toHaveLength(0);
  });
});

describe("HttpError helpers", () => {
  it("factories set the right status and code", () => {
    expect(notFound("x", "m").status).toBe(404);
    expect(badRequest("x", "m").status).toBe(400);
    expect(unauthorized().status).toBe(401);
    expect(internal().status).toBe(500);
  });

  it("instances are HttpError", () => {
    expect(notFound("x", "m")).toBeInstanceOf(HttpError);
  });
});

// Keep captureError import live so this file tracks the capture module's surface.
void captureError;
