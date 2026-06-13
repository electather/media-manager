import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../../diagnostics/middleware";
import { unauthorized } from "../../../../diagnostics/http-errors";

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
  sessionUserId: (c: any) => {
    const session = c.get("session") as { user: { id: string } } | undefined;
    if (!session) throw unauthorized();
    return session.user.id;
  },
}));

vi.mock("../../../../db/client", () => ({
  getDb: () => ({}),
}));

const buildExportSpy = vi.fn();
vi.mock("../export", () => ({
  buildUserExport: buildExportSpy,
}));

const { meApp, exportLimiter } = await import("../../me");

function buildApp() {
  return new Hono().use("*", requestContextMiddleware()).route("/me", meApp).onError(errorHandler);
}

function getExport(userId: string) {
  mockUserId = userId;
  return buildApp().request("/me/export", { method: "GET" });
}

beforeEach(() => {
  mockUserId = null;
  buildExportSpy.mockReset();
  buildExportSpy.mockResolvedValue({
    zipBytes: new ArrayBuffer(8),
    filename: "nama-export-u1-20260518.zip",
  });
  exportLimiter.reset();
});

describe("/me/export rate limit", () => {
  it("returns 429 with Retry-After header and retry_after in body when bucket drains", async () => {
    // capacity=5: five calls succeed, the sixth must be rate limited.
    for (let i = 0; i < 5; i++) {
      const res = await getExport("u1");
      expect(res.status).toBe(200);
    }
    const limited = await getExport("u1");
    expect(limited.status).toBe(429);

    const retryAfter = limited.headers.get("retry-after");
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);

    const body = (await limited.json()) as {
      code: string;
      details?: { retry_after?: number };
      requestId?: string;
    };
    expect(body.code).toBe("mcp.rate_limited");
    expect(body.details?.retry_after).toBe(Number(retryAfter));
    // Body must carry the request-scoped ID so a rate-limited user can correlate
    // the failure with server logs — same shape as every other error response.
    expect(body.requestId).toBe(limited.headers.get("x-request-id"));

    // The whole point of the limit is that the expensive ZIP build is *skipped*
    // when rate-limited — so the spy must still show only the 5 passing calls.
    expect(buildExportSpy).toHaveBeenCalledTimes(5);
  });

  it("isolates buckets per user", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await getExport("userA");
      expect(res.status).toBe(200);
    }
    const drained = await getExport("userA");
    expect(drained.status).toBe(429);

    // user B's bucket is independent.
    const fresh = await getExport("userB");
    expect(fresh.status).toBe(200);
  });
});
