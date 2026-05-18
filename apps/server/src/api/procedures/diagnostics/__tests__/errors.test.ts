import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../../diagnostics/middleware";
import { unauthorized } from "../../../../diagnostics/http-errors";

// `errorReportLimiter` is module-private state, so cross-test isolation relies
// on each test using a unique user id. A fresh bucket starts with the full
// capacity (10 tokens), which is what the per-test scenarios assume.

vi.mock("../../../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

let mockUserId: string | null = null;

vi.mock("../../../../auth", () => ({
  requireSession: async (c: any, next: any) => {
    if (!mockUserId) throw unauthorized();
    c.set("session", { user: { id: mockUserId } });
    await next();
  },
  requirePermission: () => async (_c: any, next: any) => {
    await next();
  },
  PERMISSIONS: { ADMIN_PLUGINS: "admin:plugins" },
}));

// `captureError` writes to the DB; for these tests we only care about request
// shape and rate-limit behaviour, so swallow the call.
vi.mock("../../../../diagnostics/capture", () => ({
  captureError: vi.fn(async () => "test-id"),
}));

// Avoid hitting any real DB client at import time.
vi.mock("../../../../db/client", () => ({
  getDb: () => ({}),
}));

const { errorsReportApp } = await import("../errors");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/api/diagnostics/errors", errorsReportApp)
    .onError(errorHandler);
}

function validBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { severity: "error", message: "boom", ...extra };
}

async function post(app: ReturnType<typeof buildApp>, body: unknown): Promise<Response> {
  return app.request("/api/diagnostics/errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/diagnostics/errors — validation", () => {
  beforeEach(() => {
    mockUserId = `user-${crypto.randomUUID()}`;
  });

  it("accepts a minimal valid report", async () => {
    const res = await post(buildApp(), validBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects a message longer than 2000 chars so an attacker can't pad the row", async () => {
    const res = await post(buildApp(), validBody({ message: "x".repeat(2001) }));
    expect(res.status).toBe(400);
  });

  it("rejects a context object with more than 20 keys to bound payload size", async () => {
    const tooManyKeys = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]));
    const res = await post(buildApp(), validBody({ context: tooManyKeys }));
    expect(res.status).toBe(400);
  });

  it("rejects context values exceeding 1000 chars so strings can't smuggle blobs", async () => {
    const res = await post(buildApp(), validBody({ context: { huge: "x".repeat(1001) } }));
    expect(res.status).toBe(400);
  });

  it("rejects nested objects under context — only scalars allowed", async () => {
    const res = await post(buildApp(), validBody({ context: { nested: { a: 1 } } }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/diagnostics/errors — auth", () => {
  it("returns 401 when no session is attached", async () => {
    mockUserId = null;
    const res = await post(buildApp(), validBody());
    expect(res.status).toBe(401);
  });
});

describe("POST /api/diagnostics/errors — rate limit", () => {
  it("allows 10 reports then 429s the 11th with a Retry-After header", async () => {
    mockUserId = `user-${crypto.randomUUID()}`;
    const app = buildApp();

    for (let i = 0; i < 10; i++) {
      const res = await post(app, validBody());
      expect(res.status).toBe(200);
    }

    const limited = await post(app, validBody());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).not.toBeNull();
    const body = (await limited.json()) as { ok: boolean; error: string };
    expect(body).toMatchObject({ ok: false, error: "rate_limited" });
  });

  it("rate-limits before validation so spam with oversized bodies still 429s", async () => {
    mockUserId = `user-${crypto.randomUUID()}`;
    const app = buildApp();

    for (let i = 0; i < 10; i++) {
      const res = await post(app, validBody());
      expect(res.status).toBe(200);
    }

    // 11th request is oversized: if rate-limit ran after validation we'd see
    // 400; the middleware runs first and short-circuits to 429.
    const limited = await post(app, validBody({ message: "x".repeat(5000) }));
    expect(limited.status).toBe(429);
  });
});
