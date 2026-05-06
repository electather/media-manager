import { describe, expect, it } from "vite-plus/test";
import type { HomeMediaItem } from "@/features/home/lib/types";
import { buildRelatedRow } from "../lib/related-items";

function item(overrides: Partial<HomeMediaItem> & { mediaType: "movie" | "tv" }): HomeMediaItem {
  return {
    id: `${overrides.mediaType}:1`,
    tmdbId: "1",
    title: "Test",
    ...overrides,
  };
}

describe("buildRelatedRow", () => {
  it("routes a TV seed to recommendedForYou-tv", () => {
    const row = buildRelatedRow(item({ mediaType: "tv" }));
    expect(row.id).toBe("recommendedForYou-tv");
    expect(row.kind).toBe("recommendedForYou");
  });

  it("routes a movie seed to recommendedForYou-movies", () => {
    const row = buildRelatedRow(item({ mediaType: "movie" }));
    expect(row.id).toBe("recommendedForYou-movies");
  });

  it("ships a null initialCursor so the row hook fetches the first page", () => {
    const row = buildRelatedRow(item({ mediaType: "movie" }));
    expect(row.initialCursor).toBeNull();
  });
});
