import { describe, it, expect } from "vite-plus/test";
import { IdResolveV1 } from "../id-resolve";

describe("IdResolveV1", () => {
  it("is a mixed-scope capability at v1", () => {
    expect(IdResolveV1.id).toBe("idResolve");
    expect(IdResolveV1.version).toBe("v1");
    expect(IdResolveV1.scope).toBe("mixed");
    expect(typeof IdResolveV1.scopeForInput).toBe("function");
  });

  describe("resolve input", () => {
    it("accepts plex:ratingKey as `from`", () => {
      const r = IdResolveV1.methods.resolve.input.safeParse({
        from: "plex:ratingKey",
        id: "12345",
        type: "movie",
      });
      expect(r.success).toBe(true);
    });

    it("accepts jellyfin:itemId as `from`", () => {
      const r = IdResolveV1.methods.resolve.input.safeParse({
        from: "jellyfin:itemId",
        id: "abc-123",
        type: "tv",
      });
      expect(r.success).toBe(true);
    });

    it("rejects unknown `from` kinds", () => {
      const r = IdResolveV1.methods.resolve.input.safeParse({
        from: "emby:itemId",
        id: "1",
        type: "movie",
      });
      expect(r.success).toBe(false);
    });
  });

  describe("resolve output", () => {
    it("accepts partial output", () => {
      const r = IdResolveV1.methods.resolve.output.safeParse({ tmdb: "550" });
      expect(r.success).toBe(true);
    });

    it("accepts empty output", () => {
      const r = IdResolveV1.methods.resolve.output.safeParse({});
      expect(r.success).toBe(true);
    });

    it("accepts local ids", () => {
      const r = IdResolveV1.methods.resolve.output.safeParse({
        tmdb: "550",
        "plex:ratingKey": "42",
        "jellyfin:itemId": "f00",
      });
      expect(r.success).toBe(true);
    });
  });

  describe("scopeForInput", () => {
    const classify = IdResolveV1.scopeForInput!;

    it("routes flat id kinds to global", () => {
      expect(classify({ from: "tmdb", id: "550", type: "movie" })).toBe("global");
      expect(classify({ from: "imdb", id: "tt0137523", type: "movie" })).toBe("global");
      expect(classify({ from: "tvdb", id: "12345", type: "tv" })).toBe("global");
      expect(classify({ from: "trakt", id: "99", type: "movie" })).toBe("global");
    });

    it("routes server-local id kinds to user", () => {
      expect(classify({ from: "plex:ratingKey", id: "1", type: "movie" })).toBe("user");
      expect(classify({ from: "jellyfin:itemId", id: "abc", type: "tv" })).toBe("user");
    });

    it("defensively returns global for malformed inputs", () => {
      expect(classify(null)).toBe("global");
      expect(classify(undefined)).toBe("global");
      expect(classify({})).toBe("global");
      expect(classify({ from: 42 })).toBe("global");
    });
  });
});
