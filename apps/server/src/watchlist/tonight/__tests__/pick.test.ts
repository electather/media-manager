import { describe, expect, it, vi } from "vite-plus/test";
import type { WatchlistItem } from "@ent-mcp/shared/watchlist";
import { pick } from "../pick";

vi.mock("../../../env", () => ({
  env: {
    APP_EXTERNAL_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost:3000",
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
  },
}));

const NOW = 1_700_000_000_000;

function make(overrides: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    id: overrides.id ?? "movie:1",
    tmdbId: overrides.tmdbId ?? "1",
    mediaType: overrides.mediaType ?? "movie",
    title: overrides.title ?? "T",
    addedAt: overrides.addedAt ?? NOW - 10_000,
    addedSource: overrides.addedSource ?? "manual",
    ...overrides,
  };
}

describe("tonight/pick", () => {
  it("empty candidates returns an empty result", () => {
    expect(pick([], NOW)).toEqual({ items: [], partial: false });
  });

  it("returns at most one hero plus four alternates", () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      make({
        id: `movie:${i}`,
        tmdbId: String(i),
        status: "available",
        availability: { hasAnyServerCopy: true, requestEligible: false, servers: [] },
        facets: { runtimeMin: 100 },
      }),
    );
    const result = pick(candidates, NOW);
    expect(result.items).toHaveLength(5);
  });

  it("excludes ineligible candidates from the alternates strip", () => {
    const hero = make({
      id: "h",
      status: "available",
      availability: { hasAnyServerCopy: true, requestEligible: false, servers: [] },
    });
    const upcoming = make({ id: "u", facets: { releaseDate: "2099-01-01" } });
    const result = pick([hero, upcoming], NOW);
    expect(result.items.map((i) => i.id)).toEqual(["h"]);
  });

  it("breaks ties on id so output is deterministic", () => {
    const a = make({ id: "a" });
    const b = make({ id: "b" });
    expect(pick([b, a], NOW).items[0]!.id).toBe("a");
  });
});
