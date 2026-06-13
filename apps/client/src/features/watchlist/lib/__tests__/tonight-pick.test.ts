import { describe, expect, it } from "vite-plus/test";
import type { CompactMediaItem } from "@nama/shared/media";
import { pickTonight } from "../tonight-pick";

const NOW = 1_700_000_000_000;

function item(overrides: Partial<CompactMediaItem>): CompactMediaItem {
  return {
    id: overrides.id ?? "movie:1",
    tmdbId: overrides.tmdbId ?? "1",
    mediaType: overrides.mediaType ?? "movie",
    title: overrides.title ?? "Title",
    ...overrides,
  };
}

describe("pickTonight", () => {
  it("returns an empty list for no candidates", () => {
    expect(pickTonight([], NOW)).toEqual([]);
  });

  it("ranks the in-progress item as hero over an available one", () => {
    const inProgress = item({ id: "tv:1", mediaType: "tv", progress: { watched: 1, total: 4 } });
    const available = item({
      id: "movie:2",
      status: "available",
      availability: { hasAnyServerCopy: true, requestEligible: false, servers: [] },
    });
    const result = pickTonight([available, inProgress], NOW);
    expect(result[0]?.id).toBe("tv:1");
    expect(result.map((r) => r.id)).toContain("movie:2");
  });

  it("drops ineligible candidates from the alternates", () => {
    const hero = item({ id: "tv:1", mediaType: "tv", progress: { watched: 1, total: 4 } });
    const requested = item({ id: "movie:9", status: "requested" });
    const result = pickTonight([hero, requested], NOW);
    expect(result.map((r) => r.id)).toEqual(["tv:1"]);
  });

  it("caps alternates at four (hero + 4)", () => {
    const candidates = Array.from({ length: 8 }, (_, i) =>
      item({
        id: `movie:${i}`,
        tmdbId: String(i),
        status: "available",
        availability: { hasAnyServerCopy: true, requestEligible: false, servers: [] },
      }),
    );
    const result = pickTonight(candidates, NOW);
    expect(result).toHaveLength(5);
  });

  it("breaks ties deterministically by id", () => {
    const a = item({ id: "movie:b", tmdbId: "20" });
    const b = item({ id: "movie:a", tmdbId: "21" });
    // Equal scores (no signals) → stable sort by id ascending makes movie:a the hero.
    expect(pickTonight([a, b], NOW)[0]?.id).toBe("movie:a");
  });
});
