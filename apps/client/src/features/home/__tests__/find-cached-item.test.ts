import { describe, expect, it } from "vite-plus/test";
import { QueryClient } from "@tanstack/react-query";
import type {
  CompactMediaItem,
  HomeLayoutResponse,
  RowContentResponse,
} from "@ent-mcp/shared/home";
import { findCachedHomeItem } from "../lib/find-cached-item";
import { homeKeys } from "../lib/query-keys";

function makeItem(id: string): CompactMediaItem {
  const [mediaType, tmdbId] = id.split(":") as ["movie" | "tv", string];
  return { id, tmdbId, mediaType, title: `t-${id}` };
}

describe("findCachedHomeItem", () => {
  it("returns null when no caches contain the id", () => {
    const qc = new QueryClient();
    expect(findCachedHomeItem(qc, "movie:404")).toBeNull();
  });

  it("matches an item cached on a hero slide", () => {
    const qc = new QueryClient();
    const item = makeItem("movie:1");
    qc.setQueryData<HomeLayoutResponse>(homeKeys.layout(), {
      hero: { slides: [{ item, source: "trendingNow", reason: "trending", resumeUrl: null }] },
      rows: [],
      generatedAt: 1,
    });
    expect(findCachedHomeItem(qc, "movie:1")).toEqual(item);
  });

  it("matches an item cached on any row's infinite-query pages", () => {
    const qc = new QueryClient();
    const target = makeItem("tv:42");
    const rowKey = homeKeys.row("trendingNow", null);
    qc.setQueryData<{ pages: RowContentResponse[] }>(rowKey, {
      pages: [
        { items: [makeItem("movie:1"), makeItem("movie:2")], cursor: null },
        { items: [target], cursor: null },
      ],
    });
    expect(findCachedHomeItem(qc, "tv:42")).toEqual(target);
  });

  it("prefers the hero slide hit over a row hit", () => {
    const qc = new QueryClient();
    const heroVersion = { ...makeItem("movie:7"), title: "from-hero" };
    const rowVersion = { ...makeItem("movie:7"), title: "from-row" };
    qc.setQueryData<HomeLayoutResponse>(homeKeys.layout(), {
      hero: {
        slides: [{ item: heroVersion, source: "trendingNow", reason: "trending", resumeUrl: null }],
      },
      rows: [],
      generatedAt: 1,
    });
    qc.setQueryData<{ pages: RowContentResponse[] }>(homeKeys.row("trendingNow", null), {
      pages: [{ items: [rowVersion], cursor: null }],
    });
    expect(findCachedHomeItem(qc, "movie:7")?.title).toBe("from-hero");
  });
});
