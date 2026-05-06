import { describe, it, expect } from "vite-plus/test";
import { LibraryAvailabilityV1 } from "@ent-mcp/plugin-sdk";
import { jsonRes, makeCtx, statusRes } from "./helpers";
import jellyfinPlugin from "../src/plugin";

const cap = jellyfinPlugin.capabilities.libraryAvailability!;

describe("jellyfin listShowEpisodes", () => {
  it("server-local jellyfin id calls /Shows/{id}/Episodes directly", async () => {
    const ctx = makeCtx([
      jsonRes({
        Items: [
          { Id: "ep1", Name: "p", Type: "Episode", ParentIndexNumber: 1, IndexNumber: 1 },
          { Id: "ep2", Name: "p", Type: "Episode", ParentIndexNumber: 1, IndexNumber: 2 },
          { Id: "ep3", Name: "p", Type: "Episode", ParentIndexNumber: 2, IndexNumber: 1 },
        ],
      }),
    ]);
    const out = (await cap.listShowEpisodes!(ctx, { id: "show-1", idType: "jellyfin" })) as {
      episodes: Array<{ season: number; episode: number }>;
    };
    expect(ctx.calls[0]?.url).toContain(
      "/Shows/show-1/Episodes?Fields=ParentIndexNumber%2CIndexNumber",
    );
    expect(out.episodes).toEqual([
      { season: 1, episode: 1 },
      { season: 1, episode: 2 },
      { season: 2, episode: 1 },
    ]);
    expect(LibraryAvailabilityV1.methods.listShowEpisodes.output.safeParse(out).success).toBe(true);
  });

  it("cross-service tmdb id resolves through Series lookup then walks episodes", async () => {
    const ctx = makeCtx([
      // First call: provider lookup against /Users/{userId}/Items.
      jsonRes({
        Items: [{ Id: "show-7", Name: "Show", Type: "Series", ProviderIds: { Tmdb: "1396" } }],
      }),
      // Second call: episodes walk.
      jsonRes({
        Items: [{ Id: "ep1", Name: "p", Type: "Episode", ParentIndexNumber: 1, IndexNumber: 1 }],
      }),
    ]);
    const out = (await cap.listShowEpisodes!(ctx, { id: "1396", idType: "tmdb" })) as {
      episodes: Array<{ season: number; episode: number }>;
    };
    expect(ctx.calls[0]?.url).toContain("AnyProviderIdEquals=Tmdb.1396");
    expect(ctx.calls[1]?.url).toContain("/Shows/show-7/Episodes");
    expect(out.episodes).toEqual([{ season: 1, episode: 1 }]);
  });

  it("filters rows missing ParentIndexNumber or IndexNumber", async () => {
    const ctx = makeCtx([
      jsonRes({
        Items: [
          { Id: "ep1", Name: "p", Type: "Episode", ParentIndexNumber: 1, IndexNumber: 1 },
          { Id: "ep2", Name: "p", Type: "Episode", IndexNumber: 2 },
          { Id: "ep3", Name: "p", Type: "Episode", ParentIndexNumber: 1 },
        ],
      }),
    ]);
    const out = (await cap.listShowEpisodes!(ctx, { id: "show-1", idType: "jellyfin" })) as {
      episodes: Array<{ season: number; episode: number }>;
    };
    expect(out.episodes).toEqual([{ season: 1, episode: 1 }]);
  });

  it("returns empty when episodes endpoint returns 404", async () => {
    const ctx = makeCtx([statusRes(404, "")]);
    const out = (await cap.listShowEpisodes!(ctx, { id: "missing", idType: "jellyfin" })) as {
      episodes: unknown[];
    };
    expect(out.episodes).toEqual([]);
  });

  it("returns empty for plex idType (cross-server unresolvable)", async () => {
    const ctx = makeCtx([]);
    const out = (await cap.listShowEpisodes!(ctx, { id: "abc", idType: "plex" })) as {
      episodes: unknown[];
    };
    expect(out.episodes).toEqual([]);
    expect(ctx.calls.length).toBe(0);
  });

  it("returns empty when provider lookup yields no hit", async () => {
    const ctx = makeCtx([jsonRes({ Items: [] })]);
    const out = (await cap.listShowEpisodes!(ctx, { id: "1396", idType: "tmdb" })) as {
      episodes: unknown[];
    };
    expect(out.episodes).toEqual([]);
  });
});
