import { describe, it, expect } from "vite-plus/test";
import type { PluginContext } from "@ent-mcp/plugin-sdk";
import {
  WatchHistoryV1,
  WatchlistV1,
  RatingsV1,
  RecommendationsV1,
  CalendarV1,
  PlaybackV1,
  CollectionV1,
  UserCommentsV1,
  IdResolveV1,
} from "@ent-mcp/plugin-sdk";
import { validatePluginModule } from "@ent-mcp/plugin-sdk";
import traktPlugin from "../src/plugin";

// Contract tests: drive every declared capability method end-to-end with a
// stubbed ctx, verify the request URL is what we expect to hit on Trakt, and
// confirm the plugin's return value parses against the capability's Zod
// output schema.

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
    credentials: {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      createdAt: 0,
      expiresIn: 60 * 60 * 24 * 30,
    },
    sharedCredentials: { clientId: "cid", clientSecret: "csecret" },
    config: { global: null, user: null },
    store: {
      async get() {
        return undefined;
      },
      async set() {},
      async delete() {},
    },
    pool: { markExhausted() {} },
    appBaseUrl: "https://app.example.com",
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
  const nullBody = status === 204 || status === 205 || status === 304;
  return new Response(nullBody ? null : body, { status });
}

// Paginated endpoints read X-Pagination-Page-Count from the first response.
function paginatedPage(body: unknown, pageCount: number = 1): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "X-Pagination-Page-Count": String(pageCount),
    },
  });
}

const MOVIE = {
  ids: { trakt: 1, slug: "fight-club", imdb: "tt0137523", tmdb: 550 },
  title: "Fight Club",
  year: 1999,
};
const SHOW = {
  ids: { trakt: 2, slug: "got", imdb: "tt0944947", tmdb: 1399, tvdb: 121361 },
  title: "Game of Thrones",
  year: 2011,
};

describe("trakt plugin passes loader validation", () => {
  it("validates against the manifest + capability catalog", async () => {
    await expect(validatePluginModule(traktPlugin)).resolves.toBeDefined();
  });
});

describe("trakt capability contract", () => {
  // --- watchHistory ---
  it("watchHistory.getHistory: paginates /sync/history", async () => {
    const ctx = makeCtx([
      paginatedPage([{ id: 1, watched_at: "2026-04-01", type: "movie", movie: MOVIE }]),
    ]);
    const out = await traktPlugin.capabilities.watchHistory!.getHistory!(ctx, {});
    expect(ctx.calls[0]?.url).toContain("/sync/history");
    expect(ctx.calls[0]?.url).toContain("page=1");
    expect(WatchHistoryV1.methods.getHistory.output.safeParse(out).success).toBe(true);
  });

  it("watchHistory.getHistory: appends start_at when since is provided", async () => {
    const ctx = makeCtx([paginatedPage([])]);
    await traktPlugin.capabilities.watchHistory!.getHistory!(ctx, {
      since: "2026-01-01T00:00:00Z",
    });
    expect(ctx.calls[0]?.url).toContain("/sync/history?start_at=");
    expect(ctx.calls[0]?.url).toContain("2026-01-01");
  });

  it("watchHistory.addToHistory: POST /sync/history with split movies/shows", async () => {
    const ctx = makeCtx([jsonRes({ added: { movies: 1, episodes: 0 } })]);
    const out = await traktPlugin.capabilities.watchHistory!.addToHistory!(ctx, [
      { type: "movie", ids: { trakt_id: "1" } },
    ]);
    expect(ctx.calls[0]?.url).toContain("/sync/history");
    expect(ctx.calls[0]?.init?.method).toBe("POST");
    expect(WatchHistoryV1.methods.addToHistory.output.safeParse(out).success).toBe(true);
  });

  it("watchHistory.removeFromHistory: POST /sync/history/remove", async () => {
    const ctx = makeCtx([jsonRes({ deleted: { movies: 1 } })]);
    const out = await traktPlugin.capabilities.watchHistory!.removeFromHistory!(ctx, [
      { type: "movie", ids: { trakt_id: "1" } },
    ]);
    expect(ctx.calls[0]?.url).toContain("/sync/history/remove");
    expect(WatchHistoryV1.methods.removeFromHistory.output.safeParse(out).success).toBe(true);
  });

  // --- watchlist ---
  it("watchlist.getWatchlist (movie): hits /sync/watchlist/movies", async () => {
    const ctx = makeCtx([jsonRes([{ listed_at: "2026-04-01", type: "movie", movie: MOVIE }])]);
    const out = await traktPlugin.capabilities.watchlist!.getWatchlist!(ctx, { type: "movie" });
    expect(ctx.calls[0]?.url).toContain("/sync/watchlist/movies");
    expect(WatchlistV1.methods.getWatchlist.output.safeParse(out).success).toBe(true);
  });

  it("watchlist.addToWatchlist: POST /sync/watchlist", async () => {
    const ctx = makeCtx([jsonRes({ added: { movies: 1 } })]);
    const out = await traktPlugin.capabilities.watchlist!.addToWatchlist!(ctx, [
      { type: "movie", ids: { trakt_id: "1" } },
    ]);
    expect(ctx.calls[0]?.url).toContain("/sync/watchlist");
    expect(WatchlistV1.methods.addToWatchlist.output.safeParse(out).success).toBe(true);
  });

  it("watchlist.removeFromWatchlist: POST /sync/watchlist/remove", async () => {
    const ctx = makeCtx([jsonRes({ deleted: { movies: 1 } })]);
    const out = await traktPlugin.capabilities.watchlist!.removeFromWatchlist!(ctx, [
      { type: "movie", ids: { trakt_id: "1" } },
    ]);
    expect(ctx.calls[0]?.url).toContain("/sync/watchlist/remove");
    expect(WatchlistV1.methods.removeFromWatchlist.output.safeParse(out).success).toBe(true);
  });

  // --- ratings ---
  it("ratings.getRatings (tv): hits /sync/ratings/shows", async () => {
    const ctx = makeCtx([jsonRes([{ rated_at: "2026-04-01", rating: 8, show: SHOW }])]);
    const out = await traktPlugin.capabilities.ratings!.getRatings!(ctx, { type: "tv" });
    expect(ctx.calls[0]?.url).toContain("/sync/ratings/shows");
    expect(RatingsV1.methods.getRatings.output.safeParse(out).success).toBe(true);
  });

  it("ratings.setRating: POST /sync/ratings", async () => {
    const ctx = makeCtx([jsonRes({ added: { movies: 1 } })]);
    const out = await traktPlugin.capabilities.ratings!.setRating!(ctx, {
      item: { type: "movie", ids: { trakt_id: "1" } },
      rating: 9,
    });
    expect(ctx.calls[0]?.url).toContain("/sync/ratings");
    expect(RatingsV1.methods.setRating.output.safeParse(out).success).toBe(true);
  });

  it("ratings.removeRating: POST /sync/ratings/remove", async () => {
    const ctx = makeCtx([jsonRes({ deleted: { movies: 1 } })]);
    const out = await traktPlugin.capabilities.ratings!.removeRating!(ctx, {
      item: { type: "movie", ids: { trakt_id: "1" } },
    });
    expect(ctx.calls[0]?.url).toContain("/sync/ratings/remove");
    expect(RatingsV1.methods.removeRating.output.safeParse(out).success).toBe(true);
  });

  // --- recommendations ---
  it("recommendations.getRecommendations (movie): hits /recommendations/movies", async () => {
    const ctx = makeCtx([jsonRes([MOVIE])]);
    const out = await traktPlugin.capabilities.recommendations!.getRecommendations!(ctx, {
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/recommendations/movies");
    expect(RecommendationsV1.methods.getRecommendations.output.safeParse(out).success).toBe(true);
  });

  it("recommendations.getTrending (tv): hits /shows/trending", async () => {
    const ctx = makeCtx([jsonRes([{ watchers: 10, show: SHOW }])]);
    const out = await traktPlugin.capabilities.recommendations!.getTrending!(ctx, { type: "tv" });
    expect(ctx.calls[0]?.url).toContain("/shows/trending");
    expect(RecommendationsV1.methods.getTrending.output.safeParse(out).success).toBe(true);
  });

  it("recommendations.getAnticipated (movie): hits /movies/anticipated", async () => {
    const ctx = makeCtx([jsonRes([{ list_count: 1, movie: MOVIE }])]);
    const out = await traktPlugin.capabilities.recommendations!.getAnticipated!(ctx, {
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/movies/anticipated");
    expect(RecommendationsV1.methods.getAnticipated.output.safeParse(out).success).toBe(true);
  });

  // --- calendar ---
  it("calendar.getUpcoming: hits /calendars/my/shows/{start}/{days}", async () => {
    const ctx = makeCtx([
      jsonRes([
        {
          first_aired: "2026-04-02",
          episode: { season: 1, number: 1, title: "Pilot" },
          show: SHOW,
        },
      ]),
    ]);
    const out = await traktPlugin.capabilities.calendar!.getUpcoming!(ctx, { days: 7 });
    expect(ctx.calls[0]?.url).toMatch(/\/calendars\/my\/shows\/\d{4}-\d{2}-\d{2}\/7/);
    expect(CalendarV1.methods.getUpcoming.output.safeParse(out).success).toBe(true);
  });

  it("calendar.getUpcomingMovies: hits /calendars/my/movies/{start}/{days}", async () => {
    const ctx = makeCtx([jsonRes([{ released: "2026-04-05", movie: MOVIE }])]);
    const out = await traktPlugin.capabilities.calendar!.getUpcomingMovies!(ctx, { days: 30 });
    expect(ctx.calls[0]?.url).toMatch(/\/calendars\/my\/movies\/\d{4}-\d{2}-\d{2}\/30/);
    expect(CalendarV1.methods.getUpcomingMovies.output.safeParse(out).success).toBe(true);
  });

  // --- playback ---
  it("playback.getPositions: hits /sync/playback (no type filter)", async () => {
    const ctx = makeCtx([
      jsonRes([{ id: 1, progress: 50, paused_at: "2026-04-01", type: "movie", movie: MOVIE }]),
    ]);
    const out = await traktPlugin.capabilities.playback!.getPositions!(ctx, {});
    expect(ctx.calls[0]?.url).toMatch(/\/sync\/playback$/);
    expect(PlaybackV1.methods.getPositions.output.safeParse(out).success).toBe(true);
  });

  it("playback.getPositions (movie): hits /sync/playback/movies", async () => {
    const ctx = makeCtx([jsonRes([])]);
    await traktPlugin.capabilities.playback!.getPositions!(ctx, { type: "movie" });
    expect(ctx.calls[0]?.url).toContain("/sync/playback/movies");
  });

  it("playback.getPositions (tv): hits /sync/playback/episodes", async () => {
    const ctx = makeCtx([jsonRes([])]);
    await traktPlugin.capabilities.playback!.getPositions!(ctx, { type: "tv" });
    expect(ctx.calls[0]?.url).toContain("/sync/playback/episodes");
  });

  it("playback.removePosition: DELETE /sync/playback/{id}", async () => {
    const ctx = makeCtx([statusRes(204)]);
    const out = await traktPlugin.capabilities.playback!.removePosition!(ctx, {
      playbackId: "42",
    });
    expect(ctx.calls[0]?.url).toContain("/sync/playback/42");
    expect(ctx.calls[0]?.init?.method).toBe("DELETE");
    expect(PlaybackV1.methods.removePosition.output.safeParse(out).success).toBe(true);
  });

  // --- collection ---
  it("collection.getCollection (movie): hits /sync/collection/movies", async () => {
    const ctx = makeCtx([jsonRes([{ collected_at: "2026-04-01", movie: MOVIE }])]);
    const out = await traktPlugin.capabilities.collection!.getCollection!(ctx, { type: "movie" });
    expect(ctx.calls[0]?.url).toContain("/sync/collection/movies");
    expect(CollectionV1.methods.getCollection.output.safeParse(out).success).toBe(true);
  });

  it("collection.getCollection (no type): fetches both and merges", async () => {
    const ctx = makeCtx([
      jsonRes([{ collected_at: "2026-04-01", movie: MOVIE }]),
      jsonRes([{ last_collected_at: "2026-04-02", show: SHOW }]),
    ]);
    const out = await traktPlugin.capabilities.collection!.getCollection!(ctx, {});
    expect(ctx.calls[0]?.url).toContain("/sync/collection/movies");
    expect(ctx.calls[1]?.url).toContain("/sync/collection/shows");
    expect(CollectionV1.methods.getCollection.output.safeParse(out).success).toBe(true);
  });

  it("collection.addToCollection: POST /sync/collection", async () => {
    const ctx = makeCtx([jsonRes({ added: { movies: 1 } })]);
    const out = await traktPlugin.capabilities.collection!.addToCollection!(ctx, [
      { type: "movie", ids: { trakt_id: "1" } },
    ]);
    expect(ctx.calls[0]?.url).toMatch(/\/sync\/collection$/);
    expect(CollectionV1.methods.addToCollection.output.safeParse(out).success).toBe(true);
  });

  it("collection.removeFromCollection: POST /sync/collection/remove", async () => {
    const ctx = makeCtx([jsonRes({ deleted: { movies: 1 } })]);
    const out = await traktPlugin.capabilities.collection!.removeFromCollection!(ctx, [
      { type: "movie", ids: { trakt_id: "1" } },
    ]);
    expect(ctx.calls[0]?.url).toContain("/sync/collection/remove");
    expect(CollectionV1.methods.removeFromCollection.output.safeParse(out).success).toBe(true);
  });

  // --- userComments ---
  it("userComments.getComments: paginates /users/me/comments", async () => {
    const ctx = makeCtx([
      paginatedPage([
        {
          type: "movie",
          comment: { text: "great", created_at: "2026-04-01" },
          movie: MOVIE,
        },
      ]),
    ]);
    const out = await traktPlugin.capabilities.userComments!.getComments!(ctx, {});
    expect(ctx.calls[0]?.url).toContain("/users/me/comments");
    expect(UserCommentsV1.methods.getComments.output.safeParse(out).success).toBe(true);
  });

  // --- idResolve ---
  it("idResolve.resolve: short-circuits when source is already trakt", async () => {
    const ctx = makeCtx([]);
    const out = await traktPlugin.capabilities.idResolve!.resolve!(ctx, {
      from: "trakt",
      id: "1",
      type: "movie",
    });
    expect(ctx.calls.length).toBe(0);
    expect(IdResolveV1.methods.resolve.output.safeParse(out).success).toBe(true);
  });

  it("idResolve.resolve: hits /search/{idType}/{id}?type={kind}", async () => {
    const ctx = makeCtx([jsonRes([{ type: "movie", movie: MOVIE }])]);
    const out = await traktPlugin.capabilities.idResolve!.resolve!(ctx, {
      from: "imdb",
      id: "tt0137523",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/search/imdb/tt0137523");
    expect(ctx.calls[0]?.url).toContain("type=movie");
    expect(IdResolveV1.methods.resolve.output.safeParse(out).success).toBe(true);
  });
});
