import { describe, it, expect } from "vite-plus/test";
import type { ManifestCapability } from "@ent-mcp/shared/plugins";
import { pluginManifestSchema } from "@ent-mcp/shared/plugins";
import {
  CAPABILITY_CATALOG,
  capabilityKey,
  ContinueWatchingV1,
  getCapability,
  IdResolveV1,
  LibraryAdminV1,
  LibraryAvailabilityV1,
  MetadataV1,
  PlaybackSessionsV1,
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
        "libraryAdmin@v1",
        "libraryAvailability@v1",
        "mediaRequest@v1",
        "metadata@v1",
        "playback@v1",
        "playbackSessions@v1",
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

describe("PlaybackSessionsV1", () => {
  // A minimal valid SessionEntry fixture — reused across the session tests.
  const sessionFixture = {
    sessionId: "s-1",
    deviceName: "Living Room Apple TV",
    user: { id: "u-42", name: "Alice" },
    item: libraryItemFixture,
    progressMs: 120_000,
    durationMs: 5_400_000,
    state: "playing" as const,
    startedAt: "2026-04-23T09:00:00.000Z",
  };

  it("registers as a user-scoped capability at v1", () => {
    expect(PlaybackSessionsV1.version).toBe("v1");
    expect(PlaybackSessionsV1.userScoped).toBe(true);
    expect(getCapability("playbackSessions", "v1")).toBe(PlaybackSessionsV1);
  });

  it("exposes getSessions and stopSession", () => {
    expect(Object.keys(PlaybackSessionsV1.methods).sort()).toEqual(
      ["getSessions", "stopSession"].sort(),
    );
  });

  describe("getSessions output", () => {
    it("accepts an empty array", () => {
      const r = PlaybackSessionsV1.methods.getSessions.output.safeParse([]);
      expect(r.success).toBe(true);
    });

    it("accepts a minimal session entry", () => {
      const r = PlaybackSessionsV1.methods.getSessions.output.safeParse([sessionFixture]);
      expect(r.success).toBe(true);
    });

    it("accepts transcoding details", () => {
      const r = PlaybackSessionsV1.methods.getSessions.output.safeParse([
        {
          ...sessionFixture,
          state: "buffering",
          transcoding: {
            videoDecision: "transcode",
            audioDecision: "copy",
            targetBitrate: 12_000,
            reason: "Client does not support HEVC",
          },
        },
      ]);
      expect(r.success).toBe(true);
    });

    it("rejects an unknown state", () => {
      const r = PlaybackSessionsV1.methods.getSessions.output.safeParse([
        { ...sessionFixture, state: "stopped" },
      ]);
      expect(r.success).toBe(false);
    });

    it("rejects a session without user id", () => {
      const r = PlaybackSessionsV1.methods.getSessions.output.safeParse([
        { ...sessionFixture, user: { name: "Alice" } },
      ]);
      expect(r.success).toBe(false);
    });

    it("rejects unknown transcoding decisions", () => {
      const r = PlaybackSessionsV1.methods.getSessions.output.safeParse([
        {
          ...sessionFixture,
          transcoding: { videoDecision: "reencode", audioDecision: "copy" },
        },
      ]);
      expect(r.success).toBe(false);
    });
  });

  describe("stopSession", () => {
    it("accepts a sessionId alone", () => {
      const r = PlaybackSessionsV1.methods.stopSession.input.safeParse({ sessionId: "s-1" });
      expect(r.success).toBe(true);
    });

    it("accepts an optional reason", () => {
      const r = PlaybackSessionsV1.methods.stopSession.input.safeParse({
        sessionId: "s-1",
        reason: "Exceeded stream quota",
      });
      expect(r.success).toBe(true);
    });

    it("rejects an empty sessionId", () => {
      const r = PlaybackSessionsV1.methods.stopSession.input.safeParse({ sessionId: "" });
      expect(r.success).toBe(false);
    });

    it("returns forced or requested semantics", () => {
      const forced = PlaybackSessionsV1.methods.stopSession.output.safeParse({
        ok: true,
        semantics: "forced",
      });
      const requested = PlaybackSessionsV1.methods.stopSession.output.safeParse({
        ok: true,
        semantics: "requested",
      });
      expect(forced.success).toBe(true);
      expect(requested.success).toBe(true);
    });

    it("rejects unknown semantics", () => {
      const r = PlaybackSessionsV1.methods.stopSession.output.safeParse({
        ok: true,
        semantics: "maybe",
      });
      expect(r.success).toBe(false);
    });

    it("invalidates playbackSessions@v1 after stopping", () => {
      expect(PlaybackSessionsV1.methods.stopSession.invalidates).toEqual(["playbackSessions@v1"]);
    });
  });
});

describe("LibraryAdminV1", () => {
  it("registers as a user-scoped capability at v1", () => {
    expect(LibraryAdminV1.version).toBe("v1");
    expect(LibraryAdminV1.userScoped).toBe(true);
    expect(getCapability("libraryAdmin", "v1")).toBe(LibraryAdminV1);
  });

  it("exposes refreshLibrary and refreshItem", () => {
    expect(Object.keys(LibraryAdminV1.methods).sort()).toEqual(
      ["refreshItem", "refreshLibrary"].sort(),
    );
  });

  describe("refreshLibrary", () => {
    it("accepts no input", () => {
      const r = LibraryAdminV1.methods.refreshLibrary.input.safeParse({});
      expect(r.success).toBe(true);
    });

    it("accepts an optional librarySectionId", () => {
      const r = LibraryAdminV1.methods.refreshLibrary.input.safeParse({
        librarySectionId: "section-3",
      });
      expect(r.success).toBe(true);
    });

    it("returns { ok }", () => {
      const r = LibraryAdminV1.methods.refreshLibrary.output.safeParse({ ok: true });
      expect(r.success).toBe(true);
    });

    it("does not invalidate other capabilities (fire-and-forget)", () => {
      expect(LibraryAdminV1.methods.refreshLibrary.invalidates).toBeUndefined();
    });
  });

  describe("refreshItem", () => {
    it("requires a serverItemId", () => {
      const r = LibraryAdminV1.methods.refreshItem.input.safeParse({});
      expect(r.success).toBe(false);
    });

    it("rejects an empty serverItemId", () => {
      const r = LibraryAdminV1.methods.refreshItem.input.safeParse({ serverItemId: "" });
      expect(r.success).toBe(false);
    });

    it("accepts a valid serverItemId", () => {
      const r = LibraryAdminV1.methods.refreshItem.input.safeParse({ serverItemId: "12345" });
      expect(r.success).toBe(true);
    });

    it("does not invalidate other capabilities (fire-and-forget)", () => {
      expect(LibraryAdminV1.methods.refreshItem.invalidates).toBeUndefined();
    });
  });
});

// User-scoped registration smoke tests: ensure both new capabilities register
// correctly when a plugin declares them with scope: "user", mirroring how the
// existing library-capability tests do it. Catches regressions where a new
// capability is added to the catalog but the registry dispatch wiring misses
// the scope arg.
describe("playbackSessions@v1 + libraryAdmin@v1 registry wiring", () => {
  function fakeUserScopedMediaServerPlugin(id: string): PluginModule {
    const playback: ManifestCapability = { version: "v1", scope: "user" };
    const admin: ManifestCapability = { version: "v1", scope: "user" };
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
        capabilities: { playbackSessions: playback, libraryAdmin: admin },
      },
      capabilities: {},
    };
  }

  it("registers both capabilities under the user scope", () => {
    const reg = new CapabilityRegistry();
    reg.register({
      pluginId: "plex",
      module: fakeUserScopedMediaServerPlugin("plex"),
      enabled: true,
    });
    expect(reg.listProviders("playbackSessions", "v1", "user")).toEqual(["plex"]);
    expect(reg.listProviders("libraryAdmin", "v1", "user")).toEqual(["plex"]);
    expect(reg.listProviders("playbackSessions", "v1", "global")).toEqual([]);
    expect(reg.listProviders("libraryAdmin", "v1", "global")).toEqual([]);
  });

  it("fake plugin manifest passes the shared manifest schema", () => {
    const manifest = fakeUserScopedMediaServerPlugin("plex").manifest;
    const parsed = pluginManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
  });
});
