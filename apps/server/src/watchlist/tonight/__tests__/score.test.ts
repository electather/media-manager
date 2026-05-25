import { describe, expect, it, vi } from "vite-plus/test";
import type { WatchlistItem } from "@ent-mcp/shared/watchlist";
import { score, WEIGHTS } from "../score";

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
const RECENT_MS = NOW - 24 * 60 * 60 * 1000;
const OLD_MS = NOW - 60 * 24 * 60 * 60 * 1000;

function make(overrides: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    id: overrides.id ?? "movie:1",
    tmdbId: overrides.tmdbId ?? "1",
    mediaType: overrides.mediaType ?? "movie",
    title: overrides.title ?? "T",
    addedAt: overrides.addedAt ?? OLD_MS,
    addedSource: overrides.addedSource ?? "manual",
    ...overrides,
  };
}

describe("tonight/score", () => {
  it("in-progress outscores a plain available row", () => {
    const inProgress = make({
      id: "a",
      progress: { watched: 600, total: 6000 },
    });
    const ready = make({
      id: "b",
      status: "available",
      availability: { hasAnyServerCopy: true, requestEligible: false, servers: [] },
    });
    expect(score(inProgress, [], NOW)).toBeGreaterThan(score(ready, [], NOW));
  });

  it("awards the sweet-spot runtime bonus inside 90-130 only", () => {
    const sweet = make({ id: "s", facets: { runtimeMin: 100 } });
    const tooLong = make({ id: "l", facets: { runtimeMin: 180 } });
    expect(score(sweet, [], NOW)).toBe(WEIGHTS.runtimeSweetSpot);
    expect(score(tooLong, [], NOW)).toBe(0);
  });

  it("penalizes runtimes under one hour", () => {
    const short = make({ id: "s", facets: { runtimeMin: 40 } });
    expect(score(short, [], NOW)).toBe(WEIGHTS.shortRuntimePenalty);
  });

  it("rewards items added inside the recent window", () => {
    const recent = make({ id: "r", addedAt: RECENT_MS });
    const stale = make({ id: "o", addedAt: OLD_MS });
    expect(score(recent, [], NOW) - score(stale, [], NOW)).toBe(WEIGHTS.recentlyAdded);
  });

  it("applies the diversity penalty once per genre overlap with prior", () => {
    const hero = make({ id: "h", genres: ["drama", "thriller"] });
    const cand = make({ id: "c", genres: ["drama", "thriller", "comedy"] });
    const standalone = score(cand, [], NOW);
    const withPrior = score(cand, [hero], NOW);
    expect(withPrior - standalone).toBe(2 * WEIGHTS.diversityPenalty);
  });

  it("ineligible statuses tank the score unless in-progress", () => {
    const requested = make({ id: "x", status: "requested" });
    expect(score(requested, [], NOW)).toBeLessThan(-500);
    const requestedInProgress = make({
      id: "y",
      status: "requested",
      progress: { watched: 100, total: 1000 },
    });
    expect(score(requestedInProgress, [], NOW)).toBeGreaterThan(0);
  });

  it("is deterministic for identical inputs (V.WL4)", () => {
    const item = make({ id: "z", facets: { runtimeMin: 100 } });
    expect(score(item, [], NOW)).toBe(score(item, [], NOW));
  });
});
