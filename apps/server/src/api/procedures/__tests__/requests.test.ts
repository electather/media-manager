import { describe, expect, it, vi, beforeEach } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { HttpError } from "../../../diagnostics/http-errors";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let mockUserId: string | null = null;

vi.mock("../../../auth", async () => {
  const { unauthorized } = await import("../../../diagnostics/http-errors");
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
const cancelRequest = vi.fn<(requestId: string) => Promise<void>>();

vi.mock("../../../media", async () => {
  const actual = await vi.importActual<typeof import("../../../media")>("../../../media");
  return {
    ...actual,
    MediaService: class {
      constructor(public readonly userId: string) {}
      getRequests = getRequests;
      listRequestTargets = listRequestTargets;
      requestDownload = requestDownload;
      cancelRequest = cancelRequest;
    },
  };
});

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
    cancelRequest.mockReset();
  });

  it("GET / returns typed { items } including seasons[], targetLabel, profileLabel", async () => {
    const row = {
      id: "r1",
      tmdbId: "550",
      type: "movie",
      title: "Fight Club",
      status: "pending",
      seasons: [],
      targetLabel: "Radarr Main",
      profileLabel: "1080p",
      createdAt: "2026-01-01T00:00:00Z",
    };
    getRequests.mockResolvedValueOnce([row]);
    const res = await buildApp().request("/requests");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [row] });
  });

  it("GET / returns 200 with empty items when no mediaRequest provider is connected", async () => {
    getRequests.mockResolvedValueOnce([]);
    const res = await buildApp().request("/requests");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });

  it("GET / passes failed-status rows through unchanged (no server-side filter)", async () => {
    const row = {
      id: "r-fail",
      tmdbId: "1",
      type: "movie",
      title: "x",
      status: "failed",
      seasons: [],
      targetLabel: null,
      profileLabel: null,
      createdAt: "2026-01-01T00:00:00Z",
    };
    getRequests.mockResolvedValueOnce([row]);
    const res = await buildApp().request("/requests");
    const body = (await res.json()) as { items: Array<{ status: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.status).toBe("failed");
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

  it("forwards movie + seasons[] without rejecting (server silently drops)", async () => {
    requestDownload.mockResolvedValueOnce({ requestId: "77" });
    const res = await buildApp().request("/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tmdbId: "550",
        mediaType: "movie",
        serviceId: "conn-1:1",
        seasons: [1],
      }),
    });
    expect(res.status).toBe(200);
    expect(requestDownload).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: "movie", seasons: [1] }),
    );
  });

  it("returns 401 when no session", async () => {
    mockUserId = null;
    const res = await buildApp().request("/requests");
    expect(res.status).toBe(401);
  });

  it("DELETE /:requestId happy path returns { ok: true }", async () => {
    cancelRequest.mockResolvedValueOnce(undefined);
    const res = await buildApp().request("/requests/42", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(cancelRequest).toHaveBeenCalledWith("42");
  });

  it("DELETE /:requestId surfaces 404 unknown_service", async () => {
    cancelRequest.mockRejectedValueOnce(
      new HttpError(404, "request.unknown_service", "service not found"),
    );
    const res = await buildApp().request("/requests/missing", { method: "DELETE" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("request.unknown_service");
  });

  it("DELETE /:requestId surfaces 502 provider_failed", async () => {
    cancelRequest.mockRejectedValueOnce(new HttpError(502, "request.provider_failed", "boom"));
    const res = await buildApp().request("/requests/9", { method: "DELETE" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("request.provider_failed");
  });

  it("DELETE /:requestId surfaces 404 request.no_provider when no provider is connected", async () => {
    cancelRequest.mockRejectedValueOnce(
      new HttpError(404, "request.no_provider", "no mediaRequest provider configured"),
    );
    const res = await buildApp().request("/requests/9", { method: "DELETE" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("request.no_provider");
  });

  it("DELETE /:requestId requires session", async () => {
    mockUserId = null;
    const res = await buildApp().request("/requests/1", { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});
