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

vi.mock("../../plugin-runtime/registry", () => ({
  capabilityRegistry: {
    listProviders: (...args: unknown[]) => listProvidersMock(...args),
    get: (...args: unknown[]) => registryGetMock(...args),
  },
}));

vi.mock("../resolve-connection", () => ({
  resolveConnections: (...args: unknown[]) => resolveConnectionsMock(...args),
}));

vi.mock("../invoke", () => ({
  invokeOne: (...args: unknown[]) => invokeOneMock(...args),
}));

vi.mock("../capability-lookup", () => ({
  requireCapability: () => ({ defaultTimeoutMs: 15_000 }),
  scopeForRequest: () => "user",
}));

vi.mock("../dispatcher", () => ({
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

  it("collects only plugins whose checkAvailability returned at least one item", async () => {
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
          data: { items: [{ id: "rk:1" }] },
        };
      }
      return {
        pluginId: "jellyfin",
        connectionId: "conn-jellyfin",
        shared: false,
        data: { items: [] },
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
    invokeOneMock.mockResolvedValue({
      pluginId: "plex",
      connectionId: "conn-plex",
      shared: false,
      data: { items: [{ id: "rk:1" }] },
    });

    const res = await new MediaService("u1").getMatchingServers("550", "movie");
    expect(res.map((s) => s.label)).toEqual(["Jellyfin", "Plex"]);
  });

  it("memoizes per (tmdbId, type) within the same MediaService instance", async () => {
    listProvidersMock.mockReturnValue(["plex"]);
    registryGetMock.mockReturnValue(manifest("Plex"));
    resolveConnectionsMock.mockResolvedValue([userConn("plex")]);
    invokeOneMock.mockResolvedValue({
      pluginId: "plex",
      connectionId: "conn-plex",
      shared: false,
      data: { items: [{ id: "rk:1" }] },
    });

    const svc = new MediaService("u1");
    await Promise.all([
      svc.getMatchingServers("550", "movie"),
      svc.getMatchingServers("550", "movie"),
    ]);
    expect(invokeOneMock).toHaveBeenCalledTimes(1);
  });

  it("queries the right idType+queryType for tv shows", async () => {
    listProvidersMock.mockReturnValue(["jellyfin"]);
    registryGetMock.mockReturnValue(manifest("Jellyfin"));
    resolveConnectionsMock.mockResolvedValue([userConn("jellyfin")]);
    invokeOneMock.mockResolvedValue({
      pluginId: "jellyfin",
      connectionId: "conn-jellyfin",
      shared: false,
      data: { items: [{ id: "x" }] },
    });

    await new MediaService("u1").getMatchingServers("1396", "tv");
    expect(invokeOneMock).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "libraryAvailability",
        version: "v1",
        method: "checkAvailability",
        input: { id: "1396", idType: "tmdb", type: "show" },
      }),
      expect.anything(),
    );
  });

  it("drops the rejected promise from the cache so the next call retries", async () => {
    listProvidersMock.mockReturnValueOnce(["plex"]).mockReturnValueOnce(["plex"]);
    registryGetMock.mockReturnValue(manifest("Plex"));
    resolveConnectionsMock
      .mockRejectedValueOnce(new Error("transient registry race"))
      .mockResolvedValueOnce([userConn("plex")]);
    invokeOneMock.mockResolvedValue({
      pluginId: "plex",
      connectionId: "conn-plex",
      shared: false,
      data: { items: [{ id: "rk:1" }] },
    });

    const svc = new MediaService("u1");
    await expect(svc.getMatchingServers("550", "movie")).rejects.toThrow("transient registry race");
    // Second call must not hit the cached rejection — it retries and succeeds.
    expect(await svc.getMatchingServers("550", "movie")).toEqual([{ id: "plex", label: "Plex" }]);
  });

  it("drops plugins whose connections all errored", async () => {
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
