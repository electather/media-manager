import { describe, it, expect } from "vite-plus/test";
import type { PluginContext } from "@ent-mcp/plugin-sdk";
import { MetadataV1, IdResolveV1, WatchProvidersV1, TrailersV1 } from "@ent-mcp/plugin-sdk";
import { validatePluginModule } from "@ent-mcp/plugin-sdk";
import tmdbPlugin from "../src/plugin";

// Contract tests: drive every declared capability method end-to-end with a
// stubbed ctx, verify the request URL is what we expect to hit on a real
// TMDB server, and confirm the plugin's return value parses against the
// capability's Zod output schema.

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
    sharedCredentials: { apiKey: "tmdb-key" },
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

const MOVIE_RAW = {
  id: 550,
  title: "Fight Club",
  release_date: "1999-10-15",
  genres: [{ id: 18, name: "Drama" }],
  runtime: 139,
  original_language: "en",
  vote_average: 8.4,
  overview: "An insomniac office worker...",
  poster_path: "/poster.jpg",
  external_ids: { imdb_id: "tt0137523", tvdb_id: 666 },
  credits: {
    cast: [{ name: "Brad Pitt", order: 0 }],
    crew: [
      { name: "David Fincher", job: "Director", department: "Directing" },
      { name: "Jim Uhls", job: "Screenplay", department: "Writing" },
    ],
  },
  keywords: { keywords: [{ name: "soap" }] },
};

const SHOW_RAW = {
  id: 1399,
  name: "Game of Thrones",
  first_air_date: "2011-04-17",
  genres: [{ id: 10765, name: "Sci-Fi & Fantasy" }],
  episode_run_time: [60],
  original_language: "en",
  vote_average: 8.4,
  overview: "Seven noble families...",
  poster_path: "/got.jpg",
  external_ids: { imdb_id: "tt0944947", tvdb_id: 121361 },
  credits: { cast: [], crew: [] },
  keywords: { results: [] },
  created_by: [{ name: "David Benioff" }],
};

describe("tmdb plugin passes loader validation", () => {
  it("validates against the manifest + capability catalog", async () => {
    await expect(validatePluginModule(tmdbPlugin)).resolves.toBeDefined();
  });
});

describe("tmdb capability contract", () => {
  it("metadata.search (movie): hits /search/movie with query", async () => {
    const ctx = makeCtx([jsonRes({ results: [MOVIE_RAW] })]);
    const out = await tmdbPlugin.capabilities.metadata!.search!(ctx, {
      query: "fight",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/search/movie");
    expect(ctx.calls[0]?.url).toContain("query=fight");
    expect(MetadataV1.methods.search.output.safeParse(out).success).toBe(true);
  });

  it("metadata.search (tv): hits /search/tv with query", async () => {
    const ctx = makeCtx([jsonRes({ results: [SHOW_RAW] })]);
    const out = await tmdbPlugin.capabilities.metadata!.search!(ctx, {
      query: "thrones",
      type: "tv",
    });
    expect(ctx.calls[0]?.url).toContain("/search/tv");
    expect(MetadataV1.methods.search.output.safeParse(out).success).toBe(true);
  });

  it("metadata.search (multi): hits /search/multi and filters media_type", async () => {
    const ctx = makeCtx([
      jsonRes({
        results: [
          { ...MOVIE_RAW, media_type: "movie" },
          { ...SHOW_RAW, media_type: "tv" },
          { id: 99, media_type: "person" },
        ],
      }),
    ]);
    const out = await tmdbPlugin.capabilities.metadata!.search!(ctx, { query: "x" });
    expect(ctx.calls[0]?.url).toContain("/search/multi");
    expect(MetadataV1.methods.search.output.safeParse(out).success).toBe(true);
    expect((out as unknown[]).length).toBe(2);
  });

  it("metadata.getDetails (movie): hits /movie/{id} with append_to_response", async () => {
    const ctx = makeCtx([jsonRes(MOVIE_RAW)]);
    const out = await tmdbPlugin.capabilities.metadata!.getDetails!(ctx, {
      id: "550",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/movie/550");
    expect(ctx.calls[0]?.url).toContain("append_to_response=external_ids%2Ccredits%2Ckeywords");
    expect(MetadataV1.methods.getDetails.output.safeParse(out).success).toBe(true);
  });

  it("metadata.getDetails (tv): hits /tv/{id} with append_to_response", async () => {
    const ctx = makeCtx([jsonRes(SHOW_RAW)]);
    const out = await tmdbPlugin.capabilities.metadata!.getDetails!(ctx, {
      id: "1399",
      type: "tv",
    });
    expect(ctx.calls[0]?.url).toContain("/tv/1399");
    expect(MetadataV1.methods.getDetails.output.safeParse(out).success).toBe(true);
  });

  it("metadata.getSimilar: hits /{type}/{id}/similar", async () => {
    const ctx = makeCtx([jsonRes({ results: [MOVIE_RAW] })]);
    const out = await tmdbPlugin.capabilities.metadata!.getSimilar!(ctx, {
      id: "550",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/movie/550/similar");
    expect(MetadataV1.methods.getSimilar.output.safeParse(out).success).toBe(true);
  });

  it("metadata.getTrending: hits /trending/{type}/day", async () => {
    const ctx = makeCtx([jsonRes({ results: [MOVIE_RAW] })]);
    const out = await tmdbPlugin.capabilities.metadata!.getTrending!(ctx, { type: "movie" });
    expect(ctx.calls[0]?.url).toContain("/trending/movie/day");
    expect(MetadataV1.methods.getTrending.output.safeParse(out).success).toBe(true);
  });

  it("metadata.discover: hits /discover/movie with with_genres + rating filters", async () => {
    const ctx = makeCtx([jsonRes({ results: [MOVIE_RAW] })]);
    const out = await tmdbPlugin.capabilities.metadata!.discover!(ctx, {
      genres: ["18"],
      yearMin: 1999,
      ratingMin: 7,
    });
    expect(ctx.calls[0]?.url).toContain("/discover/movie");
    expect(ctx.calls[0]?.url).toContain("with_genres=18");
    expect(ctx.calls[0]?.url).toContain("vote_average.gte=7");
    expect(MetadataV1.methods.discover.output.safeParse(out).success).toBe(true);
  });

  it("idResolve.resolve: short-circuits when source is already tmdb", async () => {
    const ctx = makeCtx([]);
    const out = await tmdbPlugin.capabilities.idResolve!.resolve!(ctx, {
      from: "tmdb",
      id: "550",
      type: "movie",
    });
    expect(ctx.calls.length).toBe(0);
    expect(IdResolveV1.methods.resolve.output.safeParse(out).success).toBe(true);
  });

  it("idResolve.resolve: hits /find/{id} with external_source=imdb_id", async () => {
    const ctx = makeCtx([
      jsonRes({
        movie_results: [{ id: 550 }],
        tv_results: [],
      }),
    ]);
    const out = await tmdbPlugin.capabilities.idResolve!.resolve!(ctx, {
      from: "imdb",
      id: "tt0137523",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/find/tt0137523");
    expect(ctx.calls[0]?.url).toContain("external_source=imdb_id");
    expect(IdResolveV1.methods.resolve.output.safeParse(out).success).toBe(true);
  });

  it("watchProviders.getProviders: hits /{type}/{id}/watch/providers and maps region", async () => {
    const ctx = makeCtx([
      jsonRes({
        results: {
          US: {
            flatrate: [{ provider_name: "Netflix" }],
            rent: [{ provider_name: "Apple TV" }],
            buy: [],
          },
        },
      }),
    ]);
    const out = await tmdbPlugin.capabilities.watchProviders!.getProviders!(ctx, {
      id: "550",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/movie/550/watch/providers");
    expect(WatchProvidersV1.methods.getProviders.output.safeParse(out).success).toBe(true);
  });

  it("trailers.getVideos: hits /{type}/{id}/videos and maps YouTube keys to URLs", async () => {
    const ctx = makeCtx([
      jsonRes({
        results: [
          { key: "abc123", site: "YouTube", type: "Trailer", official: true },
          { key: "xyz789", site: "Vimeo", type: "Teaser" },
        ],
      }),
    ]);
    const out = await tmdbPlugin.capabilities.trailers!.getVideos!(ctx, {
      id: "550",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/movie/550/videos");
    expect(TrailersV1.methods.getVideos.output.safeParse(out).success).toBe(true);
    const videos = out as Array<{ kind: string; url: string | null }>;
    expect(videos[0]?.url).toBe("https://www.youtube.com/watch?v=abc123");
    expect(videos[1]?.url).toBe("https://vimeo.com/xyz789");
  });
});
