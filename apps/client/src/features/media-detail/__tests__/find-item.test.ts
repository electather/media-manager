import { describe, expect, it } from "vite-plus/test";
import { MOCK_FEED } from "@/features/home/lib/mock-data";
import { findMediaItem } from "../lib/find-item";

describe("findMediaItem", () => {
  it("resolves the hero by composite id", () => {
    const hero = MOCK_FEED.hero;
    expect(hero).not.toBeNull();
    if (!hero) return;
    expect(findMediaItem(hero.id)).toBe(hero);
  });

  it("resolves a hero alternate", () => {
    const alt = MOCK_FEED.hero?.alternates[0];
    expect(alt).toBeDefined();
    if (!alt) return;
    expect(findMediaItem(alt.id)).toBe(alt);
  });

  it("resolves an item from any row", () => {
    const sample = MOCK_FEED.rows[0]?.items[0];
    expect(sample).toBeDefined();
    if (!sample) return;
    expect(findMediaItem(sample.id)).toBe(sample);
  });

  it("returns null for unknown ids", () => {
    expect(findMediaItem("movie:not-real")).toBeNull();
  });
});
