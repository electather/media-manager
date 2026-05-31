import { describe, expect, it } from "vite-plus/test";
import { decode } from "@ent-mcp/shared/media";
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

  it("mints a keyset seed cursor the resolver accepts (regression: PR #540 P1)", () => {
    // The pre-cutover `encodeCursor({tmdbId,mediaType,offset})` shape decoded to
    // `null` against the new `similarTo` resolver (strict keyset decode,
    // `cursorOnNull: "400"`), 400'ing "More like this". The cursor must now
    // decode as a keyset cursor whose `k` carries the seed.
    const row = buildRelatedRow(item({ mediaType: "movie", tmdbId: "550" }));
    expect(row.initialCursor).not.toBeNull();
    const cursor = decode(row.initialCursor!, "keyset");
    expect(cursor).not.toBeNull();
    expect(cursor?.mode).toBe("keyset");
    expect(JSON.parse((cursor as { mode: "keyset"; k: string }).k)).toEqual({
      seedId: "550",
      seedType: "movie",
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
    const cursor = decode(row.initialCursor!, "keyset") as { mode: "keyset"; k: string };
    const seed = JSON.parse(cursor.k) as Record<string, unknown>;
    expect(seed.seedType).toBe("tv");
    expect(seed.seedId).toBe("1396");
  });
});
