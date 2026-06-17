import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { encode } from "@nama/shared/media";
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

// Shared spy so the dedup test can assert a single call across both the
// eligibility gate and the source read within one request.
const getRecommendationsSpy = vi.fn().mockResolvedValue(null);

vi.mock("../../../catalog", () => ({
  getCatalogService: () => ({ getRecommendations: getRecommendationsSpy }),
  toCanonicalRow: vi.fn(),
}));
vi.mock("../../../artwork", () => ({
  ArtworkService: vi.fn(function ArtworkService() {
    return { getArtwork: vi.fn(async () => ({ results: {} })) };
  }),
}));

const sentinelPage = { items: [{ id: "item-1" }], cursor: "next-cursor", partial: false };

// Keep the real shared `decode` so the cursor-mapping cases exercise the actual
// codec (bad → null, valid → Cursor); stub `listRows` to a sentinel so the
// resolver mechanics are tested without the read pipeline / db.
vi.mock("../../../media", async () => {
  const shared = await import("@nama/shared/media");
  return {
    decode: shared.decode,
    listRows: vi.fn(async () => sentinelPage),
    MediaService: vi.fn(function MediaService() {
      return {};
    }),
    StatusBatchMemo: vi.fn(function StatusBatchMemo() {
      return {};
    }),
  };
});

// Fake registrations exercise the resolver's dispatch in isolation. The real
// registry build + read parity are covered by media-registry.test.ts and
// media-parity.test.ts.
vi.mock("../../../home", async () => {
  const { z } = await import("zod");
  // The real factory is imported directly from the internal file — safe from
  // tests because the boundary check excludes `.test.ts` files from the walk.
  const { makeRecommendationsMemo } = await import("../../../home/internal/recommendations-memo");
  const sentinelBuild = vi.fn((_ctx: unknown, _params: unknown, cursor: unknown) => ({
    source: { stages: { sort: "recentDesc", cursorMode: "keyset" } },
    cfg: { params: {}, cursor, limit: 10 },
    enrichRows: vi.fn(),
  }));
  return {
    makeRecommendationsMemo,
    homeMediaSources: {
      // Reads ctx.recommendations() from both eligibility and build so a
      // single request exercises the two read sites the memo must collapse.
      fakeHomeRecs: {
        sourceId: "fakeHomeRecs",
        rateLimit: undefined,
        paramSchema: z.object({}),
        cursorMode: "keyset",
        cursorOnNull: "400",
        eligibility: vi.fn(async (ctx: { recommendations?: () => Promise<unknown> }) => {
          if (ctx.recommendations) await ctx.recommendations();
          return true;
        }),
        build: vi.fn(
          (ctx: { recommendations?: () => Promise<unknown> }, _p: unknown, cursor: unknown) => ({
            source: {
              stages: { sort: "recentDesc", cursorMode: "keyset" },
              // Reads ctx.recommendations() a second time, simulating the source
              // fetchRawSet path (the eligibility gate already fired once).
              fetchRawSet: async () => {
                if (ctx.recommendations) await ctx.recommendations();
                return { rows: [], nextRaw: undefined };
              },
            },
            cfg: { params: {}, cursor, limit: 10 },
            enrichRows: vi.fn(),
          }),
        ),
      },
      fakeHome: {
        sourceId: "fakeHome",
        rateLimit: undefined,
        paramSchema: z.object({}),
        cursorMode: "keyset",
        cursorOnNull: "400",
        eligibility: vi.fn(async () => true),
        build: sentinelBuild,
      },
      fakeHomeIneligible: {
        sourceId: "fakeHomeIneligible",
        rateLimit: undefined,
        paramSchema: z.object({}),
        cursorMode: "keyset",
        cursorOnNull: "400",
        eligibility: vi.fn(async () => false),
        build: vi.fn(),
      },
      fakeHomeSeeded: {
        sourceId: "fakeHomeSeeded",
        rateLimit: undefined,
        paramSchema: z.object({}),
        cursorMode: "keyset",
        cursorOnNull: "400",
        requiresInitialCursor: true,
        eligibility: vi.fn(async () => true),
        build: vi.fn((_ctx: unknown, _params: unknown, cursor: unknown) => ({
          source: { stages: { sort: "recentDesc", cursorMode: "keyset" } },
          cfg: { params: {}, cursor, limit: 10 },
          enrichRows: vi.fn(),
        })),
      },
      // A multi-value source: its `genres` axis mirrors the library lens
      // `arrayParam` (a lone value coerces to a one-element array, a repeated
      // one stays an array), so the resolver must feed it the multi-value query
      // rather than a single collapsed value.
      fakeHomeMulti: {
        sourceId: "fakeHomeMulti",
        rateLimit: undefined,
        paramSchema: z.object({
          genres: z
            .preprocess(
              (v) => (v == null ? undefined : Array.isArray(v) ? v : [v]),
              z.array(z.string()).optional(),
            )
            .catch(undefined),
        }),
        cursorMode: "keyset",
        cursorOnNull: "400",
        eligibility: vi.fn(async () => true),
        build: vi.fn((_ctx: unknown, _params: unknown, cursor: unknown) => ({
          source: { stages: { sort: "recentDesc", cursorMode: "keyset" } },
          cfg: { params: {}, cursor, limit: 10 },
          enrichRows: vi.fn(),
        })),
      },
    },
  };
});

vi.mock("../../../watchlist", async () => {
  const { z } = await import("zod");
  return {
    watchlistMediaSources: {
      fakeWatchlist: {
        sourceId: "fakeWatchlist",
        rateLimit: "read",
        paramSchema: z.object({}),
        cursorMode: "keyset",
        cursorOnNull: "firstPage",
        build: vi.fn((_ctx: unknown, _params: unknown, cursor: unknown) => ({
          // No enrichRows → the default-fan-out (3-arg) `listRows` overload.
          source: { stages: { sort: "recentDesc", cursorMode: "keyset" } },
          cfg: { params: {}, cursor, limit: 10 },
        })),
      },
      fakeWatchlistParams: {
        sourceId: "fakeWatchlistParams",
        rateLimit: "read",
        paramSchema: z.object({ required: z.string() }).strict(),
        cursorMode: "keyset",
        cursorOnNull: "firstPage",
        build: vi.fn(() => ({ source: { stages: { sort: "none" } }, cfg: {} })),
      },
    },
  };
});

// Spy on `rateLimitOrNull` while keeping the real `makeRateLimitMiddleware`, so
// the resolver's dynamic per-source limiter assertions still observe the calls.
vi.mock("../../rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("../../rate-limit");
  return { ...actual, rateLimitOrNull: vi.fn(() => null) };
});

const media = await import("../../../media");
const home = await import("../../../home");
const watchlist = await import("../../../watchlist");
const { rateLimitOrNull } = await import("../../rate-limit");
const { watchlistReadLimiter } = await import("../media");
const { mediaApp } = await import("../media");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/media", mediaApp)
    .notFound(() => {
      throw new HttpError(404, "http.not_found", "route not found");
    })
    .onError(errorHandler);
}

type AnyReg = { build: ReturnType<typeof vi.fn>; eligibility?: ReturnType<typeof vi.fn> };
const homeReg = (id: string) => (home.homeMediaSources as unknown as Record<string, AnyReg>)[id]!;
const watchlistReg = (id: string) =>
  (watchlist.watchlistMediaSources as unknown as Record<string, AnyReg>)[id]!;

beforeEach(() => {
  mockUserId = "u1";
  vi.mocked(media.listRows).mockClear();
  vi.mocked(rateLimitOrNull).mockReset().mockReturnValue(null);
  getRecommendationsSpy.mockClear();
  for (const id of [
    "fakeHome",
    "fakeHomeIneligible",
    "fakeHomeSeeded",
    "fakeHomeMulti",
    "fakeHomeRecs",
  ]) {
    homeReg(id).build.mockClear();
    homeReg(id).eligibility?.mockClear();
  }
  for (const id of ["fakeWatchlist", "fakeWatchlistParams"]) {
    watchlistReg(id).build.mockClear();
  }
});

describe("media source resolver (US-003, design §A3)", () => {
  it("requires a session", async () => {
    mockUserId = null;
    const res = await buildApp().request("/media/sources/fakeHome");
    expect(res.status).toBe(401);
  });

  it("404s an unknown sourceId with media.source_unknown", async () => {
    const res = await buildApp().request("/media/sources/nope");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("media.source_unknown");
  });

  it("404s a prototype-property sourceId instead of crashing (Object.hasOwn guard)", async () => {
    // A bare `REGISTRY[sourceId]` returns the prototype value for these names
    // (truthy), slipping past the 404 and crashing on `reg.paramSchema` (500).
    for (const id of ["__proto__", "constructor", "toString", "valueOf"]) {
      const res = await buildApp().request(`/media/sources/${id}`);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { code: string }).code).toBe("media.source_unknown");
    }
  });

  it("404s an ineligible home source with media.source_ineligible", async () => {
    const res = await buildApp().request("/media/sources/fakeHomeIneligible");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("media.source_ineligible");
    expect(homeReg("fakeHomeIneligible").build).not.toHaveBeenCalled();
  });

  it("treats an eligibility throw as ineligible (matches composeRowPage)", async () => {
    homeReg("fakeHome").eligibility!.mockRejectedValueOnce(new Error("boom"));
    const res = await buildApp().request("/media/sources/fakeHome");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("media.source_ineligible");
  });

  it("returns 200 + the one Page shape and builds with a null first-page cursor", async () => {
    const res = await buildApp().request("/media/sources/fakeHome");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(sentinelPage);
    expect(homeReg("fakeHome").build.mock.calls[0]![2]).toBeNull();
  });

  it("passes enrichRows to listRows for a home source and omits it for watchlist", async () => {
    await buildApp().request("/media/sources/fakeHome");
    expect(vi.mocked(media.listRows).mock.calls[0]).toHaveLength(4);

    await buildApp().request("/media/sources/fakeWatchlist");
    expect(vi.mocked(media.listRows).mock.calls[1]).toHaveLength(3);
  });

  it("400s invalid params with http.invalid_input", async () => {
    const res = await buildApp().request("/media/sources/fakeWatchlistParams");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("http.invalid_input");
  });

  it("feeds a repeated query param to the source schema as an array (multi-value)", async () => {
    // The library lens filters arrive as repeated params (?genres=Drama&genres=
    // Crime); the resolver must parse them multi-value so both reach the source,
    // not just the first.
    const res = await buildApp().request("/media/sources/fakeHomeMulti?genres=Drama&genres=Crime");
    expect(res.status).toBe(200);
    expect(homeReg("fakeHomeMulti").build.mock.calls[0]![1]).toEqual({
      genres: ["Drama", "Crime"],
    });
  });

  it("coerces a lone occurrence to a one-element array for a tolerant array schema", async () => {
    // `c.req.valid("query")` hands a lone occurrence to the schema as a plain
    // string (`{ genres: "Drama" }`); the lens's tolerant `arrayParam`
    // (`Array.isArray(v) ? v : [v]`) then coerces it to `["Drama"]`. So a
    // single-value selection reaches the source as a one-element array — the
    // same axis shape a multi-value selection takes. (The strict single-value
    // parity delta is pinned by the RISK-202 case below.)
    const res = await buildApp().request("/media/sources/fakeHomeMulti?genres=Drama");
    expect(res.status).toBe(200);
    expect(homeReg("fakeHomeMulti").build.mock.calls[0]![1]).toEqual({ genres: ["Drama"] });
  });

  it("400s a repeated param against a strict single-value schema (RISK-202 delta)", async () => {
    // Reading `c.req.valid("query")` surfaces a repeated param as a `string[]`.
    // A strict single-value schema (`z.string()`) rejects the array → 400, where
    // the old `c.req.query()` read would have silently taken the first value.
    // This is the intended, more-correct behavior: home/watchlist sources never
    // emit repeated params, so a repeated one is a malformed request, not a
    // value to quietly truncate. Pinned so the parity delta stays deliberate.
    const res = await buildApp().request(
      "/media/sources/fakeWatchlistParams?required=a&required=b",
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("http.invalid_input");
    expect(watchlistReg("fakeWatchlistParams").build).not.toHaveBeenCalled();
  });

  it("400s an undecodable cursor on a home source (cursorOnNull '400')", async () => {
    const res = await buildApp().request("/media/sources/fakeHome?cursor=%7Bnot-a-cursor");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("media.cursor_invalid");
  });

  it("falls a bad cursor to the first page on a watchlist source (cursorOnNull 'firstPage')", async () => {
    const res = await buildApp().request("/media/sources/fakeWatchlist?cursor=garbage");
    expect(res.status).toBe(200);
    // The undecodable cursor mapped to `null` → first page, never a 400.
    expect(watchlistReg("fakeWatchlist").build.mock.calls[0]![2]).toBeNull();
  });

  it("400s a cursor-less seeded home source with media.cursor_required", async () => {
    const res = await buildApp().request("/media/sources/fakeHomeSeeded");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("media.cursor_required");
  });

  it("decodes a valid keyset cursor and threads it onto build", async () => {
    const raw = encode({ mode: "keyset", k: "42:id-a" });
    const res = await buildApp().request(`/media/sources/fakeHomeSeeded?cursor=${raw}`);
    expect(res.status).toBe(200);
    expect(homeReg("fakeHomeSeeded").build.mock.calls[0]![2]).toEqual({
      mode: "keyset",
      k: "42:id-a",
    });
  });

  it("applies the read limiter for a watchlist source and none for a home source", async () => {
    await buildApp().request("/media/sources/fakeWatchlist");
    expect(rateLimitOrNull).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rateLimitOrNull).mock.calls[0]![0]).toBe(watchlistReadLimiter);

    vi.mocked(rateLimitOrNull).mockClear();
    await buildApp().request("/media/sources/fakeHome");
    expect(rateLimitOrNull).not.toHaveBeenCalled();
  });

  it("short-circuits with a 429 when the limiter throttles", async () => {
    vi.mocked(rateLimitOrNull).mockReturnValueOnce(
      new Response(JSON.stringify({ code: "mcp.rate_limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }) as never,
    );
    const res = await buildApp().request("/media/sources/fakeWatchlist");
    expect(res.status).toBe(429);
    // The throttle fired before the source was built.
    expect(watchlistReg("fakeWatchlist").build).not.toHaveBeenCalled();
  });
});

describe("buildSourceContext recommendations memo (issue #681)", () => {
  // The `recommendedForYou-*` rows read the user's default rec list from both
  // their eligibility gate and their source `fetchRawSet` on each request.
  // `buildSourceContext` must wire a `makeRecommendationsMemo`-backed accessor
  // so those two (or more) reads collapse to a single `getRecommendations` call
  // per request, and a second request gets its own fresh fetch.
  it("collapses eligibility + source reads to one getRecommendations call per request", async () => {
    // `fakeHomeRecs` reads ctx.recommendations() from eligibility and build.
    await buildApp().request("/media/sources/fakeHomeRecs");
    expect(getRecommendationsSpy).toHaveBeenCalledTimes(1);
    expect(getRecommendationsSpy).toHaveBeenCalledWith("u1", "default");
  });

  it("issues a fresh getRecommendations call for each distinct request", async () => {
    await buildApp().request("/media/sources/fakeHomeRecs");
    await buildApp().request("/media/sources/fakeHomeRecs");
    // Each request creates its own SourceContext (and its own memo), so two
    // requests must each fire exactly one underlying call — two total.
    expect(getRecommendationsSpy).toHaveBeenCalledTimes(2);
  });
});
