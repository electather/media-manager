import { describe, it, expect } from "vite-plus/test";
import type { ManifestCapability } from "@ent-mcp/shared/plugins";
import {
  CAPABILITY_CATALOG,
  capabilityKey,
  getCapability,
  MetadataV1,
  WatchHistoryV1,
  IdResolveV1,
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
        "idResolve@v1",
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
});
