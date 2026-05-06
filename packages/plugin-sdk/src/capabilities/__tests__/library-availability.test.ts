import { describe, it, expect } from "vite-plus/test";
import { LibraryAvailabilityV1 } from "../library-availability";
import { getCapability } from "../index";

const libraryItemFixture = {
  id: "plex:12345",
  title: "Example Movie",
  type: "movie" as const,
  playerLink: "plex://server/12345",
  addedAt: "2026-04-20T10:00:00.000Z",
};

describe("LibraryAvailabilityV1", () => {
  it("registers as a user-scoped aggregate capability at v1", () => {
    expect(LibraryAvailabilityV1.version).toBe("v1");
    expect(LibraryAvailabilityV1.scope).toBe("user");
    expect(getCapability("libraryAvailability", "v1")).toBe(LibraryAvailabilityV1);
  });

  it("exposes the four library methods", () => {
    expect(Object.keys(LibraryAvailabilityV1.methods).sort()).toEqual(
      ["checkAvailability", "listAvailable", "listRecentlyAdded", "searchLibrary"].sort(),
    );
  });

  describe("checkAvailability input", () => {
    it("accepts a tmdb lookup", () => {
      const r = LibraryAvailabilityV1.methods.checkAvailability.input.safeParse({
        id: "550",
        idType: "tmdb",
        type: "movie",
      });
      expect(r.success).toBe(true);
    });

    it("accepts a server-local plex ratingKey", () => {
      const r = LibraryAvailabilityV1.methods.checkAvailability.input.safeParse({
        id: "12345",
        idType: "plex",
        type: "movie",
      });
      expect(r.success).toBe(true);
    });

    it("rejects an unknown idType", () => {
      const r = LibraryAvailabilityV1.methods.checkAvailability.input.safeParse({
        id: "550",
        idType: "letterboxd",
        type: "movie",
      });
      expect(r.success).toBe(false);
    });

    it("rejects missing id", () => {
      const r = LibraryAvailabilityV1.methods.checkAvailability.input.safeParse({
        idType: "tmdb",
        type: "movie",
      });
      expect(r.success).toBe(false);
    });

    it("rejects episode as a query type (output-only granularity)", () => {
      const r = LibraryAvailabilityV1.methods.checkAvailability.input.safeParse({
        id: "42",
        idType: "plex",
        type: "episode",
      });
      expect(r.success).toBe(false);
    });

    it("rejects the cross-service tv alias (use show instead)", () => {
      const r = LibraryAvailabilityV1.methods.checkAvailability.input.safeParse({
        id: "550",
        idType: "tmdb",
        type: "tv",
      });
      expect(r.success).toBe(false);
    });
  });

  describe("checkAvailability output", () => {
    it("accepts an empty items array", () => {
      const r = LibraryAvailabilityV1.methods.checkAvailability.output.safeParse({ items: [] });
      expect(r.success).toBe(true);
    });

    it("accepts multiple LibraryItem entries", () => {
      const r = LibraryAvailabilityV1.methods.checkAvailability.output.safeParse({
        items: [
          { ...libraryItemFixture, quality: { resolution: "4k", hdr: "hdr10" } },
          { ...libraryItemFixture, id: "plex:12346", quality: { resolution: "1080p" } },
        ],
      });
      expect(r.success).toBe(true);
    });

    it("rejects items missing the required playerLink", () => {
      const r = LibraryAvailabilityV1.methods.checkAvailability.output.safeParse({
        items: [
          {
            id: "plex:12345",
            title: "Example",
            type: "movie",
            addedAt: "2026-04-20T10:00:00.000Z",
          },
        ],
      });
      expect(r.success).toBe(false);
    });
  });

  describe("listRecentlyAdded", () => {
    it("accepts pagination fields", () => {
      const r = LibraryAvailabilityV1.methods.listRecentlyAdded.input.safeParse({
        type: "show",
        limit: 25,
        cursor: "opaque-cursor-1",
      });
      expect(r.success).toBe(true);
    });

    it("accepts an empty page with a next cursor", () => {
      const r = LibraryAvailabilityV1.methods.listRecentlyAdded.output.safeParse({
        items: [],
        nextCursor: "opaque-cursor-2",
      });
      expect(r.success).toBe(true);
    });

    it("accepts a final page with no nextCursor", () => {
      const r = LibraryAvailabilityV1.methods.listRecentlyAdded.output.safeParse({
        items: [libraryItemFixture],
      });
      expect(r.success).toBe(true);
    });
  });

  describe("listAvailable", () => {
    it("requires a query type", () => {
      const r = LibraryAvailabilityV1.methods.listAvailable.input.safeParse({});
      expect(r.success).toBe(false);
    });

    it("accepts a movie type", () => {
      const r = LibraryAvailabilityV1.methods.listAvailable.input.safeParse({ type: "movie" });
      expect(r.success).toBe(true);
    });

    it("validates an empty tmdbIds list as a valid output", () => {
      const r = LibraryAvailabilityV1.methods.listAvailable.output.safeParse({ tmdbIds: [] });
      expect(r.success).toBe(true);
    });

    it("validates a populated tmdbIds list", () => {
      const r = LibraryAvailabilityV1.methods.listAvailable.output.safeParse({
        tmdbIds: ["550", "1198994"],
      });
      expect(r.success).toBe(true);
    });
  });

  describe("searchLibrary", () => {
    it("requires a non-empty query", () => {
      const r = LibraryAvailabilityV1.methods.searchLibrary.input.safeParse({ query: "" });
      expect(r.success).toBe(false);
    });

    it("accepts an optional type filter", () => {
      const r = LibraryAvailabilityV1.methods.searchLibrary.input.safeParse({
        query: "Inception",
        type: "movie",
      });
      expect(r.success).toBe(true);
    });

    it("validates output as an array of LibraryItem", () => {
      const r = LibraryAvailabilityV1.methods.searchLibrary.output.safeParse([
        libraryItemFixture,
        { ...libraryItemFixture, id: "plex:12346", type: "show" },
      ]);
      expect(r.success).toBe(true);
    });
  });
});
