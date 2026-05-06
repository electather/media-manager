import { describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../errors/middleware";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let mockUserId: string | null = null;

vi.mock("../../../auth/middleware", async () => {
  const { unauthorized } = await import("../../../errors/http-errors");
  return {
    requireSession: async (
      c: { set: (k: string, v: unknown) => void },
      next: () => Promise<void>,
    ) => {
      if (!mockUserId) throw unauthorized();
      c.set("session", { user: { id: mockUserId } });
      await next();
    },
    sessionUserId: (c: { get: (k: string) => unknown }) => {
      const session = c.get("session") as { user: { id: string } } | undefined;
      if (!session) throw unauthorized();
      return session.user.id;
    },
  };
});

vi.mock("../../../home/orchestrator", () => ({
  buildContext: vi.fn().mockReturnValue({ userId: "u1" }),
  composeLayout: vi.fn(),
  composeRow: vi.fn(),
  composeDetails: vi.fn(),
}));

const orchestrator = await import("../../../home/orchestrator");
const { homeApp } = await import("../home");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/home", homeApp)
    .onError(errorHandler);
}

describe("home API", () => {
  it("returns 401 when no session present", async () => {
    mockUserId = null;
    const res = await buildApp().request("/home/layout");
    expect(res.status).toBe(401);
  });

  it("returns 200 + layout for authenticated user", async () => {
    mockUserId = "u1";
    const fake = { hero: null, rows: [], generatedAt: 1 };
    vi.mocked(orchestrator.composeLayout).mockResolvedValueOnce(fake);
    const res = await buildApp().request("/home/layout");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fake);
  });

  it("forwards row queries to composeRow", async () => {
    mockUserId = "u1";
    vi.mocked(orchestrator.composeRow).mockResolvedValueOnce({
      items: [],
      cursor: null,
    });
    const res = await buildApp().request("/home/row?rowId=trendingNow");
    expect(res.status).toBe(200);
    expect(orchestrator.composeRow).toHaveBeenCalledWith(expect.anything(), "trendingNow", null);
  });

  it("returns 404 when composeRow throws home.row_unavailable", async () => {
    mockUserId = "u1";
    const { HttpError } = await import("../../../errors/http-errors");
    vi.mocked(orchestrator.composeRow).mockRejectedValueOnce(
      new HttpError(404, "home.row_unavailable", "unknown"),
    );
    const res = await buildApp().request("/home/row?rowId=nope");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("home.row_unavailable");
  });

  it("rejects /row without rowId with 400", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/home/row");
    expect(res.status).toBe(400);
  });

  it("returns 200 + details payload", async () => {
    mockUserId = "u1";
    const payload = {
      summary: {
        id: "movie:1",
        tmdbId: "1",
        mediaType: "movie" as const,
        title: "X",
        status: "unknown" as const,
      },
      details: { cast: [] },
    };
    vi.mocked(orchestrator.composeDetails).mockResolvedValueOnce(payload);
    const res = await buildApp().request("/home/details?tmdbId=1&mediaType=movie");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });
});
