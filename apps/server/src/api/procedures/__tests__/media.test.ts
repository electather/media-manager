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

const getDetailsTypedSpy = vi.fn();
const getDetailsBatchTypedSpy = vi.fn();
vi.mock("../../../media/service", () => ({
  MediaService: class {
    constructor(public readonly userId: string) {}
    getDetailsTyped = getDetailsTypedSpy;
    getDetailsBatchTyped = getDetailsBatchTypedSpy;
  },
}));

const { mediaApp } = await import("../media");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/media", mediaApp)
    .onError(errorHandler);
}

beforeEach(() => {
  mockUserId = null;
  getDetailsTypedSpy.mockReset();
  getDetailsBatchTypedSpy.mockReset();
});

describe("media RPC contract", () => {
  it("rejects /get without a session", async () => {
    const res = await buildApp().request("/media/get", {
      method: "POST",
      body: JSON.stringify({ id: "movie:550" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 + detail payload on a valid id", async () => {
    mockUserId = "u1";
    const detail = {
      id: "movie:550",
      tmdbId: "550",
      mediaType: "movie" as const,
      title: "Fight Club",
    };
    getDetailsTypedSpy.mockResolvedValue(detail);
    const res = await buildApp().request("/media/get", {
      method: "POST",
      body: JSON.stringify({ id: "movie:550" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(detail);
    expect(getDetailsTypedSpy).toHaveBeenCalledWith("movie:550");
  });

  it("rejects malformed ids with 400", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/media/get", {
      method: "POST",
      body: JSON.stringify({ id: "not-an-id" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    expect(getDetailsTypedSpy).not.toHaveBeenCalled();
  });

  it("returns 404 with media.not_found when service returns null", async () => {
    mockUserId = "u1";
    getDetailsTypedSpy.mockResolvedValue(null);
    const res = await buildApp().request("/media/get", {
      method: "POST",
      body: JSON.stringify({ id: "movie:99999" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("media.not_found");
  });

  it("/getMany returns 200 + items omitting failed ids", async () => {
    mockUserId = "u1";
    getDetailsBatchTypedSpy.mockResolvedValue([
      { id: "movie:550", tmdbId: "550", mediaType: "movie", title: "Fight Club" },
    ]);
    const res = await buildApp().request("/media/getMany", {
      method: "POST",
      body: JSON.stringify({ ids: ["movie:550", "movie:404"] }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(1);
    expect(getDetailsBatchTypedSpy).toHaveBeenCalledWith(["movie:550", "movie:404"]);
  });

  it("/getMany rejects >100 ids with 400", async () => {
    mockUserId = "u1";
    const ids = Array.from({ length: 101 }, (_, i) => `movie:${i + 1}`);
    const res = await buildApp().request("/media/getMany", {
      method: "POST",
      body: JSON.stringify({ ids }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    expect(getDetailsBatchTypedSpy).not.toHaveBeenCalled();
  });

  it("/getMany accepts an empty list and returns empty items", async () => {
    mockUserId = "u1";
    getDetailsBatchTypedSpy.mockResolvedValue([]);
    const res = await buildApp().request("/media/getMany", {
      method: "POST",
      body: JSON.stringify({ ids: [] }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });

  it("/getMany rejects malformed ids with 400 (regex enforced)", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/media/getMany", {
      method: "POST",
      body: JSON.stringify({ ids: ["movie:550", "garbage"] }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    expect(getDetailsBatchTypedSpy).not.toHaveBeenCalled();
  });
});
