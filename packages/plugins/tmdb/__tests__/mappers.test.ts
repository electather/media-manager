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

// The collections lens (design D2) groups owned movies by their TMDB franchise.
// That grouping only works if mapMovie threads `belongs_to_collection` into a
// stable `collection: { id, name } | null` field — and TV never carries one,
// since TMDB has no franchise concept for shows. These tests fail loudly if any
// of those three invariants regress.
describe("tmdb mappers — franchise threading (D2)", () => {
  it("mapMovie: belongs_to_collection → collection with STRINGIFIED id", () => {
    const ctx = makeCtx([]) as unknown as Ctx;
    // TMDB sends the collection id as a number alongside artwork paths; the
    // canonical row must drop the artwork and stringify the id so downstream
    // keying (`collection:<id>`) and persistence stay text-based.
    const raw = {
      ...MOVIE_RAW,
      belongs_to_collection: {
        id: 10,
        name: "Some Collection",
        poster_path: "/coll-poster.jpg",
        backdrop_path: "/coll-backdrop.jpg",
      },
    } as MovieRaw;
    const out = mapMovie(ctx, raw) as { collection: { id: string; name: string } | null };
    // The id must be the string "10", not the number 10 — keying depends on it.
    expect(out.collection).toEqual({ id: "10", name: "Some Collection" });
    expect(typeof out.collection?.id).toBe("string");
  });

  it("mapMovie: no belongs_to_collection → collection null (standalone film)", () => {
    const ctx = makeCtx([]) as unknown as Ctx;
    // MOVIE_RAW has no belongs_to_collection, so a standalone film maps to null
    // and is excluded from the owned-only collections lens.
    const out = mapMovie(ctx, MOVIE_RAW as MovieRaw) as { collection: unknown };
    expect(out.collection).toBeNull();
  });

  it("mapShow: TV item always emits collection null, even given franchise-like data", () => {
    const ctx = makeCtx([]) as unknown as Ctx;
    // TMDB shows have no franchise concept; even if a collection-shaped payload
    // is forced onto the raw, the show mapper must never thread it through.
    const raw = {
      ...SHOW_RAW,
      belongs_to_collection: { id: 99, name: "Bogus Show Collection" },
    } as unknown as TvRaw;
    const out = mapShow(ctx, raw) as { collection: unknown };
    expect(out.collection).toBeNull();
  });
});
