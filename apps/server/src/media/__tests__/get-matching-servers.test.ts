import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

vi.mock("../../plugin-runtime/internal/registry", () => ({
  capabilityRegistry: {
    listProviders: (...args: unknown[]) => listProvidersMock(...args),
    get: (...args: unknown[]) => registryGetMock(...args),
  },
}));

vi.mock("../internal/resolve-connection", () => ({
  resolveConnections: (...args: unknown[]) => resolveConnectionsMock(...args),
}));

vi.mock("../service/invoke", () => ({
  invokeOne: (...args: unknown[]) => invokeOneMock(...args),
}));

vi.mock("../internal/capability-lookup", () => ({
  requireCapability: () => ({ defaultTimeoutMs: 15_000 }),
  scopeForRequest: () => "user",
}));

vi.mock("../service/dispatch", () => ({
  dispatchAggregate: vi.fn(),
  dispatchPrimary: vi.fn(),
  dispatchSingle: vi.fn(),
}));

const { MediaService } = await import("../service");

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

beforeEach(() => {
  listProvidersMock.mockReset();
  registryGetMock.mockReset();
  resolveConnectionsMock.mockReset();
  invokeOneMock.mockReset();
});

describe("MediaService.getMatchingServers", () => {
  it("returns an empty list when no libraryAvailability providers are registered", async () => {
    listProvidersMock.mockReturnValue([]);
    const svc = new MediaService("u1");
    expect(await svc.getMatchingServers("550", "movie")).toEqual([]);
    expect(invokeOneMock).not.toHaveBeenCalled();
  });

  it("collects only plugins whose listAvailable index includes the requested tmdb id", async () => {
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
          data: { tmdbIds: ["550"] },
        };
      }
      return {
        pluginId: "jellyfin",
        connectionId: "conn-jellyfin",
        shared: false,
        data: { tmdbIds: [] },
      };
    });

    const res = await new MediaService("u1").getMatchingServers("550", "movie");
    expect(res).toEqual([{ id: "plex", label: "Plex" }]);
  });

  it("dedups + sorts results by label", async () => {
    listProvidersMock.mockReturnValue(["plex", "jellyfin"]);
    registryGetMock.mockImplementation((id: string) =>
      id === "plex" ? manifest("Plex") : manifest("Jellyfin"),
    );
    resolveConnectionsMock.mockImplementation(async (_u: string, pluginId: string) => [
      userConn(pluginId),
    ]);
    invokeOneMock.mockImplementation(async (req: { pluginId: string }) => ({
      pluginId: req.pluginId,
      connectionId: `conn-${req.pluginId}`,
      shared: false,
      data: { tmdbIds: ["550"] },
    }));

    const res = await new MediaService("u1").getMatchingServers("550", "movie");
    expect(res.map((s) => s.label)).toEqual(["Jellyfin", "Plex"]);
  });

  it("collapses N item lookups to a single listAvailable call per (plugin, type)", async () => {
    listProvidersMock.mockReturnValue(["plex"]);
    registryGetMock.mockReturnValue(manifest("Plex"));
    resolveConnectionsMock.mockResolvedValue([userConn("plex")]);
    invokeOneMock.mockResolvedValue({
      pluginId: "plex",
      connectionId: "conn-plex",
      shared: false,
      data: { tmdbIds: ["550", "1198994"] },
    });

    const svc = new MediaService("u1");
    const [a, b, c] = await Promise.all([
      svc.getMatchingServers("550", "movie"),
      svc.getMatchingServers("1198994", "movie"),
      svc.getMatchingServers("999", "movie"),
    ]);
    expect(a).toEqual([{ id: "plex", label: "Plex" }]);
    expect(b).toEqual([{ id: "plex", label: "Plex" }]);
    expect(c).toEqual([]);
    expect(invokeOneMock).toHaveBeenCalledTimes(1);
    expect(invokeOneMock).toHaveBeenCalledWith(
      expect.objectContaining({ method: "listAvailable", input: { type: "movie" } }),
      expect.anything(),
    );
  });

  it("uses queryType=show when looking up tv libraries", async () => {
    listProvidersMock.mockReturnValue(["jellyfin"]);
    registryGetMock.mockReturnValue(manifest("Jellyfin"));
    resolveConnectionsMock.mockResolvedValue([userConn("jellyfin")]);
    invokeOneMock.mockResolvedValue({
      pluginId: "jellyfin",
      connectionId: "conn-jellyfin",
      shared: false,
      data: { tmdbIds: ["1396"] },
    });

    await new MediaService("u1").getMatchingServers("1396", "tv");
    expect(invokeOneMock).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "libraryAvailability",
        version: "v1",
        method: "listAvailable",
        input: { type: "show" },
      }),
      expect.anything(),
    );
  });

  it("falls back to per-id checkAvailability when listAvailable returns no index", async () => {
    listProvidersMock.mockReturnValue(["plex"]);
    registryGetMock.mockReturnValue(manifest("Plex"));
    resolveConnectionsMock.mockResolvedValue([userConn("plex")]);
    invokeOneMock.mockImplementation(async (req: { method: string }) => {
      if (req.method === "listAvailable") {
        return {
          pluginId: "plex",
          connectionId: "conn-plex",
          shared: false,
          // Plugin reports an error instead of a presence index — host must
          // recover via the legacy per-id probe rather than mark the plugin
          // absent for the request.
          error: { code: "plugin.upstream_error", devMessage: "transient" },
        };
      }
      return {
        pluginId: "plex",
        connectionId: "conn-plex",
        shared: false,
        data: { items: [{ id: "rk:1" }] },
      };
    });

    const res = await new MediaService("u1").getMatchingServers("550", "movie");
    expect(res).toEqual([{ id: "plex", label: "Plex" }]);
    expect(invokeOneMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "checkAvailability",
        input: { id: "550", idType: "tmdb", type: "movie" },
      }),
      expect.anything(),
    );
  });

  it("drops the rejected promise from the cache so the next call retries", async () => {
    listProvidersMock.mockReturnValue(["plex"]);
    registryGetMock.mockReturnValue(manifest("Plex"));
    // The getLibraryIndex path swallows errors and falls through to the
    // legacy probe, so a single rejection alone won't surface; reject from
    // both probes on the first call to exercise the cache-eviction path.
    resolveConnectionsMock
      .mockRejectedValueOnce(new Error("transient registry race"))
      .mockRejectedValueOnce(new Error("transient registry race"))
      .mockResolvedValue([userConn("plex")]);
    invokeOneMock.mockResolvedValue({
      pluginId: "plex",
      connectionId: "conn-plex",
      shared: false,
      data: { tmdbIds: ["550"] },
    });

    const svc = new MediaService("u1");
    await expect(svc.getMatchingServers("550", "movie")).rejects.toThrow("transient registry race");
    // Second call must not hit the cached rejection — it retries and succeeds.
    expect(await svc.getMatchingServers("550", "movie")).toEqual([{ id: "plex", label: "Plex" }]);
  });

  it("drops plugins whose listAvailable + fallback both errored", async () => {
    listProvidersMock.mockReturnValue(["plex"]);
    registryGetMock.mockReturnValue(manifest("Plex"));
    resolveConnectionsMock.mockResolvedValue([userConn("plex")]);
    invokeOneMock.mockResolvedValue({
      pluginId: "plex",
      connectionId: "conn-plex",
      shared: false,
      error: { code: "plugin.upstream_error", devMessage: "boom" },
    });

    const res = await new MediaService("u1").getMatchingServers("550", "movie");
    expect(res).toEqual([]);
  });
});
