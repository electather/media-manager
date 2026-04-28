import { describe, it, expect } from "vite-plus/test";
import type { Ctx, MovieRaw, TvRaw } from "../src/types";
import { mapMovie, mapShow } from "../src/mappers";
import { makeCtx, MOVIE_RAW, SHOW_RAW } from "./helpers";

describe("tmdb mappers — backdrop lift", () => {
  it("mapMovie: backdrop_path → backdropUrl populated", () => {
    const ctx = makeCtx([]) as unknown as Ctx;
    const raw = { ...MOVIE_RAW, backdrop_path: "/bd.jpg" } as MovieRaw;
    const out = mapMovie(ctx, raw) as { backdropUrl: string | null };
    expect(out.backdropUrl).toBe("https://image.tmdb.org/t/p/w1280/bd.jpg");
  });

  it("mapMovie: backdrop_path absent → backdropUrl null", () => {
    const ctx = makeCtx([]) as unknown as Ctx;
    const out = mapMovie(ctx, MOVIE_RAW as MovieRaw) as { backdropUrl: string | null };
    expect(out.backdropUrl).toBeNull();
  });

  it("mapMovie: backdrop_path null → backdropUrl null", () => {
    const ctx = makeCtx([]) as unknown as Ctx;
    const raw = { ...MOVIE_RAW, backdrop_path: null } as MovieRaw;
    const out = mapMovie(ctx, raw) as { backdropUrl: string | null };
    expect(out.backdropUrl).toBeNull();
  });

  it("mapShow: backdrop_path → backdropUrl populated", () => {
    const ctx = makeCtx([]) as unknown as Ctx;
    const raw = { ...SHOW_RAW, backdrop_path: "/got-bd.jpg" } as TvRaw;
    const out = mapShow(ctx, raw) as { backdropUrl: string | null };
    expect(out.backdropUrl).toBe("https://image.tmdb.org/t/p/w1280/got-bd.jpg");
  });

  it("mapShow: backdrop_path absent → backdropUrl null", () => {
    const ctx = makeCtx([]) as unknown as Ctx;
    const out = mapShow(ctx, SHOW_RAW as TvRaw) as { backdropUrl: string | null };
    expect(out.backdropUrl).toBeNull();
  });
});
