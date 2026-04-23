import { describe, it, expect } from "vite-plus/test";
import type { ManifestCapability } from "@ent-mcp/shared/plugins";
import { pluginManifestSchema } from "@ent-mcp/shared/plugins";
import {
  CAPABILITY_CATALOG,
  capabilityKey,
  ContinueWatchingV1,
  getCapability,
  IdResolveV1,
  LibraryAvailabilityV1,
  MetadataV1,
  WatchHistoryV1,
} from "../capabilities";
import { CapabilityRegistry } from "../registry";
import type { PluginModule } from "../types";

describe("capability catalog", () => {
  it("keys by id@version", () => {
    expect(capabilityKey("metadata", "v1")).toBe("metadata@v1");
  });

  it("exposes every v1 capability", () => {
    const keys = Object.keys(CAPABILITY_CATALOG).sort();
    expect(keys).toEqual(
      [
        "calendar@v1",
        "collection@v1",
        "continueWatching@v1",
        "idResolve@v1",
        "libraryAvailability@v1",
        "mediaRequest@v1",
        "metadata@v1",
        "playback@v1",
        "ratings@v1",
        "recommendations@v1",
        "trailers@v1",
        "userComments@v1",
        "watchHistory@v1",
        "watchlist@v1",
        "watchProviders@v1",
      ].sort(),
    );
  });

  it("returns undefined for unknown versions", () => {
    expect(getCapability("metadata", "v99")).toBeUndefined();
  });
});

describe("MetadataV1 input validation", () => {
  it("rejects missing query on search", () => {
    const r = MetadataV1.methods.search.input.safeParse({});
    expect(r.success).toBe(false);
  });

  it("accepts a valid discover filter", () => {
    const r = MetadataV1.methods.discover.input.safeParse({
      genres: ["28"],
      yearMin: 2020,
      limit: 20,
    });
    expect(r.success).toBe(true);
  });
});

describe("WatchHistoryV1 output validation", () => {
  it("requires watchedAt on history entries", () => {
    const r = WatchHistoryV1.methods.getHistory.output.safeParse([
      {
        item: {
          id: "movie:1",
          title: "x",
          year: 2020,
          type: "movie",
          rating: null,
          posterUrl: null,
        },
        // watchedAt missing
      },
    ]);
    expect(r.success).toBe(false);
  });
});

describe("IdResolveV1", () => {
  it("accepts partial output", () => {
    const r = IdResolveV1.methods.resolve.output.safeParse({ tmdb: "550" });
    expect(r.success).toBe(true);
  });
  it("accepts empty output", () => {
    const r = IdResolveV1.methods.resolve.output.safeParse({});
    expect(r.success).toBe(true);
  });

  it("accepts plex:ratingKey as an input `from` kind", () => {
    const r = IdResolveV1.methods.resolve.input.safeParse({
      from: "plex:ratingKey",
      id: "12345",
      type: "movie",
    });
    expect(r.success).toBe(true);
  });

  it("accepts jellyfin:itemId as an input `from` kind", () => {
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

  it("accepts local ids in the output bundle", () => {
    const r = IdResolveV1.methods.resolve.output.safeParse({
      tmdb: "550",
      "plex:ratingKey": "42",
      "jellyfin:itemId": "f00",
    });
    expect(r.success).toBe(true);
  });
});

describe("idResolve@v1 with scope: user", () => {
  function fakeUserScopedIdResolvePlugin(id: string): PluginModule {
    const capability: ManifestCapability = { version: "v1", scope: "user" };
    return {
      manifest: {
        id,
        name: id,
        version: "1.0.0",
        description: "",
        author: { name: "test" },
        sdkVersion: "^1.0.0",
        allowedHosts: [],
        credentialsSchema: { type: "object" },
        auth: { kind: "form" },
        capabilities: { idResolve: capability },
      },
      capabilities: {},
    };
  }

  it("registers and is resolvable via the registry when declared with scope: user", () => {
    const reg = new CapabilityRegistry();
    reg.register({
      pluginId: "plex",
      module: fakeUserScopedIdResolvePlugin("plex"),
      enabled: true,
    });
    expect(reg.listProviders("idResolve", "v1", "user")).toEqual(["plex"]);
    // Does not leak across scopes.
    expect(reg.listProviders("idResolve", "v1", "global")).toEqual([]);
  });

  it("fake plugin manifest passes the shared manifest schema", () => {
    const manifest = fakeUserScopedIdResolvePlugin("plex").manifest;
    const parsed = pluginManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
  });
});

// A minimal valid LibraryItem fixture — reused across the media-server
// capability tests so each assertion can focus on its own field.
const libraryItemFixture = {
  id: "plex:12345",
  title: "Example Movie",
  type: "movie" as const,
  playerLink: "plex://server/12345",
  addedAt: "2026-04-20T10:00:00.000Z",
};

describe("LibraryAvailabilityV1", () => {
  it("registers as a user-scoped capability at v1", () => {
    expect(LibraryAvailabilityV1.version).toBe("v1");
    expect(LibraryAvailabilityV1.userScoped).toBe(true);
    expect(getCapability("libraryAvailability", "v1")).toBe(LibraryAvailabilityV1);
  });

  it("exposes the three library methods", () => {
    expect(Object.keys(LibraryAvailabilityV1.methods).sort()).toEqual(
      ["checkAvailability", "listRecentlyAdded", "searchLibrary"].sort(),
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

  describe("input type enum", () => {
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
});

describe("ContinueWatchingV1", () => {
  it("registers as a user-scoped capability at v1", () => {
    expect(ContinueWatchingV1.version).toBe("v1");
    expect(ContinueWatchingV1.userScoped).toBe(true);
    expect(getCapability("continueWatching", "v1")).toBe(ContinueWatchingV1);
  });

  it("exposes only getContinueWatching", () => {
    expect(Object.keys(ContinueWatchingV1.methods)).toEqual(["getContinueWatching"]);
  });

  describe("getContinueWatching input", () => {
    it("accepts no filters", () => {
      const r = ContinueWatchingV1.methods.getContinueWatching.input.safeParse({});
      expect(r.success).toBe(true);
    });

    it("accepts a type filter and limit", () => {
      const r = ContinueWatchingV1.methods.getContinueWatching.input.safeParse({
        type: "show",
        limit: 10,
      });
      expect(r.success).toBe(true);
    });

    it("rejects episode as a query type", () => {
      const r = ContinueWatchingV1.methods.getContinueWatching.input.safeParse({
        type: "episode",
      });
      expect(r.success).toBe(false);
    });
  });

  it("accepts entries with a nextUp episode", () => {
    const r = ContinueWatchingV1.methods.getContinueWatching.output.safeParse([
      {
        item: { ...libraryItemFixture, type: "episode", season: 1, episode: 2 },
        progressMs: 320_000,
        nextUp: {
          ...libraryItemFixture,
          id: "plex:12346",
          type: "episode",
          season: 1,
          episode: 3,
        },
        lastPlayedAt: "2026-04-22T20:00:00.000Z",
      },
    ]);
    expect(r.success).toBe(true);
  });

  it("accepts entries without progress (start next episode)", () => {
    const r = ContinueWatchingV1.methods.getContinueWatching.output.safeParse([
      { item: libraryItemFixture },
    ]);
    expect(r.success).toBe(true);
  });

  it("rejects entries missing item", () => {
    const r = ContinueWatchingV1.methods.getContinueWatching.output.safeParse([
      { progressMs: 1000 },
    ]);
    expect(r.success).toBe(false);
  });
});
