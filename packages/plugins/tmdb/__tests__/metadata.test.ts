import { describe, it, expect } from "vite-plus/test";
import { MetadataV1 } from "@nama/plugin-sdk";
import { jsonRes, makeCtx, MOVIE_RAW, SHOW_RAW } from "./helpers";
import tmdbPlugin from "../src/plugin";

describe("metadata capability contract", () => {
  it("search (movie): hits /search/movie with query", async () => {
    const ctx = makeCtx([jsonRes({ results: [MOVIE_RAW] })]);
    const out = await tmdbPlugin.capabilities.metadata!.search!(ctx, {
      query: "fight",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/search/movie");
    expect(ctx.calls[0]?.url).toContain("query=fight");
    expect(MetadataV1.methods.search.output.safeParse(out).success).toBe(true);
  });

  it("search (tv): hits /search/tv with query", async () => {
    const ctx = makeCtx([jsonRes({ results: [SHOW_RAW] })]);
    const out = await tmdbPlugin.capabilities.metadata!.search!(ctx, {
      query: "thrones",
      type: "tv",
    });
    expect(ctx.calls[0]?.url).toContain("/search/tv");
    expect(MetadataV1.methods.search.output.safeParse(out).success).toBe(true);
  });

  it("search (multi): hits /search/multi and filters media_type", async () => {
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

  it("getDetails (movie): hits /movie/{id} with append_to_response", async () => {
    const ctx = makeCtx([jsonRes(MOVIE_RAW)]);
    const out = await tmdbPlugin.capabilities.metadata!.getDetails!(ctx, {
      id: "550",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/movie/550");
    expect(ctx.calls[0]?.url).toContain("append_to_response=external_ids%2Ccredits%2Ckeywords");
    expect(MetadataV1.methods.getDetails.output.safeParse(out).success).toBe(true);
  });

  it("getDetails (tv): hits /tv/{id} with append_to_response", async () => {
    const ctx = makeCtx([jsonRes(SHOW_RAW)]);
    const out = await tmdbPlugin.capabilities.metadata!.getDetails!(ctx, {
      id: "1399",
      type: "tv",
    });
    expect(ctx.calls[0]?.url).toContain("/tv/1399");
    expect(MetadataV1.methods.getDetails.output.safeParse(out).success).toBe(true);
  });

  it("getSimilar: hits /{type}/{id}/similar", async () => {
    const ctx = makeCtx([jsonRes({ results: [MOVIE_RAW] })]);
    const out = await tmdbPlugin.capabilities.metadata!.getSimilar!(ctx, {
      id: "550",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/movie/550/similar");
    expect(MetadataV1.methods.getSimilar.output.safeParse(out).success).toBe(true);
  });

  it("getTrending: hits /trending/{type}/day", async () => {
    const ctx = makeCtx([jsonRes({ results: [MOVIE_RAW] })]);
    const out = await tmdbPlugin.capabilities.metadata!.getTrending!(ctx, { type: "movie" });
    expect(ctx.calls[0]?.url).toContain("/trending/movie/day");
    expect(MetadataV1.methods.getTrending.output.safeParse(out).success).toBe(true);
  });

  it("discover: hits /discover/movie AND /discover/tv with shared filters", async () => {
    const ctx = makeCtx([jsonRes({ results: [MOVIE_RAW] }), jsonRes({ results: [SHOW_RAW] })]);
    const out = await tmdbPlugin.capabilities.metadata!.discover!(ctx, {
      genres: ["18"],
      yearMin: 1999,
      ratingMin: 7,
    });
    const urls = ctx.calls.map((c) => c.url);
    expect(urls.some((u) => u.includes("/discover/movie"))).toBe(true);
    expect(urls.some((u) => u.includes("/discover/tv"))).toBe(true);
    expect(urls.every((u) => u.includes("with_genres=18"))).toBe(true);
    expect(urls.every((u) => u.includes("vote_average.gte=7"))).toBe(true);
    expect(MetadataV1.methods.discover.output.safeParse(out).success).toBe(true);
    const items = out as Array<{ type: string }>;
    expect(items.some((i) => i.type === "movie")).toBe(true);
    expect(items.some((i) => i.type === "tv")).toBe(true);
  });

  it("discover: maps releaseDateGte/Lte to per-endpoint date keys (#136)", async () => {
    const ctx = makeCtx([jsonRes({ results: [MOVIE_RAW] }), jsonRes({ results: [SHOW_RAW] })]);
    await tmdbPlugin.capabilities.metadata!.discover!(ctx, {
      releaseDateGte: Date.UTC(2024, 0, 15),
      releaseDateLte: Date.UTC(2024, 3, 15),
    });
    const movieUrl = ctx.calls.find((c) => c.url.includes("/discover/movie"))!.url;
    const tvUrl = ctx.calls.find((c) => c.url.includes("/discover/tv"))!.url;
    expect(movieUrl).toContain("primary_release_date.gte=2024-01-15");
    expect(movieUrl).toContain("primary_release_date.lte=2024-04-15");
    expect(tvUrl).toContain("first_air_date.gte=2024-01-15");
    expect(tvUrl).toContain("first_air_date.lte=2024-04-15");
  });

  it("discover: maps sort to per-endpoint sort_by (#136)", async () => {
    const ctx = makeCtx([jsonRes({ results: [MOVIE_RAW] }), jsonRes({ results: [SHOW_RAW] })]);
    await tmdbPlugin.capabilities.metadata!.discover!(ctx, { sort: "release_date_desc" });
    const movieUrl = ctx.calls.find((c) => c.url.includes("/discover/movie"))!.url;
    const tvUrl = ctx.calls.find((c) => c.url.includes("/discover/tv"))!.url;
    expect(movieUrl).toContain("sort_by=primary_release_date.desc");
    expect(tvUrl).toContain("sort_by=first_air_date.desc");
  });

  it("discover: popularity sort uses the same key on both endpoints (#136)", async () => {
    const ctx = makeCtx([jsonRes({ results: [MOVIE_RAW] }), jsonRes({ results: [SHOW_RAW] })]);
    await tmdbPlugin.capabilities.metadata!.discover!(ctx, { sort: "popularity_desc" });
    const movieUrl = ctx.calls.find((c) => c.url.includes("/discover/movie"))!.url;
    const tvUrl = ctx.calls.find((c) => c.url.includes("/discover/tv"))!.url;
    expect(movieUrl).toContain("sort_by=popularity.desc");
    expect(tvUrl).toContain("sort_by=popularity.desc");
  });

  it("discover: tolerates one endpoint failing — returns the other (#136)", async () => {
    const ctx = makeCtx([
      jsonRes({ results: [MOVIE_RAW] }),
      new Response("server error", { status: 500 }),
    ]);
    const out = (await tmdbPlugin.capabilities.metadata!.discover!(ctx, {
      sort: "popularity_desc",
    })) as Array<{ type: string }>;
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((i) => i.type === "movie")).toBe(true);
  });

  it("discover: interleaves movie + tv items (#136)", async () => {
    const ctx = makeCtx([
      jsonRes({ results: [MOVIE_RAW, { ...MOVIE_RAW, id: 551 }, { ...MOVIE_RAW, id: 552 }] }),
      jsonRes({ results: [SHOW_RAW, { ...SHOW_RAW, id: 1400 }] }),
    ]);
    const out = (await tmdbPlugin.capabilities.metadata!.discover!(ctx, {})) as Array<{
      type: string;
    }>;
    expect(out.map((i) => i.type)).toEqual(["movie", "tv", "movie", "tv", "movie"]);
  });
});
