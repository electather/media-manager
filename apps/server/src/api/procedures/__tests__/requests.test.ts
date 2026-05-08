import { describe, expect, it, vi, beforeEach } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../errors/middleware";
import { HttpError } from "../../../errors/http-errors";

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

const getRequests = vi.fn<() => Promise<unknown>>();
const listRequestTargets = vi.fn<(mediaType: "movie" | "tv") => Promise<unknown>>();
const requestDownload = vi.fn<(input: unknown) => Promise<unknown>>();

vi.mock("../../../media/service", () => ({
  MediaService: class {
    constructor(public readonly userId: string) {}
    getRequests = getRequests;
    listRequestTargets = listRequestTargets;
    requestDownload = requestDownload;
  },
}));

const { requestsApp } = await import("../requests");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/requests", requestsApp)
    .notFound(() => {
      throw new HttpError(404, "http.not_found", "route not found");
    })
    .onError(errorHandler);
}

describe("requests API", () => {
  beforeEach(() => {
    mockUserId = "u1";
    getRequests.mockReset();
    listRequestTargets.mockReset();
    requestDownload.mockReset();
  });

  it("GET / returns { items } from MediaService.getRequests", async () => {
    getRequests.mockResolvedValueOnce([{ id: "r1" }]);
    const res = await buildApp().request("/requests");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [{ id: "r1" }] });
  });

  it("GET /targets returns aggregated targets", async () => {
    listRequestTargets.mockResolvedValueOnce([
      {
        serviceId: "conn-1:1",
        pluginId: "seerr",
        label: "Radarr",
        exposesProfiles: true,
        defaultProfileId: "5",
        profiles: [{ id: "5", label: "1080p" }],
      },
    ]);
    const res = await buildApp().request("/requests/targets?mediaType=movie");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { targets: unknown[] };
    expect(body.targets).toHaveLength(1);
    expect(listRequestTargets).toHaveBeenCalledWith("movie");
  });

  it("GET /targets returns empty array when service yields none", async () => {
    listRequestTargets.mockResolvedValueOnce([]);
    const res = await buildApp().request("/requests/targets?mediaType=tv");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ targets: [] });
  });

  it("GET /targets rejects unknown mediaType with 400", async () => {
    const res = await buildApp().request("/requests/targets?mediaType=podcast");
    expect(res.status).toBe(400);
  });

  it("POST / happy path returns { requestId }", async () => {
    requestDownload.mockResolvedValueOnce({ requestId: "42" });
    const res = await buildApp().request("/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tmdbId: "550",
        mediaType: "movie",
        serviceId: "conn-1:1",
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requestId: "42" });
    expect(requestDownload).toHaveBeenCalledWith(
      expect.objectContaining({ tmdbId: "550", mediaType: "movie", serviceId: "conn-1:1" }),
    );
  });

  it("POST / rejects malformed body with 400", async () => {
    const res = await buildApp().request("/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tmdbId: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST / surfaces 404 when service throws unknown_service", async () => {
    requestDownload.mockRejectedValueOnce(
      new HttpError(404, "request.unknown_service", "service not found"),
    );
    const res = await buildApp().request("/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tmdbId: "550",
        mediaType: "movie",
        serviceId: "missing:1",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("POST / surfaces 502 on provider failure", async () => {
    requestDownload.mockRejectedValueOnce(new HttpError(502, "request.provider_failed", "boom"));
    const res = await buildApp().request("/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tmdbId: "550",
        mediaType: "movie",
        serviceId: "conn-1:1",
      }),
    });
    expect(res.status).toBe(502);
  });

  it("POST / passes seasons through for tv requests", async () => {
    requestDownload.mockResolvedValueOnce({ requestId: "55" });
    const res = await buildApp().request("/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tmdbId: "1399",
        mediaType: "tv",
        serviceId: "conn-1:5",
        seasons: [1, 2, 3],
      }),
    });
    expect(res.status).toBe(200);
    expect(requestDownload).toHaveBeenCalledWith(expect.objectContaining({ seasons: [1, 2, 3] }));
  });

  it("returns 401 when no session", async () => {
    mockUserId = null;
    const res = await buildApp().request("/requests");
    expect(res.status).toBe(401);
  });
});
