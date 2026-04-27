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
});
