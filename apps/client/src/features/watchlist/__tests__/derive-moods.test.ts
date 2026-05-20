import { describe, expect, it } from "vite-plus/test";
import { deriveMoods } from "../lib/derive-moods";
import { makeItem } from "../__fixtures__/watchlist-items.fixture";

describe("deriveMoods", () => {
  it("matches movie genre names", () => {
    const items = Array.from({ length: 3 }, (_, i) =>
      makeItem({ id: `movie:${i}`, tmdbId: String(i), genres: ["Horror"] }),
    );
    const groups = deriveMoods(items);
    const horror = groups.find((g) => g.mood.id === "horror");
    expect(horror?.items).toHaveLength(3);
  });

  it("matches TV genre names (Sci-Fi & Fantasy)", () => {
    const items = Array.from({ length: 3 }, (_, i) =>
      makeItem({
        id: `tv:${i}`,
        tmdbId: String(i),
        mediaType: "tv",
        genres: ["Sci-Fi & Fantasy"],
      }),
    );
    const groups = deriveMoods(items);
    expect(groups.find((g) => g.mood.id === "scifi")?.items).toHaveLength(3);
  });

  it("skips items with only numeric-string genre ids", () => {
    const items = Array.from({ length: 3 }, (_, i) =>
      makeItem({ id: `movie:n${i}`, tmdbId: `n${i}`, genres: ["27", "28"] }),
    );
    expect(deriveMoods(items)).toEqual([]);
  });

  it("honors the configurable threshold", () => {
    const items = Array.from({ length: 2 }, (_, i) =>
      makeItem({ id: `movie:t${i}`, tmdbId: `t${i}`, genres: ["Horror"] }),
    );
    expect(deriveMoods(items).find((g) => g.mood.id === "horror")).toBeUndefined();
    expect(deriveMoods(items, { threshold: 2 }).find((g) => g.mood.id === "horror")).toBeDefined();
  });

  it("places overlapping items in multiple clusters", () => {
    // Each item is Horror + Thriller + Mystery, so it should match both the
    // horror cluster (requireMovie=["Horror"]) and the quiet thriller cluster
    // (requireMovie=["Thriller","Mystery"]).
    const items = Array.from({ length: 3 }, (_, i) =>
      makeItem({
        id: `movie:o${i}`,
        tmdbId: `o${i}`,
        genres: ["Horror", "Thriller", "Mystery"],
      }),
    );
    const groups = deriveMoods(items);
    expect(groups.find((g) => g.mood.id === "horror")?.items).toHaveLength(3);
    expect(groups.find((g) => g.mood.id === "quiet_thrill")?.items).toHaveLength(3);
  });
});
