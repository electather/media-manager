import { describe, it, expect } from "vite-plus/test";
import { ArtworkV1 } from "../artwork";

describe("ArtworkV1 capability", () => {
  it("registers as a global capability with aggregate_per_kind strategy", () => {
    expect(ArtworkV1.id).toBe("artwork");
    expect(ArtworkV1.version).toBe("v1");
    expect(ArtworkV1.scope).toBe("global");
    expect(ArtworkV1.strategy.kind).toBe("aggregate_per_kind");
    if (ArtworkV1.strategy.kind === "aggregate_per_kind") {
      expect([...ArtworkV1.strategy.perKindFields].sort()).toEqual(
        ["backdrop", "clearLogo", "poster", "thumb"].sort(),
      );
    }
  });

  describe("getArtwork input", () => {
    it("accepts a tmdb id for movies", () => {
      const r = ArtworkV1.methods.getArtwork.input.safeParse({
        ids: { tmdb: "550" },
        type: "movie",
      });
      expect(r.success).toBe(true);
    });

    it("accepts a tvdb id for tv", () => {
      const r = ArtworkV1.methods.getArtwork.input.safeParse({
        ids: { tvdb: "12345" },
        type: "tv",
      });
      expect(r.success).toBe(true);
    });

    it("accepts an imdb id (movies only)", () => {
      const r = ArtworkV1.methods.getArtwork.input.safeParse({
        ids: { imdb: "tt0137523" },
        type: "movie",
      });
      expect(r.success).toBe(true);
    });

    it("defaults languages to ['en','00'] when omitted", () => {
      const r = ArtworkV1.methods.getArtwork.input.safeParse({
        ids: { tmdb: "550" },
        type: "movie",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.languages).toEqual(["en", "00"]);
      }
    });

    it("rejects an empty ids map", () => {
      const r = ArtworkV1.methods.getArtwork.input.safeParse({
        ids: {},
        type: "movie",
      });
      expect(r.success).toBe(false);
    });

    it("rejects an unknown type", () => {
      const r = ArtworkV1.methods.getArtwork.input.safeParse({
        ids: { tmdb: "550" },
        type: "music",
      });
      expect(r.success).toBe(false);
    });

    it("rejects malformed tmdb id (non-numeric)", () => {
      const r = ArtworkV1.methods.getArtwork.input.safeParse({
        ids: { tmdb: "abc" },
        type: "movie",
      });
      expect(r.success).toBe(false);
    });

    it("rejects malformed imdb id (no tt prefix)", () => {
      const r = ArtworkV1.methods.getArtwork.input.safeParse({
        ids: { imdb: "0137523" },
        type: "movie",
      });
      expect(r.success).toBe(false);
    });

    it("rejects more than 8 language preferences", () => {
      const r = ArtworkV1.methods.getArtwork.input.safeParse({
        ids: { tmdb: "550" },
        type: "movie",
        languages: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      });
      expect(r.success).toBe(false);
    });
  });

  describe("getArtwork output", () => {
    it("accepts an empty bundle (negative-cache shape)", () => {
      const r = ArtworkV1.methods.getArtwork.output.safeParse({
        poster: [],
        backdrop: [],
        clearLogo: [],
        thumb: [],
      });
      expect(r.success).toBe(true);
    });

    it("accepts a bundle with all four kinds populated", () => {
      const r = ArtworkV1.methods.getArtwork.output.safeParse({
        poster: [
          { url: "https://example.test/p.jpg", language: "en", likes: 5 },
          { url: "https://example.test/p2.jpg", language: "00" },
        ],
        backdrop: [{ url: "https://example.test/b.jpg", language: "en" }],
        clearLogo: [{ url: "https://example.test/l.png", language: "en" }],
        thumb: [{ url: "https://example.test/t.jpg", language: "00" }],
      });
      expect(r.success).toBe(true);
    });

    it("rejects more than 5 variants in any kind", () => {
      const variants = Array.from({ length: 6 }, (_, i) => ({
        url: `https://example.test/p${i}.jpg`,
        language: "en",
      }));
      const r = ArtworkV1.methods.getArtwork.output.safeParse({
        poster: variants,
        backdrop: [],
        clearLogo: [],
        thumb: [],
      });
      expect(r.success).toBe(false);
    });

    it("rejects a malformed url", () => {
      const r = ArtworkV1.methods.getArtwork.output.safeParse({
        poster: [{ url: "not-a-url", language: "en" }],
        backdrop: [],
        clearLogo: [],
        thumb: [],
      });
      expect(r.success).toBe(false);
    });
  });
});
