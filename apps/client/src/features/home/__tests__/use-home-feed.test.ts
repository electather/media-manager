import { ROW_KINDS } from "@ent-mcp/shared/home";
import { describe, expect, it } from "vite-plus/test";
import { MOCK_FEED } from "../lib/mock-data";

describe("MOCK_FEED (use-home-feed data source)", () => {
  it("supplies a non-null hero", () => {
    expect(MOCK_FEED.hero).not.toBeNull();
  });

  it("every row.kind is a valid ROW_KINDS member", () => {
    for (const row of MOCK_FEED.rows) {
      expect(ROW_KINDS).toContain(row.kind);
    }
  });

  it("every HomeMediaItem has required fields: id, tmdbId, mediaType, title", () => {
    const allItems = MOCK_FEED.rows.flatMap((r) => r.items);
    if (MOCK_FEED.hero) {
      allItems.push(MOCK_FEED.hero, ...MOCK_FEED.hero.alternates);
    }
    for (const item of allItems) {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("tmdbId");
      expect(item).toHaveProperty("mediaType");
      expect(item).toHaveProperty("title");
    }
  });
});
