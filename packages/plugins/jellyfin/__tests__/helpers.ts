import type { PluginContext } from "@ent-mcp/plugin-sdk";

// Shared helpers for the Jellyfin plugin test suites. Both `plugin.test.ts`
// and `contract.test.ts` build the same fake `ctx` around a queue of
// scripted fetch responses — centralising it here keeps the stubbed
// credentials shape (`{ accessToken, password }`), the fake user config, and
// the fixture factory from drifting between the two files as the plugin
// grows.

export interface FakeCall {
  url: string;
  init?: RequestInit;
}

export function makeCtx(
  responses: Array<Response | Error>,
  overrides: Partial<PluginContext> = {},
): PluginContext & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
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
    // `JellyfinCreds` requires both — the plugin now stores the submitted
    // password in the encrypted credentials blob and reads it on re-auth via
    // `ctx.credentials.password`. A stub that only carried `accessToken`
    // would be stale relative to the real interface.
    credentials: { accessToken: "tok", password: "pw" },
    sharedCredentials: null,
    config: {
      global: null,
      user: {
        externalServerUrl: "https://jellyfin.example.com",
        internalServerUrl: "http://jellyfin:8096",
        username: "alice",
        userId: "user-1",
      },
    },
    store: {
      async get() {
        return undefined;
      },
      async set() {},
      async delete() {},
    },
    pool: { markExhausted() {} },
    appBaseUrl: "https://app.example.com",
    ...overrides,
  } as unknown as PluginContext & { calls: FakeCall[] };
  return ctx;
}

export function jsonRes(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

export function statusRes(status: number, body: string = ""): Response {
  const nullBody = status === 204 || status === 205 || status === 304;
  return new Response(nullBody ? null : body, { status });
}

export function jfItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: "item-1",
    Name: "Example",
    Type: "Movie",
    ProductionYear: 2026,
    DateCreated: "2026-04-01T00:00:00.000Z",
    MediaSources: [],
    ProviderIds: {},
    ...overrides,
  };
}
