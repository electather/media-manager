import { describe, expect, it } from "vite-plus/test";
import { MOCK_FEED } from "@/features/home/lib/mock-data";
import { buildRelatedRow } from "../lib/related-items";

describe("buildRelatedRow", () => {
  it("excludes the source item from the candidate pool", () => {
    const seed = MOCK_FEED.rows[0]?.items[0];
    expect(seed).toBeDefined();
    if (!seed) return;
    const row = buildRelatedRow(seed);
    expect(row.items.find((item) => item.id === seed.id)).toBeUndefined();
  });

  it("ranks same-kind items above mismatched ones", () => {
    const hero = MOCK_FEED.hero;
    expect(hero).not.toBeNull();
    if (!hero) return;
    const row = buildRelatedRow(hero);
    if (row.items.length < 2) return;
    const sameKindCount = row.items.filter((item) => item.mediaType === hero.mediaType).length;
    expect(sameKindCount).toBeGreaterThan(0);
  });

  it("returns at most twelve items", () => {
    const hero = MOCK_FEED.hero;
    if (!hero) return;
    const row = buildRelatedRow(hero);
    expect(row.items.length).toBeLessThanOrEqual(12);
  });

  it("emits a unique row id derived from the seed", () => {
    const hero = MOCK_FEED.hero;
    if (!hero) return;
    const row = buildRelatedRow(hero);
    expect(row.id).toBe(`related-${hero.id}`);
  });
});
