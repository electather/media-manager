import { describe, it, expect, beforeEach, vi } from "vite-plus/test";

interface PluginRow {
  id: string;
  manifest: string;
  enabled: number;
}

const state: { plugins: PluginRow[] } = { plugins: [] };

vi.mock("../../env", () => ({
  env: { ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef" },
}));

vi.mock("../../db/queries", () => ({
  selectEnabledPlugins: async () => state.plugins.filter((p) => p.enabled === 1),
}));

vi.mock("../../db/client", () => ({ getDb: () => ({}) }));

vi.mock("../../plugin-runtime", async () => {
  const actual =
    await vi.importActual<typeof import("../../plugin-runtime")>("../../plugin-runtime");
  return {
    ...actual,
    capabilityRegistry: {
      get: (id: string) => (state.plugins.some((p) => p.id === id) ? {} : undefined),
    },
    sharedCredentialsService: { countEnabled: async () => 0 },
    pluginRuntime: { runAuth: vi.fn(), testConnection: vi.fn() },
  };
});

vi.mock("../../media", async () => {
  const actual = await vi.importActual<typeof import("../../media")>("../../media");
  return {
    ...actual,
    invalidateUserCache: vi.fn(),
  };
});

vi.mock("../../crypto/vault", () => ({
  encrypt: async (s: string) => `iv:${s}`,
  decrypt: async (s: string) => s,
}));

const { connectionsService } = await import("../service");

function makePluginRow(args: {
  id: string;
  capabilities: Record<string, { scope: "user" | "global"; version: string }>;
}): PluginRow {
  return {
    id: args.id,
    enabled: 1,
    manifest: JSON.stringify({
      name: args.id,
      version: "1.0.0",
      description: "",
      auth: { kind: "none" },
      capabilities: args.capabilities,
      poolable: false,
    }),
  };
}

beforeEach(() => {
  state.plugins = [];
});

describe("listAvailablePlugins — purpose-based filtering", () => {
  it("includes plugins with non-notification user-scoped capabilities (Connections-only)", async () => {
    state.plugins.push(
      makePluginRow({
        id: "plex",
        capabilities: { library: { scope: "user", version: "v1" } },
      }),
    );
    const out = await connectionsService.listAvailablePlugins();
    expect(out.map((p) => p.id)).toEqual(["plex"]);
  });

  it("excludes plugins whose only user-scoped capability is notificationDelivery", async () => {
    state.plugins.push(
      makePluginRow({
        id: "telegram",
        capabilities: { notificationDelivery: { scope: "user", version: "v1" } },
      }),
    );
    const out = await connectionsService.listAvailablePlugins();
    expect(out).toHaveLength(0);
  });

  it("includes plugins that mix notificationDelivery with another user-scoped capability", async () => {
    state.plugins.push(
      makePluginRow({
        id: "hybrid",
        capabilities: {
          notificationDelivery: { scope: "user", version: "v1" },
          library: { scope: "user", version: "v1" },
        },
      }),
    );
    const out = await connectionsService.listAvailablePlugins();
    expect(out.map((p) => p.id)).toEqual(["hybrid"]);
  });

  it("excludes pure-global plugins (no user-scoped capabilities)", async () => {
    state.plugins.push(
      makePluginRow({
        id: "tmdb",
        capabilities: { metadata: { scope: "global", version: "v1" } },
      }),
    );
    const out = await connectionsService.listAvailablePlugins();
    expect(out).toHaveLength(0);
  });
});

describe("listNotificationPlugins", () => {
  it("returns full PluginSummary for the provided notification-capable plugin ids", async () => {
    state.plugins.push(
      makePluginRow({
        id: "telegram",
        capabilities: { notificationDelivery: { scope: "user", version: "v1" } },
      }),
      makePluginRow({
        id: "plex",
        capabilities: { library: { scope: "user", version: "v1" } },
      }),
    );
    const out = await connectionsService.listNotificationPlugins(new Set(["telegram"]));
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("telegram");
    expect(out[0]?.userScopedCapabilities).toEqual([{ id: "notificationDelivery", version: "v1" }]);
  });
});
