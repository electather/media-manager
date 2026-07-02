import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { unauthorized } from "../../../diagnostics/http-errors";

// Stub the env so anything transitively pulled by the auth/db modules at
// import time doesn't trip over missing process env.
vi.mock("../../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

// Toggle whether `requireSession` accepts the request. The guard runs before
// zValidator, so the 401 path never reaches query validation.
let mockUserId: string | null = null;

vi.mock("../../../auth", () => ({
  requireSession: async (c: any, next: any) => {
    if (!mockUserId) {
      throw unauthorized();
    }
    c.set("session", { user: { id: mockUserId } });
    await next();
  },
}));

const { activityApp } = await import("../activity");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/activity", activityApp)
    .onError(errorHandler);
}

// The guard is the whole point of this file: dropping `requireSession` in a
// future refactor must fail here rather than silently exposing per-user data.
describe("activityApp auth guard", () => {
  const paths = ["/history", "/watchlist", "/upcoming", "/progress"];

  beforeEach(() => {
    mockUserId = null;
  });

  it("rejects unauthenticated requests with 401 on every route", async () => {
    for (const path of paths) {
      const res = await buildApp().request(`/activity${path}`);
      expect(res.status, `${path} should require a session`).toBe(401);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("http.unauthorized");
    }
  });

  it("admits authenticated requests past the guard", async () => {
    mockUserId = "user-1";
    // history/watchlist query schemas are all-optional, so an empty query
    // string validates; every stub returns { items: [] } regardless of params.
    for (const path of paths) {
      const res = await buildApp().request(`/activity${path}`);
      expect(res.status, `${path} should pass the guard`).toBe(200);
      expect(await res.json()).toEqual({ items: [] });
    }
  });
});
