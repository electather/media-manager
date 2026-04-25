import { describe, it, expect } from "vite-plus/test";
import type { PluginContext } from "@ent-mcp/plugin-sdk";
import { IdResolveV1 } from "@ent-mcp/plugin-sdk";
import { validatePluginModule } from "@ent-mcp/plugin-sdk";
import tvdbPlugin from "../src/plugin";

// Contract tests: drive every declared capability method end-to-end with a
// stubbed ctx and confirm the plugin's return value parses against the
// capability's Zod output schema.

interface FakeCall {
  url: string;
  init?: RequestInit;
}

function makeCtx(
  responses: Array<Response | Error>,
  overrides: Partial<PluginContext> = {},
): PluginContext & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const storeState = new Map<string, unknown>();
  const ctx = {
    calls,
    async fetch(url: string, init?: RequestInit) {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error(`unexpected fetch: ${url}`);
      if (next instanceof Error) throw next;
      return next;
    },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    credentials: null,
    sharedCredentials: { apiKey: "tvdb-key" },
    config: { global: null, user: null },
    store: {
      async get(key: string) {
        return storeState.get(key);
      },
      async set(key: string, value: unknown) {
        storeState.set(key, value);
      },
      async delete(key: string) {
        storeState.delete(key);
      },
    },
    pool: { markExhausted() {} },
    appBaseUrl: "https://app.example.com",
    ...overrides,
  } as unknown as PluginContext & { calls: FakeCall[] };
  return ctx;
}

function jsonRes(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("tvdb plugin passes loader validation", () => {
  it("validates against the manifest + capability catalog", async () => {
    await expect(validatePluginModule(tvdbPlugin)).resolves.toBeDefined();
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
