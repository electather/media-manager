import type { PluginContext } from "@nama/plugin-sdk";
import { makeTestContext, type TestContext } from "@nama/plugin-sdk/testing";

// Jellyfin-specific test setup. Builds the standard fake `ctx` around a queue
// of scripted fetch responses, with credentials and userConfig pre-populated
// to match what the plugin reads at runtime. Centralised so `plugin.test.ts`
// and `contract.test.ts` cannot drift apart as the plugin grows.

export function makeCtx(
  responses: Array<Response | Error>,
  overrides: Partial<PluginContext> = {},
): TestContext {
  return makeTestContext({
    responses,
    overrides: {
      // `JellyfinCreds` requires both — the plugin now stores the submitted
      // password in the encrypted credentials blob and reads it on re-auth via
      // `ctx.credentials.password`. A stub that only carried `accessToken`
      // would be stale relative to the real interface.
      credentials: { accessToken: "tok", password: "pw" },
      config: {
        global: null,
        user: {
          externalServerUrl: "https://jellyfin.example.com",
          internalServerUrl: "http://jellyfin:8096",
          username: "alice",
          userId: "user-1",
        },
      },
      ...overrides,
    },
  });
}

export { jsonRes, statusRes, type FakeCall } from "@nama/plugin-sdk/testing";

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
