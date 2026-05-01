import { describe, it, expect } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { COMPACT_FIELDS } from "@ent-mcp/shared/media";
import { mapToMediaDetail, toCompactFromRaw } from "../mappers";

const here = dirname(fileURLToPath(import.meta.url));
const mappersSource = readFileSync(resolve(here, "../mappers.ts"), "utf8");

const movieRaw = {
  id: "movie:550",
  type: "movie" as const,
  title: "Fight Club",
  year: 1999,
  genres: ["Drama", "Thriller"],
  rating: 8.4,
  overview: "An insomniac office worker...",
  posterUrl: "https://image.tmdb.org/p/poster.jpg",
  backdropUrl: "https://image.tmdb.org/p/back.jpg",
  ids: { tmdb_id: "550" },
  runtime: 139,
  director: "David Fincher",
  cast: ["Brad Pitt", "Edward Norton"],
  keywords: ["cult-classic"],
};

const tvRaw = {
  id: "tv:1396",
  type: "tv" as const,
  title: "Breaking Bad",
  year: 2008,
  genres: ["Drama", "Crime"],
  rating: 9.5,
  overview: "A high school chemistry teacher...",
  posterUrl: "https://image.tmdb.org/p/bb.jpg",
  ids: { tmdb_id: "1396" },
  cast: ["Bryan Cranston"],
  seriesStatus: "finished" as const,
  seasons: [
    {
      number: 1,
      episodeCount: 7,
      status: "available" as const,
      episodes: [
        {
          episode: 1,
          title: "Pilot",
          airDate: "2008-01-20",
          runtime: 58,
          status: "available" as const,
        },
        {
          episode: 2,
          title: "Cat's in the Bag",
          airDate: "2008-01-27",
          runtime: 48,
          status: "available" as const,
        },
      ],
    },
  ],
};

describe("mapToMediaDetail", () => {
  it("maps a movie raw payload to MediaDetail", () => {
    const detail = mapToMediaDetail(movieRaw, "movie:550");
    expect(detail.id).toBe("movie:550");
    expect(detail.tmdbId).toBe("550");
    expect(detail.mediaType).toBe("movie");
    expect(detail.title).toBe("Fight Club");
    expect(detail.year).toBe(1999);
    expect(detail.poster).toBe(movieRaw.posterUrl);
    expect(detail.backdrop).toBe(movieRaw.backdropUrl);
    expect(detail.genres).toEqual(["Drama", "Thriller"]);
    expect(detail.rating).toBe(8.4);
    expect(detail.runtime).toBe("2h 19m");
    expect(detail.director).toBe("David Fincher");
    expect(detail.cast).toEqual(["Brad Pitt", "Edward Norton"]);
    expect(detail.keywords).toEqual(["cult-classic"]);
  });

  it("maps a tv raw with seasons + episodes", () => {
    const detail = mapToMediaDetail(tvRaw, "tv:1396");
    expect(detail.mediaType).toBe("tv");
    expect(detail.seriesStatus).toBe("finished");
    expect(detail.seasons).toHaveLength(1);
    const season = detail.seasons?.[0];
    if (!season) throw new Error("expected season");
    expect(season.title).toBe("Season 1");
    expect(season.episodeCount).toBe(7);
    expect(season.episodes).toHaveLength(2);
    const episode = season.episodes[0];
    if (!episode) throw new Error("expected episode");
    expect(episode.title).toBe("Pilot");
    expect(episode.airDate).toBe("2008-01-20");
  });

  it("falls back to status 'unknown' when raw status missing or invalid", () => {
    expect(mapToMediaDetail(movieRaw, "movie:550").status).toBe("unknown");
    expect(mapToMediaDetail({ ...movieRaw, status: "junk" }, "movie:550").status).toBe("unknown");
    expect(mapToMediaDetail({ ...movieRaw, status: "available" }, "movie:550").status).toBe(
      "available",
    );
  });

  it("omits optional fields that are absent on raw", () => {
    const minimal = {
      id: "movie:777",
      type: "movie" as const,
      title: "M",
      ids: { tmdb_id: "777" },
    };
    const detail = mapToMediaDetail(minimal, "movie:777");
    expect(detail.year).toBeUndefined();
    expect(detail.poster).toBeUndefined();
    expect(detail.backdrop).toBeUndefined();
    expect(detail.cast).toBeUndefined();
    expect(detail.seasons).toBeUndefined();
  });

  it("is deterministic — same input twice yields deep-equal output", () => {
    const a = mapToMediaDetail(tvRaw, "tv:1396");
    const b = mapToMediaDetail(tvRaw, "tv:1396");
    expect(a).toEqual(b);
  });
});

describe("toCompactFromRaw", () => {
  it("returns only COMPACT_FIELDS-shaped keys", () => {
    const compact = toCompactFromRaw(movieRaw, "movie:550");
    const allowed = new Set<string>(COMPACT_FIELDS);
    for (const key of Object.keys(compact)) {
      expect(allowed.has(key)).toBe(true);
    }
  });

  it("merges extras on top of the compact projection", () => {
    const compact = toCompactFromRaw(movieRaw, "movie:550", {
      matchReason: "Because you watched Se7en",
      progress: { watched: 30, total: 139 },
    });
    expect(compact.matchReason).toBe("Because you watched Se7en");
    expect(compact.progress).toEqual({ watched: 30, total: 139 });
  });

  it("strips undefined extras so they do not leak into output", () => {
    const compact = toCompactFromRaw(movieRaw, "movie:550", {
      matchReason: undefined,
    });
    expect("matchReason" in compact).toBe(false);
  });
});

describe("mapper determinism guard (V85)", () => {
  it("does not call Math.random", () => {
    expect(mappersSource).not.toMatch(/Math\.random/);
  });

  it("does not call Date.now", () => {
    expect(mappersSource).not.toMatch(/Date\.now/);
  });
});
