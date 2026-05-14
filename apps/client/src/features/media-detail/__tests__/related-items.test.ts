import { describe, expect, it } from "vite-plus/test";
import type { HomeMediaItem } from "@/features/home/lib/types";
import { buildRelatedRow } from "../lib/related-items";

function item(overrides: Partial<HomeMediaItem> & { mediaType: "movie" | "tv" }): HomeMediaItem {
  return {
    id: `${overrides.mediaType}:${overrides.tmdbId ?? "1"}`,
    tmdbId: overrides.tmdbId ?? "1",
    title: "Test",
    ...overrides,
  };
}

function decodeCursor(cursor: string): unknown {
  const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(padded));
}

describe("buildRelatedRow", () => {
  it("uses the similarTo rowId for TV seeds", () => {
    const row = buildRelatedRow(item({ mediaType: "tv", tmdbId: "100" }));
    expect(row.id).toBe("similarTo");
    expect(row.kind).toBe("similarTo");
  });

  it("uses the similarTo rowId for movie seeds", () => {
    const row = buildRelatedRow(item({ mediaType: "movie", tmdbId: "200" }));
    expect(row.id).toBe("similarTo");
    expect(row.kind).toBe("similarTo");
  });

  it("encodes a non-null initialCursor containing tmdbId and mediaType", () => {
    const row = buildRelatedRow(item({ mediaType: "movie", tmdbId: "550" }));
    expect(row.initialCursor).not.toBeNull();
    expect(decodeCursor(row.initialCursor!)).toEqual({
      tmdbId: "550",
      mediaType: "movie",
      offset: 0,
    });
  });

  it("produces distinct initialCursors for different tmdbIds — distinct React Query cache keys", () => {
    const row1 = buildRelatedRow(item({ mediaType: "movie", tmdbId: "1" }));
    const row2 = buildRelatedRow(item({ mediaType: "movie", tmdbId: "2" }));
    expect(row1.initialCursor).not.toBe(row2.initialCursor);
  });

  it("produces distinct initialCursors for different mediaTypes with the same tmdbId", () => {
    const rowMovie = buildRelatedRow(item({ mediaType: "movie", tmdbId: "1" }));
    const rowTv = buildRelatedRow(item({ mediaType: "tv", tmdbId: "1" }));
    expect(rowMovie.initialCursor).not.toBe(rowTv.initialCursor);
  });

  it("seeds the cursor with the TV mediaType for TV items", () => {
    const row = buildRelatedRow(item({ mediaType: "tv", tmdbId: "1396" }));
    const decoded = decodeCursor(row.initialCursor!) as Record<string, unknown>;
    expect(decoded.mediaType).toBe("tv");
    expect(decoded.tmdbId).toBe("1396");
  });
});
