import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { HttpError } from "../../../diagnostics/http-errors";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let mockUserId: string | null = "u1";

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

vi.mock("../../../catalog", () => ({ getCatalogService: () => ({}), toCanonicalRow: vi.fn() }));
vi.mock("../../../artwork", () => ({
  ArtworkService: vi.fn(function ArtworkService() {
    return { getArtwork: vi.fn(async () => ({ results: {} })) };
  }),
}));
vi.mock("../../../media", async () => {
  const shared = await import("@ent-mcp/shared/media");
  return {
    decode: shared.decode,
    listRows: vi.fn(),
    MediaService: vi.fn(function MediaService() {
      return {};
    }),
    StatusBatchMemo: vi.fn(function StatusBatchMemo() {
      return {};
    }),
  };
});

// The title endpoints bridge to the home composers (design §A6). Mock them so
// the bridge is asserted without the catalog/plugin read graph; `buildContext`
// is the SAME function the old `/home/*` procedure uses, so both surfaces build
// an identical context for the parity comparison. `homeMediaSources` only needs
// to exist for the resolver's module-load REGISTRY spread.
vi.mock("../../../home", () => ({
  homeMediaSources: {},
  buildContext: vi.fn((userId: string) => ({ userId })),
  composeDetails: vi.fn(),
  composeSeasonAvailability: vi.fn(),
  composeLayout: vi.fn(),
  composeRow: vi.fn(),
}));

vi.mock("../../../watchlist", () => ({ watchlistMediaSources: {} }));
vi.mock("../../rate-limit", () => ({ rateLimitOrNull: vi.fn(() => null) }));

const home = await import("../../../home");
const { mediaApp } = await import("../media");
const { homeApp } = await import("../home");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/media", mediaApp)
    .route("/home", homeApp)
    .notFound(() => {
      throw new HttpError(404, "http.not_found", "route not found");
    })
    .onError(errorHandler);
}

const DETAILS_FIXTURE = {
  summary: {
    id: "movie:550",
    tmdbId: "550",
    mediaType: "movie" as const,
    title: "Fight Club",
    status: "unknown" as const,
  },
  details: { cast: [] },
};

const AVAILABILITY_FIXTURE = {
  servers: [
    { serverId: "plex:c1", serverLabel: "Plex", episodesPresent: [{ season: 1, episode: 1 }] },
  ],
};

beforeEach(() => {
  mockUserId = "u1";
  vi.mocked(home.composeDetails).mockReset();
  vi.mocked(home.composeSeasonAvailability).mockReset();
  vi.mocked(home.buildContext).mockClear();
});

describe("media title resource (US-004, design §A2/§A6)", () => {
  it("requires a session", async () => {
    mockUserId = null;
    const res = await buildApp().request("/media/movie/550/details");
    expect(res.status).toBe(401);
  });

  it("bridges GET /:type/:tmdbId/details to home.composeDetails with the path params", async () => {
    vi.mocked(home.composeDetails).mockResolvedValueOnce(DETAILS_FIXTURE);
    const res = await buildApp().request("/media/movie/550/details");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DETAILS_FIXTURE);
    expect(home.composeDetails).toHaveBeenCalledWith({ userId: "u1" }, "550", "movie");
  });

  it("bridges GET /:type/:tmdbId/availability to home.composeSeasonAvailability with the tmdbId", async () => {
    vi.mocked(home.composeSeasonAvailability).mockResolvedValueOnce(AVAILABILITY_FIXTURE);
    const res = await buildApp().request("/media/tv/1396/availability");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(AVAILABILITY_FIXTURE);
    expect(home.composeSeasonAvailability).toHaveBeenCalledWith({ userId: "u1" }, "1396");
  });

  it("rejects an unknown :type with 400 http.invalid_input", async () => {
    const res = await buildApp().request("/media/anime/550/details");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("http.invalid_input");
    expect(home.composeDetails).not.toHaveBeenCalled();
  });

  it("forwards a 404 from the composer (unknown title) unchanged", async () => {
    vi.mocked(home.composeDetails).mockRejectedValueOnce(
      new HttpError(404, "http.not_found", "media not found"),
    );
    const res = await buildApp().request("/media/movie/999999/details");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("http.not_found");
  });

  // Read parity (RISK-203): the new media title URL and the old /home URL bridge
  // to the SAME composer with the SAME args and therefore return byte-identical
  // payloads. Driving both surfaces against one mocked composer pins that the
  // relocation changed only the URL, not the composition.
  it("details parity: /media/:type/:tmdbId/details === /home/details for the same title", async () => {
    vi.mocked(home.composeDetails).mockResolvedValue(DETAILS_FIXTURE);
    const app = buildApp();
    const mediaRes = await app.request("/media/movie/550/details");
    const homeRes = await app.request("/home/details?tmdbId=550&mediaType=movie");
    expect(mediaRes.status).toBe(homeRes.status);
    expect(await mediaRes.json()).toEqual(await homeRes.json());
    const [first, second] = vi.mocked(home.composeDetails).mock.calls;
    expect(first).toEqual(second);
    expect(first).toEqual([{ userId: "u1" }, "550", "movie"]);
  });

  it("availability parity: /media/:type/:tmdbId/availability === /home/season-availability", async () => {
    vi.mocked(home.composeSeasonAvailability).mockResolvedValue(AVAILABILITY_FIXTURE);
    const app = buildApp();
    const mediaRes = await app.request("/media/tv/1396/availability");
    const homeRes = await app.request("/home/season-availability?tmdbId=1396");
    expect(mediaRes.status).toBe(homeRes.status);
    expect(await mediaRes.json()).toEqual(await homeRes.json());
    const [first, second] = vi.mocked(home.composeSeasonAvailability).mock.calls;
    expect(first).toEqual(second);
    expect(first).toEqual([{ userId: "u1" }, "1396"]);
  });
});
