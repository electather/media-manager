import { describe, it, expect } from "vite-plus/test";
import type { PluginContext } from "@nama/plugin-sdk";
import { LibraryAvailabilityV1 } from "@nama/plugin-sdk";
import { jsonRes, makeTestContext, statusRes, type TestContext } from "@nama/plugin-sdk/testing";
import plexPlugin from "../src/plugin";

function makeCtx(
  responses: Array<Response | Error>,
  overrides: Partial<PluginContext> = {},
): TestContext {
  return makeTestContext({
    responses,
    overrides: {
      credentials: { authToken: "token-123" },
      config: {
        global: null,
        user: {
          machineIdentifier: "abc123",
          externalServerUrl: "https://plex.example.com",
          internalServerUrl: "http://plex:32400",
        },
      },
      ...overrides,
    },
  });
}

const cap = plexPlugin.capabilities.libraryAvailability!;

describe("plex listShowEpisodes", () => {
  it("server-local plex id calls allLeaves directly", async () => {
    const ctx = makeCtx([
      jsonRes({
        MediaContainer: {
          Metadata: [
            {
              ratingKey: "1",
              key: "/library/metadata/1",
              type: "episode",
              title: "p",
              parentIndex: 1,
              index: 1,
            },
            {
              ratingKey: "2",
              key: "/library/metadata/2",
              type: "episode",
              title: "p",
              parentIndex: 1,
              index: 2,
            },
            {
              ratingKey: "3",
              key: "/library/metadata/3",
              type: "episode",
              title: "p",
              parentIndex: 2,
              index: 1,
            },
          ],
        },
      }),
    ]);
    const out = (await cap.listShowEpisodes!(ctx, { id: "9999", idType: "plex" })) as {
      episodes: Array<{ season: number; episode: number }>;
    };
    expect(ctx.calls[0]?.url).toContain("/library/metadata/9999/allLeaves");
    expect(ctx.calls.length).toBe(1);
    expect(out.episodes).toEqual([
      { season: 1, episode: 1 },
      { season: 1, episode: 2 },
      { season: 2, episode: 1 },
    ]);
    expect(LibraryAvailabilityV1.methods.listShowEpisodes.output.safeParse(out).success).toBe(true);
  });

  it("cross-service tmdb id resolves via /library/all guid then walks allLeaves", async () => {
    const ctx = makeCtx([
      // First call: guid lookup returns the show ratingKey.
      jsonRes({
        MediaContainer: {
          Metadata: [
            { ratingKey: "5000", key: "/library/metadata/5000", type: "show", title: "Show" },
          ],
        },
      }),
      // Second call: allLeaves enumerates the episodes.
      jsonRes({
        MediaContainer: {
          Metadata: [
            {
              ratingKey: "5001",
              key: "/library/metadata/5001",
              type: "episode",
              title: "p",
              parentIndex: 1,
              index: 1,
            },
          ],
        },
      }),
    ]);
    const out = (await cap.listShowEpisodes!(ctx, { id: "1396", idType: "tmdb" })) as {
      episodes: Array<{ season: number; episode: number }>;
    };
    expect(ctx.calls[0]?.url).toContain("/library/all?guid=tmdb%3A%2F%2F1396");
    expect(ctx.calls[1]?.url).toContain("/library/metadata/5000/allLeaves");
    expect(out.episodes).toEqual([{ season: 1, episode: 1 }]);
  });

  it("returns empty when guid lookup yields no match", async () => {
    const ctx = makeCtx([jsonRes({ MediaContainer: { Metadata: [] } })]);
    const out = (await cap.listShowEpisodes!(ctx, { id: "nope", idType: "tmdb" })) as {
      episodes: unknown[];
    };
    expect(out.episodes).toEqual([]);
  });

  it("returns empty when allLeaves returns 404", async () => {
    const ctx = makeCtx([statusRes(404, "")]);
    const out = (await cap.listShowEpisodes!(ctx, { id: "404", idType: "plex" })) as {
      episodes: unknown[];
    };
    expect(out.episodes).toEqual([]);
  });

  it("filters rows missing parentIndex or index", async () => {
    const ctx = makeCtx([
      jsonRes({
        MediaContainer: {
          Metadata: [
            {
              ratingKey: "1",
              key: "/library/metadata/1",
              type: "episode",
              title: "p",
              parentIndex: 1,
              index: 1,
            },
            { ratingKey: "2", key: "/library/metadata/2", type: "episode", title: "p" },
            {
              ratingKey: "3",
              key: "/library/metadata/3",
              type: "episode",
              title: "p",
              parentIndex: 1,
            },
          ],
        },
      }),
    ]);
    const out = (await cap.listShowEpisodes!(ctx, { id: "9999", idType: "plex" })) as {
      episodes: Array<{ season: number; episode: number }>;
    };
    expect(out.episodes).toEqual([{ season: 1, episode: 1 }]);
  });

  it("returns empty for jellyfin idType (cross-server unresolvable)", async () => {
    const ctx = makeCtx([]);
    const out = (await cap.listShowEpisodes!(ctx, { id: "abc", idType: "jellyfin" })) as {
      episodes: unknown[];
    };
    expect(out.episodes).toEqual([]);
    expect(ctx.calls.length).toBe(0);
  });
});
