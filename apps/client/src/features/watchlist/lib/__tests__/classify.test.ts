import { describe, expect, it } from "vite-plus/test";

import { bucketize, classifyStatus, splitRuntime, totalRuntimeMinutes } from "../classify";
import type { CompactMediaItem } from "@nama/shared/media";

function makeItem(overrides: Partial<CompactMediaItem> = {}): CompactMediaItem {
  return {
    id: "movie:1",
    tmdbId: "1",
    mediaType: "movie",
    title: "Test",
    ...overrides,
  } as CompactMediaItem;
}

describe("classifyStatus", () => {
  it("returns in-progress when progress is set, regardless of status", () => {
    const item = makeItem({ status: "available", progress: { watched: 30, total: 100 } });
    expect(classifyStatus(item)).toBe("in-progress");
  });

  it("maps the wire status to the watchlist status", () => {
    expect(classifyStatus(makeItem({ status: "available" }))).toBe("available");
    expect(classifyStatus(makeItem({ status: "requested" }))).toBe("requested");
    expect(classifyStatus(makeItem({ status: "processing" }))).toBe("requested");
    expect(classifyStatus(makeItem({ status: "unavailable" }))).toBe("unavailable");
  });

  it("falls through to upcoming when releaseDate is set", () => {
    const item = makeItem({ status: "unknown", facets: { releaseDate: "2026-12-01" } });
    expect(classifyStatus(item)).toBe("upcoming");
  });

  // Info-only titles (no library copy, not request-eligible) cannot be acted
  // on, so the server `?bucket=` classification routes them to `unavailable`
  // (#502). The client classifier mirrors that to keep the local bucket view
  // in sync with the server-rendered buckets.
  it("classifies info-only items as unavailable to match the server", () => {
    const item = makeItem({
      availability: { hasAnyServerCopy: false, requestEligible: false, servers: [] },
    });
    expect(classifyStatus(item)).toBe("unavailable");
  });

  it("returns unknown when no signal classifies the item", () => {
    expect(classifyStatus(makeItem())).toBe("unknown");
    expect(classifyStatus(makeItem({ status: "unknown" }))).toBe("unknown");
  });
});

describe("bucketize", () => {
  it("splits items into the right buckets and drops unknown", () => {
    const items: CompactMediaItem[] = [
      makeItem({ id: "movie:1", status: "available" }),
      makeItem({ id: "movie:2", progress: { watched: 1, total: 10 } }),
      makeItem({ id: "movie:3", status: "requested" }),
      makeItem({ id: "movie:4", status: "unavailable" }),
      makeItem({ id: "movie:5", facets: { releaseDate: "2027-01-01" } }),
      makeItem({ id: "movie:6" }),
    ];
    const buckets = bucketize(items);
    expect(buckets.available.map((i) => i.id)).toEqual(["movie:1"]);
    expect(buckets.inProgress.map((i) => i.id)).toEqual(["movie:2"]);
    expect(buckets.requested.map((i) => i.id)).toEqual(["movie:3"]);
    expect(buckets.unavailable.map((i) => i.id)).toEqual(["movie:4"]);
    expect(buckets.upcoming.map((i) => i.id)).toEqual(["movie:5"]);
  });
});

describe("totalRuntimeMinutes", () => {
  it("uses runtimeMin for movies and falls back to 110 minutes", () => {
    const items: CompactMediaItem[] = [
      makeItem({ id: "movie:1", facets: { runtimeMin: 100 } }),
      makeItem({ id: "movie:2" }),
    ];
    expect(totalRuntimeMinutes(items)).toBe(100 + 110);
  });

  it("multiplies runtime by episode count for TV with fallbacks for missing values", () => {
    const items: CompactMediaItem[] = [
      makeItem({
        id: "tv:1",
        mediaType: "tv",
        facets: { runtimeMin: 50, episodeCount: 10 },
      }),
      makeItem({ id: "tv:2", mediaType: "tv" }),
    ];
    expect(totalRuntimeMinutes(items)).toBe(50 * 10 + 48 * 8);
  });
});

describe("splitRuntime", () => {
  it("splits minutes into days and hours", () => {
    expect(splitRuntime(0)).toEqual({ days: 0, hours: 0 });
    expect(splitRuntime(60)).toEqual({ days: 0, hours: 1 });
    expect(splitRuntime(60 * 24)).toEqual({ days: 1, hours: 0 });
    expect(splitRuntime(60 * 24 + 60 * 5)).toEqual({ days: 1, hours: 5 });
  });
});
