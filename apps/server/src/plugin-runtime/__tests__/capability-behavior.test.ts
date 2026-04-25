import { describe, it, expect } from "vite-plus/test";
import type { PluginContext } from "@ent-mcp/plugin-sdk";
import { isPluginError } from "@ent-mcp/plugin-sdk";
import traktPlugin from "@ent-mcp/plugin-trakt";
import tmdbPlugin from "@ent-mcp/plugin-tmdb";
import seerrPlugin from "@ent-mcp/plugin-seerr";

// Minimal PluginContext mock with a queue-based fetch. Each test pushes the
// responses it expects and asserts both the emitted requests and the plugin
// return value.
interface FakeCall {
  url: string;
  init?: RequestInit;
}
function makeCtx(
  responses: Array<Response | Error>,
  overrides: Partial<PluginContext> = {},
): PluginContext & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const ctx = {
    calls,
    async fetch(url: string, init?: RequestInit) {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error(`unexpected fetch: ${url}`);
      if (next instanceof Error) throw next;
      return next;
    },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    credentials: null,
    sharedCredentials: null,
    config: { global: null, user: null },
    store: {
      async get() {
        return undefined;
      },
      async set() {},
      async delete() {},
    },
    pool: { markExhausted() {} },
    ...overrides,
  } as unknown as PluginContext & { calls: FakeCall[] };
  return ctx;
}

function jsonRes(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function statusRes(status: number, body: string = ""): Response {
  // 204/205/304 must be constructed with a null body per the spec.
  const nullBody = status === 204 || status === 205 || status === 304;
  return new Response(nullBody ? null : body, { status });
}

describe("seerr cancelRequest", () => {
  const seerrCap = seerrPlugin.capabilities.mediaRequest!;

  it("treats 204 as success", async () => {
    const ctx = makeCtx([statusRes(204)], {
      credentials: { sessionCookie: "x", userId: 1 },
      sharedCredentials: null,
      config: { global: { baseUrl: "https://seerr.example" }, user: null },
    });
    const r = (await seerrCap.cancelRequest!(ctx, { requestId: "42" })) as {
      ok: boolean;
    };
    expect(r.ok).toBe(true);
  });

  it("treats 404 as idempotent success (regression: handleStatus used to throw first)", async () => {
    const ctx = makeCtx([statusRes(404)], {
      credentials: { sessionCookie: "x", userId: 1 },
      sharedCredentials: null,
      config: { global: { baseUrl: "https://seerr.example" }, user: null },
    });
    const r = (await seerrCap.cancelRequest!(ctx, { requestId: "42" })) as {
      ok: boolean;
    };
    expect(r.ok).toBe(true);
  });

  it("throws plugin.token_expired on 401 (regression: used to swallow into message)", async () => {
    // Host-actionable errors must escape the graceful { ok: false } contract
    // so the token-refresh signal fires.
    const ctx = makeCtx([statusRes(401)], {
      credentials: { sessionCookie: "x", userId: 1 },
      sharedCredentials: null,
      config: { global: { baseUrl: "https://seerr.example" }, user: null },
    });
    let caught: unknown;
    try {
      await seerrCap.cancelRequest!(ctx, { requestId: "42" });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.token_expired");
  });

  it("throws plugin.rate_limited on 429", async () => {
    const ctx = makeCtx([statusRes(429)], {
      credentials: { sessionCookie: "x", userId: 1 },
      sharedCredentials: null,
      config: { global: { baseUrl: "https://seerr.example" }, user: null },
    });
    let caught: unknown;
    try {
      await seerrCap.cancelRequest!(ctx, { requestId: "42" });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.rate_limited");
  });

  it("returns ok:false on other non-2xx statuses", async () => {
    const ctx = makeCtx([statusRes(403)], {
      credentials: { sessionCookie: "x", userId: 1 },
      sharedCredentials: null,
      config: { global: { baseUrl: "https://seerr.example" }, user: null },
    });
    const r = (await seerrCap.cancelRequest!(ctx, { requestId: "42" })) as {
      ok: boolean;
    };
    expect(r.ok).toBe(false);
  });
});

describe("seerr createRequest auth propagation", () => {
  const seerrCap = seerrPlugin.capabilities.mediaRequest!;

  it("throws plugin.token_expired on 401 rather than absorbing it into success:false", async () => {
    const ctx = makeCtx([statusRes(401)], {
      credentials: { sessionCookie: "x", userId: 1 },
      sharedCredentials: null,
      config: { global: { baseUrl: "https://seerr.example" }, user: null },
    });
    let caught: unknown;
    try {
      await seerrCap.createRequest!(ctx, { tmdbId: "99", type: "movie" });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.token_expired");
  });

  it("still absorbs upstream errors into { success: false, message }", async () => {
    const ctx = makeCtx([statusRes(500, "boom")], {
      credentials: { sessionCookie: "x", userId: 1 },
      sharedCredentials: null,
      config: { global: { baseUrl: "https://seerr.example" }, user: null },
    });
    const r = (await seerrCap.createRequest!(ctx, { tmdbId: "99", type: "movie" })) as {
      success: boolean;
      message?: string;
    };
    expect(r.success).toBe(false);
    expect(r.message).toContain("500");
  });
});

describe("trakt write method auth propagation", () => {
  const traktHistory = traktPlugin.capabilities.watchHistory!;
  const traktRatings = traktPlugin.capabilities.ratings!;
  const traktCollection = traktPlugin.capabilities.collection!;

  const sharedCreds = { clientId: "cid", clientSecret: "sec" };
  const userCreds = {
    accessToken: "at",
    refreshToken: "rt",
    createdAt: Date.now(),
    expiresIn: 3600,
  };

  it("removeFromHistory throws plugin.token_expired on 401 (was plugin.upstream_error)", async () => {
    const ctx = makeCtx([statusRes(401, "unauth")], {
      credentials: userCreds,
      sharedCredentials: sharedCreds,
    });
    let caught: unknown;
    try {
      await traktHistory.removeFromHistory!(ctx, [{ type: "movie", ids: { trakt_id: "1" } }]);
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.token_expired");
  });

  it("addToCollection throws plugin.token_expired on 401", async () => {
    const ctx = makeCtx([statusRes(401, "unauth")], {
      credentials: userCreds,
      sharedCredentials: sharedCreds,
    });
    let caught: unknown;
    try {
      await traktCollection.addToCollection!(ctx, [{ type: "movie", ids: { trakt_id: "1" } }]);
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.token_expired");
  });

  it("removeFromCollection throws plugin.token_expired on 401", async () => {
    const ctx = makeCtx([statusRes(401, "unauth")], {
      credentials: userCreds,
      sharedCredentials: sharedCreds,
    });
    let caught: unknown;
    try {
      await traktCollection.removeFromCollection!(ctx, [{ type: "movie", ids: { trakt_id: "1" } }]);
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.token_expired");
  });

  it("removeRating throws plugin.token_expired on 401 (regression: used to swallow silently)", async () => {
    const ctx = makeCtx([statusRes(401, "unauth")], {
      credentials: userCreds,
      sharedCredentials: sharedCreds,
    });
    let caught: unknown;
    try {
      await traktRatings.removeRating!(ctx, {
        item: { type: "movie", ids: { trakt_id: "1" } },
      });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.token_expired");
  });

  it("removeRating rejects non-numeric trakt ids up front (regression: Number() produced NaN)", async () => {
    const ctx = makeCtx([], {
      credentials: userCreds,
      sharedCredentials: sharedCreds,
    });
    let caught: unknown;
    try {
      await traktRatings.removeRating!(ctx, {
        item: { type: "movie", ids: { trakt_id: "not-a-number" } },
      });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.input_invalid");
  });

  it("removeFromHistory drops items with non-numeric trakt ids", async () => {
    const ctx = makeCtx([jsonRes({ deleted: { movies: 1, episodes: 0 } })], {
      credentials: userCreds,
      sharedCredentials: sharedCreds,
    });
    const r = (await traktHistory.removeFromHistory!(ctx, [
      { type: "movie", ids: { trakt_id: "42" } },
      { type: "movie", ids: { trakt_id: "NaN" } },
      { type: "tv", ids: {} },
    ])) as { removed: number };
    expect(r.removed).toBe(1);
    // Payload contains only the numeric id, NaN and missing ids are dropped.
    const body = ctx.calls[0]?.init?.body;
    expect(typeof body).toBe("string");
    const payload = JSON.parse(body as string);
    expect(payload).toEqual({ movies: [{ ids: { trakt: 42 } }], shows: [] });
  });
});

describe("trakt playback.removePosition", () => {
  const traktPlayback = traktPlugin.capabilities.playback!;
  const sharedCreds = { clientId: "cid", clientSecret: "sec" };
  const userCreds = {
    accessToken: "at",
    refreshToken: "rt",
    createdAt: Date.now(),
    expiresIn: 3600,
  };

  it("returns ok:true on 204 success", async () => {
    const ctx = makeCtx([statusRes(204)], {
      credentials: userCreds,
      sharedCredentials: sharedCreds,
    });
    const r = (await traktPlayback.removePosition!(ctx, { playbackId: "99" })) as {
      ok: boolean;
    };
    expect(r.ok).toBe(true);
  });

  it("returns ok:true on 404 (already cleared — idempotent)", async () => {
    const ctx = makeCtx([statusRes(404)], {
      credentials: userCreds,
      sharedCredentials: sharedCreds,
    });
    const r = (await traktPlayback.removePosition!(ctx, { playbackId: "99" })) as {
      ok: boolean;
    };
    expect(r.ok).toBe(true);
  });

  it("throws plugin.token_expired on 401 (regression: 401 must not be swallowed)", async () => {
    const ctx = makeCtx([statusRes(401, "unauth")], {
      credentials: userCreds,
      sharedCredentials: sharedCreds,
    });
    let caught: unknown;
    try {
      await traktPlayback.removePosition!(ctx, { playbackId: "99" });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.token_expired");
  });

  it("throws plugin.rate_limited on 429", async () => {
    const ctx = makeCtx([statusRes(429, "slow down")], {
      credentials: userCreds,
      sharedCredentials: sharedCreds,
    });
    let caught: unknown;
    try {
      await traktPlayback.removePosition!(ctx, { playbackId: "99" });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.rate_limited");
  });

  it("throws plugin.upstream_error on 5xx", async () => {
    const ctx = makeCtx([statusRes(503, "down")], {
      credentials: userCreds,
      sharedCredentials: sharedCreds,
    });
    let caught: unknown;
    try {
      await traktPlayback.removePosition!(ctx, { playbackId: "99" });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.upstream_error");
  });
});

describe("trakt collection.getCollection merge path", () => {
  const traktCollection = traktPlugin.capabilities.collection!;
  const sharedCreds = { clientId: "cid", clientSecret: "sec" };
  const userCreds = {
    accessToken: "at",
    refreshToken: "rt",
    createdAt: Date.now(),
    expiresIn: 3600,
  };

  it("merges movies and shows when no type filter is provided", async () => {
    // Without `type`, the plugin fires two requests in parallel and merges
    // the results. Both endpoints must resolve before the caller gets the
    // combined array — this asserts the movie + show rows both land in the
    // output and retain their respective addedAt fields.
    const ctx = makeCtx(
      [
        jsonRes([
          {
            collected_at: "2026-01-01T00:00:00Z",
            movie: { ids: { trakt: 1, slug: "a" }, title: "A", year: 2026 },
          },
        ]),
        jsonRes([
          {
            last_collected_at: "2026-02-01T00:00:00Z",
            show: { ids: { trakt: 2, slug: "b" }, title: "B", year: 2025 },
          },
        ]),
      ],
      { credentials: userCreds, sharedCredentials: sharedCreds },
    );
    const r = (await traktCollection.getCollection!(ctx, {})) as Array<{
      item: { type: string; title: string };
      addedAt: string;
    }>;
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.item.type === "movie")?.addedAt).toBe("2026-01-01T00:00:00Z");
    expect(r.find((x) => x.item.type === "tv")?.addedAt).toBe("2026-02-01T00:00:00Z");
    // Requests: one to /sync/collection/movies, one to /sync/collection/shows.
    expect(ctx.calls.map((c) => c.url).sort()).toEqual([
      "https://api.trakt.tv/sync/collection/movies",
      "https://api.trakt.tv/sync/collection/shows",
    ]);
  });
});

describe("trakt getAnticipated robustness", () => {
  const traktRecs = traktPlugin.capabilities.recommendations!;
  const sharedCreds = { clientId: "cid", clientSecret: "sec" };

  it("skips rows missing the expected nested object", async () => {
    const ctx = makeCtx(
      [
        jsonRes([
          { list_count: 100, movie: { ids: { trakt: 1, slug: "a" }, title: "A", year: 2026 } },
          { list_count: 50 }, // malformed: no movie/show
        ]),
      ],
      { sharedCredentials: sharedCreds, credentials: null },
    );
    const r = (await traktRecs.getAnticipated!(ctx, { type: "movie" })) as Array<unknown>;
    expect(r).toHaveLength(1);
  });
});

describe("trakt row-mapping robustness", () => {
  const traktHistory = traktPlugin.capabilities.watchHistory!;
  const traktRecs = traktPlugin.capabilities.recommendations!;
  const traktPlayback = traktPlugin.capabilities.playback!;
  const sharedCreds = { clientId: "cid", clientSecret: "sec" };
  const userCreds = {
    accessToken: "at",
    refreshToken: "rt",
    createdAt: Date.now(),
    expiresIn: 3600,
  };

  it("getHistory drops rows missing both movie and show", async () => {
    // traktPaginate defaults page-count to 1 when the header is absent, so a
    // single response is enough to exercise the mapper.
    const ctx = makeCtx(
      [
        jsonRes([
          {
            id: 1,
            watched_at: "2026-01-01T00:00:00Z",
            type: "movie",
            movie: { ids: { trakt: 1, slug: "a" }, title: "A", year: 2026 },
          },
          { id: 2, watched_at: "2026-01-02T00:00:00Z", type: "episode" }, // malformed
        ]),
      ],
      { credentials: userCreds, sharedCredentials: sharedCreds },
    );
    const r = (await traktHistory.getHistory!(ctx, {})) as Array<unknown>;
    expect(r).toHaveLength(1);
  });

  it("getTrending skips rows missing the requested media object", async () => {
    const ctx = makeCtx(
      [
        jsonRes([
          { watchers: 100, movie: { ids: { trakt: 1, slug: "a" }, title: "A", year: 2026 } },
          { watchers: 50 }, // malformed: no movie
        ]),
      ],
      { credentials: userCreds, sharedCredentials: sharedCreds },
    );
    const r = (await traktRecs.getTrending!(ctx, { type: "movie" })) as Array<unknown>;
    expect(r).toHaveLength(1);
  });

  it("getPositions drops rows missing both movie and show", async () => {
    const ctx = makeCtx(
      [
        jsonRes([
          {
            id: 10,
            progress: 40,
            paused_at: "2026-01-01T00:00:00Z",
            type: "movie",
            movie: { ids: { trakt: 1, slug: "a" }, title: "A", year: 2026 },
          },
          { id: 11, progress: 60, paused_at: "2026-01-02T00:00:00Z", type: "episode" }, // malformed
        ]),
      ],
      { credentials: userCreds, sharedCredentials: sharedCreds },
    );
    const r = (await traktPlayback.getPositions!(ctx, {})) as Array<unknown>;
    expect(r).toHaveLength(1);
  });
});

describe("parseTraktId strict digit validation (via removeRating)", () => {
  const traktRatings = traktPlugin.capabilities.ratings!;
  const sharedCreds = { clientId: "cid", clientSecret: "sec" };
  const userCreds = {
    accessToken: "at",
    refreshToken: "rt",
    createdAt: Date.now(),
    expiresIn: 3600,
  };

  it("rejects prefix-matched digits like '42abc' (regression: parseInt accepted them)", async () => {
    const ctx = makeCtx([], { credentials: userCreds, sharedCredentials: sharedCreds });
    let caught: unknown;
    try {
      await traktRatings.removeRating!(ctx, {
        item: { type: "movie", ids: { trakt_id: "42abc" } },
      });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.input_invalid");
  });
});

describe("tmdb capability behavior", () => {
  const tmdbWatchProviders = tmdbPlugin.capabilities.watchProviders!;
  const tmdbTrailers = tmdbPlugin.capabilities.trailers!;

  it("getProviders defaults region to US when omitted", async () => {
    const ctx = makeCtx(
      [
        jsonRes({
          results: {
            US: { flatrate: [{ provider_name: "Netflix" }] },
            GB: { flatrate: [{ provider_name: "BBC iPlayer" }] },
          },
        }),
      ],
      { sharedCredentials: { apiKey: "dummy" }, config: { global: {}, user: null } },
    );
    const r = (await tmdbWatchProviders.getProviders!(ctx, {
      id: "1",
      type: "movie",
    })) as { streaming: string[] };
    expect(r.streaming).toEqual(["Netflix"]);
  });

  it("getProviders honors an explicit region", async () => {
    const ctx = makeCtx(
      [
        jsonRes({
          results: {
            US: { flatrate: [{ provider_name: "Netflix" }] },
            GB: { flatrate: [{ provider_name: "BBC iPlayer" }] },
          },
        }),
      ],
      { sharedCredentials: { apiKey: "dummy" }, config: { global: {}, user: null } },
    );
    const r = (await tmdbWatchProviders.getProviders!(ctx, {
      id: "1",
      type: "movie",
      region: "GB",
    })) as { streaming: string[] };
    expect(r.streaming).toEqual(["BBC iPlayer"]);
  });

  it("getVideos returns a real URL for YouTube/Vimeo and null for unknown sites", async () => {
    const ctx = makeCtx(
      [
        jsonRes({
          results: [
            { key: "abc", site: "YouTube", type: "Trailer", official: true },
            { key: "def", site: "Vimeo", type: "Teaser" },
            { key: "xyz", site: "Facebook", type: "Clip" },
          ],
        }),
      ],
      { sharedCredentials: { apiKey: "dummy" }, config: { global: {}, user: null } },
    );
    const r = (await tmdbTrailers.getVideos!(ctx, { id: "1", type: "movie" })) as Array<{
      site: string;
      url: string | null;
    }>;
    expect(r[0]?.url).toBe("https://www.youtube.com/watch?v=abc");
    expect(r[1]?.url).toBe("https://vimeo.com/def");
    // Unknown site — we no longer return the bare key; it would be semantically
    // invalid as a URL. Null signals "no URL available".
    expect(r[2]?.url).toBeNull();
  });
});
