import { describe, expect, it } from "vite-plus/test";
import { QueryClient } from "@tanstack/react-query";
import type { CompactMediaItem, HomeLayoutResponse } from "@ent-mcp/shared/home";
import type { Page } from "@ent-mcp/shared/media";
import { mediaKeys } from "@/shared/media/query-keys";
import { findCachedMediaItem } from "../lib/find-cached-item";
import { homeKeys } from "../lib/query-keys";

function makeItem(id: string): CompactMediaItem {
  const [mediaType, tmdbId] = id.split(":") as ["movie" | "tv", string];
  return { id, tmdbId, mediaType, title: `t-${id}` };
}

/** A shared infinite source cache holds `{ pages: Page[] }` keyed by `mediaKeys.source`. */
function setSource(qc: QueryClient, sourceId: "trendingNow", pages: Page[]) {
  qc.setQueryData(mediaKeys.source(sourceId, {}), { pages, pageParams: [] });
}

describe("findCachedMediaItem", () => {
  it("returns null when no caches contain the id", () => {
    const qc = new QueryClient();
    expect(findCachedMediaItem(qc, "movie:404")).toBeNull();
  });

  it("matches an item cached on a hero slide", () => {
    const qc = new QueryClient();
    const item = makeItem("movie:1");
    qc.setQueryData<HomeLayoutResponse>(homeKeys.layout(), {
      hero: { slides: [{ item, source: "trendingNow", reason: "trending", resumeUrl: null }] },
      rows: [],
      generatedAt: 1,
    });
    expect(findCachedMediaItem(qc, "movie:1")).toEqual(item);
  });

  it("matches an item cached on a shared media source's infinite-query pages", () => {
    const qc = new QueryClient();
    const target = makeItem("tv:42");
    setSource(qc, "trendingNow", [
      { items: [makeItem("movie:1"), makeItem("movie:2")], cursor: null, partial: false },
      { items: [target], cursor: null, partial: false },
    ]);
    expect(findCachedMediaItem(qc, "tv:42")).toEqual(target);
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
    setSource(qc, "trendingNow", [{ items: [rowVersion], cursor: null, partial: false }]);
    expect(findCachedMediaItem(qc, "movie:7")?.title).toBe("from-hero");
  });
});
