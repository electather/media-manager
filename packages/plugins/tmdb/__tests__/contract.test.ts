import { describe, it, expect } from "vite-plus/test";
import type { PluginContext } from "@ent-mcp/plugin-sdk";
import {
  MetadataV1,
  IdResolveV1,
  WatchProvidersV1,
  TrailersV1,
  ArtworkV1,
  validatePluginModule,
} from "@ent-mcp/plugin-sdk";
import { jsonRes, makeTestContext, type TestContext } from "@ent-mcp/plugin-sdk/testing";
import tmdbPlugin from "../src/plugin";

// Contract tests: drive every declared capability method end-to-end with a
// stubbed ctx, verify the request URL is what we expect to hit on a real
// TMDB server, and confirm the plugin's return value parses against the
// capability's Zod output schema.

function makeCtx(
  responses: Array<Response | Error>,
  overrides: Partial<PluginContext> = {},
): TestContext {
  return makeTestContext({
    responses,
    overrides: { sharedCredentials: { apiKey: "tmdb-key" }, ...overrides },
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
    expect(validatePluginModule(tmdbPlugin)).toBeDefined();
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

  it("artwork.getArtwork: hits /{type}/{id}/images and maps to bundle", async () => {
    const ctx = makeCtx([
      jsonRes({
        posters: [
          { file_path: "/p-en.jpg", iso_639_1: "en", vote_average: 8, width: 780, height: 1170 },
          { file_path: "/p-textless.jpg", iso_639_1: null, vote_average: 9 },
          { file_path: "/p-fr.jpg", iso_639_1: "fr", vote_average: 7 },
        ],
        backdrops: [
          { file_path: "/b.jpg", iso_639_1: null, vote_average: 6, width: 1280, height: 720 },
        ],
        logos: [{ file_path: "/l.png", iso_639_1: "en", vote_average: 5 }],
      }),
    ]);
    const out = await tmdbPlugin.capabilities.artwork!.getArtwork!(ctx, {
      ids: { tmdb: "550" },
      type: "movie",
      languages: ["en", "00"],
    });
    expect(ctx.calls[0]?.url).toContain("/movie/550/images");
    expect(ArtworkV1.methods.getArtwork.output.safeParse(out).success).toBe(true);
    const bundle = out as {
      poster: Array<{ url: string; language: string; likes: number }>;
      backdrop: Array<{ url: string; language: string }>;
      clearLogo: Array<{ url: string }>;
      thumb: unknown[];
    };
    // English variant ranks above textless, both rank above French.
    expect(bundle.poster[0]?.language).toBe("en");
    expect(bundle.poster[0]?.url).toContain("/w780/p-en.jpg");
    expect(bundle.poster[1]?.language).toBe("00");
    expect(bundle.poster[2]?.language).toBe("fr");
    expect(bundle.backdrop[0]?.url).toContain("/w1280/b.jpg");
    expect(bundle.clearLogo[0]?.url).toContain("/w500/l.png");
    // TMDB has no thumb concept.
    expect(bundle.thumb).toEqual([]);
  });

  it("artwork.getArtwork: throws plugin.input_invalid without tmdb id (defensive guard)", async () => {
    const ctx = makeCtx([]);
    await expect(
      tmdbPlugin.capabilities.artwork!.getArtwork!(ctx, {
        ids: { imdb: "tt0137523" },
        type: "movie",
        languages: ["en", "00"],
      }),
    ).rejects.toThrow();
  });

  it("artwork.getArtwork: hits /tv/{id}/images for tv items", async () => {
    const ctx = makeCtx([
      jsonRes({
        posters: [{ file_path: "/tv-p.jpg", iso_639_1: "en", vote_average: 9 }],
        backdrops: [{ file_path: "/tv-b.jpg", iso_639_1: null, vote_average: 7 }],
        logos: [{ file_path: "/tv-l.png", iso_639_1: "en", vote_average: 5 }],
      }),
    ]);
    const out = await tmdbPlugin.capabilities.artwork!.getArtwork!(ctx, {
      ids: { tmdb: "1399" },
      type: "tv",
      languages: ["en", "00"],
    });
    expect(ctx.calls[0]?.url).toContain("/tv/1399/images");
    expect(ArtworkV1.methods.getArtwork.output.safeParse(out).success).toBe(true);
    const bundle = out as { poster: Array<{ url: string }>; backdrop: Array<{ url: string }> };
    expect(bundle.poster[0]?.url).toContain("/w780/tv-p.jpg");
    expect(bundle.backdrop[0]?.url).toContain("/w1280/tv-b.jpg");
  });

  it("artwork.getArtwork: include_image_language honors the caller's languages preference", async () => {
    // Regression test for a bug where the param was hard-coded to "null,en"
    // regardless of the `languages` arg, silently dropping non-English variants.
    const ctx = makeCtx([jsonRes({ posters: [], backdrops: [], logos: [] })]);
    await tmdbPlugin.capabilities.artwork!.getArtwork!(ctx, {
      ids: { tmdb: "550" },
      type: "movie",
      languages: ["fr", "en", "00"],
    });
    const url = ctx.calls[0]!.url;
    // TMDB writes textless variants under "null"; "00" maps to that.
    expect(url).toContain("include_image_language=fr%2Cen%2Cnull");
  });

  it("artwork.getArtwork: include_image_language always includes 'null' even when caller omits textless", async () => {
    // Textless art is a meaningful fallback when the caller's preferred
    // languages have no localised variants, so the plugin always appends
    // "null". Without this, a caller passing ["en"] would never see textless
    // art even when no English art exists for the item.
    const ctx = makeCtx([jsonRes({ posters: [], backdrops: [], logos: [] })]);
    await tmdbPlugin.capabilities.artwork!.getArtwork!(ctx, {
      ids: { tmdb: "550" },
      type: "movie",
      languages: ["en"],
    });
    expect(ctx.calls[0]?.url).toContain("include_image_language=en%2Cnull");
  });

  it("artwork.getArtwork: respects custom artworkSizes config", async () => {
    const ctx = makeCtx(
      [
        jsonRes({
          posters: [{ file_path: "/p.jpg", iso_639_1: "en", vote_average: 1 }],
          backdrops: [],
          // Config keys mirror the bundle field names; `clearLogo` (not
          // `logo`) overrides the size used for logos.
          logos: [{ file_path: "/l.png", iso_639_1: "en", vote_average: 1 }],
        }),
      ],
      {
        config: {
          global: { artworkSizes: { poster: "original", clearLogo: "w300" } },
          user: undefined,
        },
      },
    );
    const out = await tmdbPlugin.capabilities.artwork!.getArtwork!(ctx, {
      ids: { tmdb: "550" },
      type: "movie",
      languages: ["en", "00"],
    });
    const bundle = out as {
      poster: Array<{ url: string }>;
      clearLogo: Array<{ url: string }>;
    };
    expect(bundle.poster[0]?.url).toContain("/original/p.jpg");
    expect(bundle.clearLogo[0]?.url).toContain("/w300/l.png");
  });
});
