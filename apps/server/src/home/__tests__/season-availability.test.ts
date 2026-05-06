import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { RowContext } from "../types";

vi.mock("../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

const listProvidersMock = vi.fn();
const registryGetMock = vi.fn();
const resolveConnectionsMock = vi.fn();
const invokeOneMock = vi.fn();

vi.mock("../../plugin-runtime/registry", () => ({
  capabilityRegistry: {
    listProviders: (...args: unknown[]) => listProvidersMock(...args),
    get: (...args: unknown[]) => registryGetMock(...args),
  },
}));

vi.mock("../../media/resolve-connection", () => ({
  resolveConnections: (...args: unknown[]) => resolveConnectionsMock(...args),
}));

vi.mock("../../media/invoke", () => ({
  invokeOne: (...args: unknown[]) => invokeOneMock(...args),
}));

vi.mock("../../media/capability-lookup", () => ({
  requireCapability: () => ({ defaultTimeoutMs: 15_000 }),
}));

const { composeSeasonAvailability } = await import("../season-availability");

function manifest(name: string) {
  return { module: { manifest: { name } } };
}

const userConn = (id: string) => ({
  kind: "user" as const,
  pluginId: id,
  connectionId: `conn-${id}`,
  isDefault: true,
  credentials: {},
  userConfig: null,
});

function fakeCtx(): RowContext {
  return { userId: "u1" } as RowContext;
}

beforeEach(() => {
  listProvidersMock.mockReset();
  registryGetMock.mockReset();
  resolveConnectionsMock.mockReset();
  invokeOneMock.mockReset();
});

describe("composeSeasonAvailability", () => {
  it("returns empty servers when no providers are registered", async () => {
    listProvidersMock.mockReturnValue([]);
    const out = await composeSeasonAvailability(fakeCtx(), "1396");
    expect(out).toEqual({ servers: [] });
    expect(invokeOneMock).not.toHaveBeenCalled();
  });

  it("returns empty servers when providers exist but the user has no connections", async () => {
    listProvidersMock.mockReturnValue(["plex"]);
    resolveConnectionsMock.mockResolvedValue([]);
    const out = await composeSeasonAvailability(fakeCtx(), "1396");
    expect(out).toEqual({ servers: [] });
    expect(invokeOneMock).not.toHaveBeenCalled();
  });

  it("buckets episodes per server and sorts ascending", async () => {
    listProvidersMock.mockReturnValue(["plex"]);
    registryGetMock.mockReturnValue(manifest("Plex"));
    resolveConnectionsMock.mockResolvedValue([userConn("plex")]);
    invokeOneMock.mockResolvedValue({
      pluginId: "plex",
      connectionId: "conn-plex",
      shared: false,
      data: {
        episodes: [
          { season: 2, episode: 1 },
          { season: 1, episode: 2 },
          { season: 1, episode: 1 },
        ],
      },
    });
    const out = await composeSeasonAvailability(fakeCtx(), "1396");
    expect(out.servers).toHaveLength(1);
    expect(out.servers[0]).toMatchObject({
      serverId: "plex:conn-plex",
      serverLabel: "Plex",
    });
    expect(out.servers[0]?.episodesPresent).toEqual([
      { season: 1, episode: 1 },
      { season: 1, episode: 2 },
      { season: 2, episode: 1 },
    ]);
    expect(out.errors).toBeUndefined();
  });

  it("surfaces per-plugin failure in errors[] alongside successful servers", async () => {
    listProvidersMock.mockReturnValue(["plex", "jellyfin"]);
    registryGetMock.mockImplementation((id: string) =>
      id === "plex" ? manifest("Plex") : manifest("Jellyfin"),
    );
    resolveConnectionsMock.mockImplementation(async (_userId: string, pluginId: string) => [
      userConn(pluginId),
    ]);
    invokeOneMock.mockImplementation(async (req: { pluginId: string }) => {
      if (req.pluginId === "plex") {
        return {
          pluginId: "plex",
          connectionId: "conn-plex",
          shared: false,
          data: { episodes: [{ season: 1, episode: 1 }] },
        };
      }
      return {
        pluginId: "jellyfin",
        connectionId: "conn-jellyfin",
        shared: false,
        error: { code: "plugin.upstream_error", devMessage: "boom" },
      };
    });
    const out = await composeSeasonAvailability(fakeCtx(), "1396");
    expect(out.servers.map((s) => s.serverLabel)).toEqual(["Plex"]);
    expect(out.errors).toEqual([
      {
        serverId: "jellyfin:conn-jellyfin",
        serverLabel: "Jellyfin",
        code: "plugin.upstream_error",
      },
    ]);
  });

  it("emits a server entry with empty episodes when plugin returns nothing", async () => {
    listProvidersMock.mockReturnValue(["plex"]);
    registryGetMock.mockReturnValue(manifest("Plex"));
    resolveConnectionsMock.mockResolvedValue([userConn("plex")]);
    invokeOneMock.mockResolvedValue({
      pluginId: "plex",
      connectionId: "conn-plex",
      shared: false,
      data: { episodes: [] },
    });
    const out = await composeSeasonAvailability(fakeCtx(), "1396");
    expect(out.servers[0]?.episodesPresent).toEqual([]);
  });
});
