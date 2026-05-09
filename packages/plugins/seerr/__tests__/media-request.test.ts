import { describe, it, expect } from "vite-plus/test";
import type { PluginContext } from "@ent-mcp/plugin-sdk";
import { MediaRequestV1 } from "@ent-mcp/plugin-sdk";
import { jsonRes, makeTestContext, statusRes, type TestContext } from "@ent-mcp/plugin-sdk/testing";
import seerrPlugin from "../src/plugin";

function makeCtx(
  responses: Array<Response | Error>,
  overrides: Partial<PluginContext> = {},
): TestContext {
  return makeTestContext({
    responses,
    overrides: {
      credentials: { sessionCookie: "connect.sid=xyz", userId: 1 },
      config: { global: { baseUrl: "https://seerr.example.com" }, user: null },
      ...overrides,
    },
  });
}

// Contract tests: drive every declared capability method end-to-end with a
// stubbed ctx and confirm the plugin's return value parses against the
// capability's Zod output schema. Auth-lifecycle and loader validation
// regressions live in `__tests__/plugin.test.ts`; this file covers the
// happy path for each declared method.
describe("seerr capability contract", () => {
  it("mediaRequest.checkAvailability: hits /movie/{tmdbId} and maps status", async () => {
    const ctx = makeCtx([jsonRes({ mediaInfo: { status: 5 } })]);
    const out = await seerrPlugin.capabilities.mediaRequest!.checkAvailability!(ctx, {
      tmdbId: "550",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/api/v1/movie/550");
    expect(MediaRequestV1.methods.checkAvailability.output.safeParse(out).success).toBe(true);
  });

  it("mediaRequest.checkAvailability: returns unavailable when mediaInfo absent", async () => {
    const ctx = makeCtx([jsonRes({})]);
    const out = await seerrPlugin.capabilities.mediaRequest!.checkAvailability!(ctx, {
      tmdbId: "550",
      type: "movie",
    });
    expect(out).toEqual({ status: "unavailable" });
    expect(MediaRequestV1.methods.checkAvailability.output.safeParse(out).success).toBe(true);
  });

  it("mediaRequest.checkAvailability: collapses 404 into unknown", async () => {
    const ctx = makeCtx([statusRes(404)]);
    const out = await seerrPlugin.capabilities.mediaRequest!.checkAvailability!(ctx, {
      tmdbId: "550",
      type: "movie",
    });
    expect(out).toEqual({ status: "unknown" });
    expect(MediaRequestV1.methods.checkAvailability.output.safeParse(out).success).toBe(true);
  });

  it("mediaRequest.checkAvailability: hits /tv/{tmdbId} for tv input", async () => {
    const ctx = makeCtx([jsonRes({ mediaInfo: { status: 2 } })]);
    const out = await seerrPlugin.capabilities.mediaRequest!.checkAvailability!(ctx, {
      tmdbId: "1399",
      type: "tv",
    });
    expect(ctx.calls[0]?.url).toContain("/api/v1/tv/1399");
    expect(MediaRequestV1.methods.checkAvailability.output.safeParse(out).success).toBe(true);
  });

  it("mediaRequest.createRequest: POST /request with mediaType + mediaId", async () => {
    const ctx = makeCtx([jsonRes({ id: 42 })]);
    const out = await seerrPlugin.capabilities.mediaRequest!.createRequest!(ctx, {
      tmdbId: "550",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/api/v1/request");
    expect(ctx.calls[0]?.init?.method).toBe("POST");
    expect(ctx.calls[0]?.init?.body).toContain('"mediaType":"movie"');
    expect(ctx.calls[0]?.init?.body).toContain('"mediaId":550');
    expect(MediaRequestV1.methods.createRequest.output.safeParse(out).success).toBe(true);
  });

  it("mediaRequest.createRequest (tv): forwards parsed seasons list", async () => {
    const ctx = makeCtx([jsonRes({ id: 43 })]);
    const out = await seerrPlugin.capabilities.mediaRequest!.createRequest!(ctx, {
      tmdbId: "1399",
      type: "tv",
      seasons: "1, 2, 3",
    });
    expect(ctx.calls[0]?.init?.body).toContain('"seasons":[1,2,3]');
    expect(MediaRequestV1.methods.createRequest.output.safeParse(out).success).toBe(true);
  });

  it("mediaRequest.cancelRequest: DELETE /request/{id}", async () => {
    const ctx = makeCtx([statusRes(204)]);
    const out = await seerrPlugin.capabilities.mediaRequest!.cancelRequest!(ctx, {
      requestId: "42",
    });
    expect(ctx.calls[0]?.url).toContain("/api/v1/request/42");
    expect(ctx.calls[0]?.init?.method).toBe("DELETE");
    expect(MediaRequestV1.methods.cancelRequest.output.safeParse(out).success).toBe(true);
  });

  it("mediaRequest.cancelRequest: treats 404 as idempotent success", async () => {
    const ctx = makeCtx([statusRes(404)]);
    const out = await seerrPlugin.capabilities.mediaRequest!.cancelRequest!(ctx, {
      requestId: "999",
    });
    expect(out).toEqual({ ok: true });
    expect(MediaRequestV1.methods.cancelRequest.output.safeParse(out).success).toBe(true);
  });

  it("mediaRequest.listRequests: stops on a partial first page (early-exit)", async () => {
    const ctx = makeCtx([
      jsonRes({
        results: [
          {
            id: 1,
            type: "movie",
            status: 4,
            createdAt: "2026-04-01T00:00:00.000Z",
            media: { tmdbId: 550, title: "Fight Club" },
          },
        ],
      }),
    ]);
    const out = await seerrPlugin.capabilities.mediaRequest!.listRequests!(ctx, {});
    expect(ctx.calls.length).toBe(1);
    expect(ctx.calls[0]?.url).toContain("/api/v1/request?take=100&skip=0");
    expect(MediaRequestV1.methods.listRequests.output.safeParse(out).success).toBe(true);
  });

  it("mediaRequest.listRequests: maps seasons[], serverName/profileName labels for TV row", async () => {
    const ctx = makeCtx([
      jsonRes({
        results: [
          {
            id: 7,
            type: "tv",
            status: 2,
            createdAt: "2026-04-03T00:00:00.000Z",
            media: { tmdbId: 1396, title: "Breaking Bad" },
            seasons: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
            serverName: "Sonarr Main",
            profileName: "1080p",
          },
        ],
      }),
    ]);
    const out = (await seerrPlugin.capabilities.mediaRequest!.listRequests!(ctx, {})) as Array<{
      seasons: number[];
      targetLabel: string | null;
      profileLabel: string | null;
    }>;
    expect(out[0]?.seasons).toEqual([1, 2]);
    expect(out[0]?.targetLabel).toBe("Sonarr Main");
    expect(out[0]?.profileLabel).toBe("1080p");
    expect(MediaRequestV1.methods.listRequests.output.safeParse(out).success).toBe(true);
  });

  it("mediaRequest.listRequests: movie row with no seasons emits seasons:[] and null labels", async () => {
    const ctx = makeCtx([
      jsonRes({
        results: [
          {
            id: 8,
            type: "movie",
            status: 4,
            createdAt: "2026-04-04T00:00:00.000Z",
            media: { tmdbId: 550, title: "Fight Club" },
          },
        ],
      }),
    ]);
    const out = (await seerrPlugin.capabilities.mediaRequest!.listRequests!(ctx, {})) as Array<{
      seasons: number[];
      targetLabel: string | null;
      profileLabel: string | null;
    }>;
    expect(out[0]?.seasons).toEqual([]);
    expect(out[0]?.targetLabel).toBeNull();
    expect(out[0]?.profileLabel).toBeNull();
    expect(MediaRequestV1.methods.listRequests.output.safeParse(out).success).toBe(true);
  });

  it("mediaRequest.createRequest: forwards serverId and profileId when provided", async () => {
    const ctx = makeCtx([jsonRes({ id: 99 })]);
    const out = await seerrPlugin.capabilities.mediaRequest!.createRequest!(ctx, {
      tmdbId: "550",
      type: "movie",
      targetId: "2",
      profileId: "7",
    });
    expect(ctx.calls[0]?.init?.method).toBe("POST");
    const body = ctx.calls[0]?.init?.body as string;
    expect(body).toContain('"serverId":2');
    expect(body).toContain('"profileId":7');
    expect(MediaRequestV1.methods.createRequest.output.safeParse(out).success).toBe(true);
  });

  it("mediaRequest.listTargets (movie): fans out to /service/radarr then per-server detail", async () => {
    const ctx = makeCtx([
      jsonRes([
        { id: 1, name: "Radarr 4K", activeProfileId: 7 },
        { id: 2, name: "Radarr HD" },
      ]),
      jsonRes({ profiles: [{ id: 7, name: "Ultra HD" }] }),
      jsonRes({ profiles: [{ id: 4, name: "1080p" }] }),
    ]);
    const out = (await seerrPlugin.capabilities.mediaRequest!.listTargets!(ctx, {
      type: "movie",
    })) as { targets: Array<{ targetId: string; defaultProfileId: string | null }> };
    expect(ctx.calls[0]?.url).toContain("/api/v1/service/radarr");
    expect(ctx.calls[1]?.url).toContain("/api/v1/service/radarr/1");
    expect(ctx.calls[2]?.url).toContain("/api/v1/service/radarr/2");
    expect(out.targets.length).toBe(2);
    expect(out.targets[0]?.defaultProfileId).toBe("7");
    expect(out.targets[1]?.defaultProfileId).toBe(null);
    expect(MediaRequestV1.methods.listTargets.output.safeParse(out).success).toBe(true);
  });

  it("mediaRequest.listTargets (tv): hits /service/sonarr", async () => {
    const ctx = makeCtx([
      jsonRes([{ id: 5, name: "Sonarr Main", activeProfileId: 3 }]),
      jsonRes({ profiles: [{ id: 3, name: "HD" }] }),
    ]);
    const out = (await seerrPlugin.capabilities.mediaRequest!.listTargets!(ctx, {
      type: "tv",
    })) as { targets: unknown[] };
    expect(ctx.calls[0]?.url).toContain("/api/v1/service/sonarr");
    expect(ctx.calls[1]?.url).toContain("/api/v1/service/sonarr/5");
    expect(MediaRequestV1.methods.listTargets.output.safeParse(out).success).toBe(true);
  });

  it("mediaRequest.listRequests: paginates when a full page comes back, accumulating across pages", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      type: "movie" as const,
      status: 4,
      createdAt: "2026-04-01T00:00:00.000Z",
      media: { tmdbId: 500 + i, title: `Movie ${i + 1}` },
    }));
    const tailPage = [
      {
        id: 101,
        type: "tv" as const,
        status: 2,
        createdAt: "2026-04-02T00:00:00.000Z",
        media: { tmdbId: 999, title: "Show" },
      },
    ];
    const ctx = makeCtx([jsonRes({ results: fullPage }), jsonRes({ results: tailPage })]);
    const out = await seerrPlugin.capabilities.mediaRequest!.listRequests!(ctx, {});
    expect(ctx.calls.length).toBe(2);
    expect(ctx.calls[0]?.url).toContain("skip=0");
    expect(ctx.calls[1]?.url).toContain("skip=100");
    expect((out as unknown[]).length).toBe(101);
    expect(MediaRequestV1.methods.listRequests.output.safeParse(out).success).toBe(true);
  });
});
