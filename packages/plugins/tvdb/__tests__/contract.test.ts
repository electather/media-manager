import { describe, it, expect } from "vite-plus/test";
import type { PluginContext } from "@ent-mcp/plugin-sdk";
import { IdResolveV1, validatePluginModule } from "@ent-mcp/plugin-sdk";
import { jsonRes, makeTestContext, type TestContext } from "@ent-mcp/plugin-sdk/testing";
import tvdbPlugin from "../src/plugin";

// Contract tests: drive every declared capability method end-to-end with a
// stubbed ctx and confirm the plugin's return value parses against the
// capability's Zod output schema.

function makeCtx(
  responses: Array<Response | Error>,
  overrides: Partial<PluginContext> = {},
): TestContext {
  return makeTestContext({
    responses,
    overrides: { sharedCredentials: { apiKey: "tvdb-key" }, ...overrides },
  });
}

describe("tvdb plugin passes loader validation", () => {
  it("validates against the manifest + capability catalog", async () => {
    expect(validatePluginModule(tvdbPlugin)).toBeDefined();
  });
});

describe("tvdb capability contract", () => {
  it("idResolve.resolve: short-circuits when source is already tvdb", async () => {
    const ctx = makeCtx([]);
    const out = await tvdbPlugin.capabilities.idResolve!.resolve!(ctx, {
      from: "tvdb",
      id: "123",
      type: "tv",
    });
    expect(ctx.calls.length).toBe(0);
    expect(IdResolveV1.methods.resolve.output.safeParse(out).success).toBe(true);
  });

  it("idResolve.resolve: logs in then resolves a tmdb id to a tvdb series id", async () => {
    const ctx = makeCtx([
      jsonRes({ data: { token: "jwt-1" } }),
      jsonRes({ data: [{ series: { id: 999 } }] }),
    ]);
    const out = await tvdbPlugin.capabilities.idResolve!.resolve!(ctx, {
      from: "tmdb",
      id: "550",
      type: "tv",
    });
    expect(ctx.calls[0]?.url).toBe("https://api4.thetvdb.com/v4/login");
    expect(ctx.calls[0]?.init?.method).toBe("POST");
    expect(ctx.calls[1]?.url).toContain("/search/remoteid/550");
    expect(IdResolveV1.methods.resolve.output.safeParse(out).success).toBe(true);
    expect((out as { tvdb?: string }).tvdb).toBe("999");
  });

  it("idResolve.resolve: movie branch picks row.movie.id over row.series.id", async () => {
    const ctx = makeCtx([
      jsonRes({ data: { token: "jwt-1" } }),
      jsonRes({ data: [{ movie: { id: 42 }, series: { id: 999 } }] }),
    ]);
    const out = await tvdbPlugin.capabilities.idResolve!.resolve!(ctx, {
      from: "tmdb",
      id: "550",
      type: "movie",
    });
    expect(IdResolveV1.methods.resolve.output.safeParse(out).success).toBe(true);
    expect((out as { tvdb?: string }).tvdb).toBe("42");
  });
});
