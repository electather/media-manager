import { describe, it, expect } from "vite-plus/test";
import { validatePluginModule } from "@ent-mcp/plugin-sdk";
import {
  LibraryAvailabilityV1,
  PlaybackV1,
  PlaybackSessionsV1,
  ContinueWatchingV1,
  WatchHistoryV1,
  LibraryAdminV1,
  IdResolveV1,
} from "@ent-mcp/plugin-sdk";
import jellyfinPlugin from "../src/plugin";
import { jfItem, jsonRes, makeCtx, statusRes } from "./helpers";

/**
 * Contract tests: drive every declared capability method end-to-end with a
 * stubbed ctx, verify the request URL is what we expect to hit on a real
 * Jellyfin server, and confirm the plugin's return value parses against the
 * capability's Zod output schema.
 */

describe("jellyfin plugin passes loader validation", () => {
  it("validates against the manifest + capability catalog", async () => {
    expect(validatePluginModule(jellyfinPlugin)).toBeDefined();
  });
});

describe("jellyfin capability contract", () => {
  it("libraryAvailability.checkAvailability: hits /Users/{userId}/Items with AnyProviderIdEquals", async () => {
    const ctx = makeCtx([
      jsonRes({ Items: [jfItem({ Id: "jf-1", ProviderIds: { Tmdb: "550" } })] }),
    ]);
    const out = await jellyfinPlugin.capabilities.libraryAvailability!.checkAvailability!(ctx, {
      id: "550",
      idType: "tmdb",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/Users/user-1/Items");
    expect(ctx.calls[0]?.url).toContain("AnyProviderIdEquals=Tmdb.550");
    expect(LibraryAvailabilityV1.methods.checkAvailability.output.safeParse(out).success).toBe(
      true,
    );
  });

  it("libraryAvailability.listRecentlyAdded: hits /Users/{userId}/Items/Latest", async () => {
    const ctx = makeCtx([jsonRes([jfItem({ Id: "a" })])]);
    const out = await jellyfinPlugin.capabilities.libraryAvailability!.listRecentlyAdded!(ctx, {
      limit: 5,
    });
    expect(ctx.calls[0]?.url).toContain("/Users/user-1/Items/Latest");
    expect(LibraryAvailabilityV1.methods.listRecentlyAdded.output.safeParse(out).success).toBe(
      true,
    );
  });

  it("libraryAvailability.searchLibrary: hits /Users/{userId}/Items with SearchTerm", async () => {
    const ctx = makeCtx([jsonRes({ Items: [jfItem({ Id: "a" })] })]);
    const out = await jellyfinPlugin.capabilities.libraryAvailability!.searchLibrary!(ctx, {
      query: "foo",
    });
    expect(ctx.calls[0]?.url).toContain("/Users/user-1/Items");
    expect(ctx.calls[0]?.url).toContain("SearchTerm=foo");
    expect(LibraryAvailabilityV1.methods.searchLibrary.output.safeParse(out).success).toBe(true);
  });

  it("playback.getPositions: hits /Users/{userId}/Items with IsResumable filter", async () => {
    const ctx = makeCtx([jsonRes({ Items: [] })]);
    const out = await jellyfinPlugin.capabilities.playback!.getPositions!(ctx, {});
    expect(ctx.calls[0]?.url).toContain("/Users/user-1/Items");
    expect(ctx.calls[0]?.url).toContain("Filters=IsResumable");
    expect(PlaybackV1.methods.getPositions.output.safeParse(out).success).toBe(true);
  });

  it("playback.removePosition: DELETE /Users/{userId}/Items/{id}", async () => {
    const ctx = makeCtx([statusRes(204)]);
    const out = await jellyfinPlugin.capabilities.playback!.removePosition!(ctx, {
      playbackId: "jellyfin:item-1",
    });
    expect(ctx.calls[0]?.init?.method).toBe("DELETE");
    expect(ctx.calls[0]?.url).toContain("/Users/user-1/Items/item-1");
    expect(PlaybackV1.methods.removePosition.output.safeParse(out).success).toBe(true);
  });

  it("playbackSessions.getSessions: hits /Sessions and returns valid entries", async () => {
    const ctx = makeCtx([
      jsonRes([
        {
          Id: "s1",
          UserId: "user-1",
          UserName: "alice",
          DeviceName: "TV",
          Client: "Jellyfin Web",
          StartTimeUtc: "2026-04-01T00:00:00.000Z",
          NowPlayingItem: jfItem({ Id: "np", RunTimeTicks: 60 * 10_000_000 }),
          PlayState: { PositionTicks: 0, IsPaused: false, PlayMethod: "DirectPlay" },
        },
      ]),
    ]);
    const out = await jellyfinPlugin.capabilities.playbackSessions!.getSessions!(ctx, {});
    expect(ctx.calls[0]?.url).toMatch(/\/Sessions\?controllableByUserId=user-1$/);
    expect(PlaybackSessionsV1.methods.getSessions.output.safeParse(out).success).toBe(true);
  });

  it("playbackSessions.stopSession: POST /Sessions/{id}/Playing/Stop", async () => {
    const ctx = makeCtx([statusRes(204)]);
    const out = await jellyfinPlugin.capabilities.playbackSessions!.stopSession!(ctx, {
      sessionId: "s1",
    });
    expect(ctx.calls[0]?.init?.method).toBe("POST");
    expect(ctx.calls[0]?.url).toContain("/Sessions/s1/Playing/Stop");
    expect(PlaybackSessionsV1.methods.stopSession.output.safeParse(out).success).toBe(true);
  });

  it("continueWatching.getContinueWatching: merges /Users/{userId}/Items/Resume + /Shows/NextUp", async () => {
    const ctx = makeCtx([jsonRes({ Items: [] }), jsonRes({ Items: [] })]);
    const out = await jellyfinPlugin.capabilities.continueWatching!.getContinueWatching!(ctx, {});
    expect(ctx.calls[0]?.url).toContain("/Users/user-1/Items/Resume");
    expect(ctx.calls[1]?.url).toContain("/Shows/NextUp");
    expect(ContinueWatchingV1.methods.getContinueWatching.output.safeParse(out).success).toBe(true);
  });

  it("watchHistory.getHistory: hits /Users/{userId}/Items sorted by DatePlayed", async () => {
    const ctx = makeCtx([jsonRes({ Items: [] })]);
    const out = await jellyfinPlugin.capabilities.watchHistory!.getHistory!(ctx, {});
    expect(ctx.calls[0]?.url).toContain("/Users/user-1/Items");
    expect(ctx.calls[0]?.url).toContain("SortBy=DatePlayed");
    expect(WatchHistoryV1.methods.getHistory.output.safeParse(out).success).toBe(true);
  });

  it("watchHistory.addToHistory: POST /Users/{userId}/PlayedItems/{itemId}", async () => {
    const ctx = makeCtx([statusRes(204)]);
    const out = await jellyfinPlugin.capabilities.watchHistory!.addToHistory!(ctx, [
      { type: "movie", ids: { "jellyfin:itemId": "jf-1" } },
    ]);
    expect(ctx.calls[0]?.init?.method).toBe("POST");
    expect(ctx.calls[0]?.url).toContain("/Users/user-1/PlayedItems/jf-1");
    expect(WatchHistoryV1.methods.addToHistory.output.safeParse(out).success).toBe(true);
  });

  it("watchHistory.removeFromHistory: DELETE /Users/{userId}/PlayedItems/{itemId}", async () => {
    const ctx = makeCtx([statusRes(204)]);
    const out = await jellyfinPlugin.capabilities.watchHistory!.removeFromHistory!(ctx, [
      { type: "movie", ids: { "jellyfin:itemId": "jf-1" } },
    ]);
    expect(ctx.calls[0]?.init?.method).toBe("DELETE");
    expect(ctx.calls[0]?.url).toContain("/Users/user-1/PlayedItems/jf-1");
    expect(WatchHistoryV1.methods.removeFromHistory.output.safeParse(out).success).toBe(true);
  });

  it("libraryAdmin.refreshLibrary: POST /Library/Refresh", async () => {
    const ctx = makeCtx([statusRes(204)]);
    const out = await jellyfinPlugin.capabilities.libraryAdmin!.refreshLibrary!(ctx, {});
    expect(ctx.calls[0]?.url).toContain("/Library/Refresh");
    expect(LibraryAdminV1.methods.refreshLibrary.output.safeParse(out).success).toBe(true);
  });

  it("libraryAdmin.refreshItem: POST /Items/{id}/Refresh", async () => {
    const ctx = makeCtx([statusRes(204)]);
    const out = await jellyfinPlugin.capabilities.libraryAdmin!.refreshItem!(ctx, {
      serverItemId: "jf-77",
    });
    expect(ctx.calls[0]?.url).toContain("/Items/jf-77/Refresh");
    expect(LibraryAdminV1.methods.refreshItem.output.safeParse(out).success).toBe(true);
  });

  it("idResolve.resolve: maps ProviderIds on a local Jellyfin item", async () => {
    const ctx = makeCtx([
      jsonRes(jfItem({ Id: "jf-1", ProviderIds: { Tmdb: "550", Imdb: "tt001" } })),
    ]);
    const out = await jellyfinPlugin.capabilities.idResolve!.resolve!(ctx, {
      from: "jellyfin:itemId",
      id: "jf-1",
      type: "movie",
    });
    expect(IdResolveV1.methods.resolve.output.safeParse(out).success).toBe(true);
  });
});
