import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../errors/middleware";
import { unauthorized } from "../../../errors/http-errors";

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

let mockUserId: string | null = null;
vi.mock("../../../auth/middleware", () => ({
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

const layoutSpy = vi.fn();
const rowContentSpy = vi.fn();
vi.mock("../../../home", () => ({
  getHomeFeedService: () => ({
    getLayout: layoutSpy,
    getRowContent: rowContentSpy,
  }),
}));

const { homeApp } = await import("../home");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/home", homeApp)
    .onError(errorHandler);
}

beforeEach(() => {
  mockUserId = null;
  layoutSpy.mockReset();
  rowContentSpy.mockReset();
});

describe("home RPC contract", () => {
  it("rejects getLayout when the session is unauthenticated", async () => {
    const res = await buildApp().request("/home/getLayout", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("returns the service's layout response on getLayout", async () => {
    mockUserId = "u1";
    layoutSpy.mockResolvedValue({ hero: null, rows: [], generatedAt: 1 });
    const res = await buildApp().request("/home/getLayout", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hero: null, rows: [], generatedAt: 1 });
    expect(layoutSpy).toHaveBeenCalledWith("u1");
  });

  it("strict-rejects extra keys in getLayout body", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/home/getLayout", {
      method: "POST",
      body: JSON.stringify({ surprise: true }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(layoutSpy).not.toHaveBeenCalled();
  });

  it("rejects getRowContent with an unknown rowId", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/home/getRowContent", {
      method: "POST",
      body: JSON.stringify({ rowId: "doesNotExist", cursor: "x" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(rowContentSpy).not.toHaveBeenCalled();
  });

  it("rejects getRowContent without a cursor", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/home/getRowContent", {
      method: "POST",
      body: JSON.stringify({ rowId: "trendingNow" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("forwards a well-formed getRowContent call to the service", async () => {
    mockUserId = "u1";
    rowContentSpy.mockResolvedValue({ items: [], cursor: null });
    const res = await buildApp().request("/home/getRowContent", {
      method: "POST",
      body: JSON.stringify({ rowId: "trendingNow", cursor: "abc" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(rowContentSpy).toHaveBeenCalledWith("u1", { rowId: "trendingNow", cursor: "abc" });
  });
});
