import { describe, it, expect } from "vite-plus/test";
import { MetadataV1 } from "../metadata";

describe("MetadataV1", () => {
  it("is a global primary_with_enrichment capability at v1", () => {
    expect(MetadataV1.id).toBe("metadata");
    expect(MetadataV1.version).toBe("v1");
    expect(MetadataV1.scope).toBe("global");
    expect(MetadataV1.strategy.kind).toBe("primary_with_enrichment");
  });

  describe("search input", () => {
    it("rejects missing query", () => {
      const r = MetadataV1.methods.search.input.safeParse({});
      expect(r.success).toBe(false);
    });

    it("accepts a valid query", () => {
      const r = MetadataV1.methods.search.input.safeParse({ query: "Inception" });
      expect(r.success).toBe(true);
    });
  });

  describe("discover input", () => {
    it("accepts a valid filter", () => {
      const r = MetadataV1.methods.discover.input.safeParse({
        genres: ["28"],
        yearMin: 2020,
        limit: 20,
      });
      expect(r.success).toBe(true);
    });

    it("accepts a releaseDateGte filter", () => {
      const r = MetadataV1.methods.discover.input.safeParse({ releaseDateGte: 1_700_000_000 });
      expect(r.success).toBe(true);
    });

    it("accepts a sort key", () => {
      const r = MetadataV1.methods.discover.input.safeParse({ sort: "popularity_desc" });
      expect(r.success).toBe(true);
    });

    it("rejects an unknown sort key", () => {
      const r = MetadataV1.methods.discover.input.safeParse({ sort: "alphabetical" });
      expect(r.success).toBe(false);
    });
  });

  describe("getShowSeasons", () => {
    it("exposes the method", () => {
      expect(MetadataV1.methods.getShowSeasons).toBeDefined();
    });

    it("requires a show id", () => {
      const r = MetadataV1.methods.getShowSeasons.input.safeParse({});
      expect(r.success).toBe(false);
    });

    it("accepts a valid id", () => {
      const r = MetadataV1.methods.getShowSeasons.input.safeParse({ id: "1396" });
      expect(r.success).toBe(true);
    });

    it("validates a populated season payload", () => {
      const r = MetadataV1.methods.getShowSeasons.output.safeParse({
        seasons: [
          {
            seasonNumber: 1,
            name: "Season 1",
            airDate: "2008-01-20",
            totalEpisodes: 7,
            episodes: [
              { episodeNumber: 1, title: "Pilot", airDate: "2008-01-20", runtime: 58 },
              { episodeNumber: 2, title: "Cat's in the Bag..." },
            ],
          },
        ],
      });
      expect(r.success).toBe(true);
    });

    it("accepts an empty season list", () => {
      const r = MetadataV1.methods.getShowSeasons.output.safeParse({ seasons: [] });
      expect(r.success).toBe(true);
    });
  });
});
