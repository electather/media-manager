import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { PluginError } from "../../plugin-runtime/types";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const { MemoryCache } = await import("../../cache/memory");
const { setCacheProviderForTest } = await import("../cache");

const invokeMock = vi.fn();
const refreshAuthMock = vi.fn();
const resolveConnectionsMock = vi.fn();
const getPrimaryMock = vi.fn();
const harvestIdsMock = vi.fn();
const listProvidersMock = vi.fn();
const registryAllMock = vi.fn();

vi.mock("../../plugin-runtime/runtime", () => ({
  pluginRuntime: {
    invoke: (...args: unknown[]) => invokeMock(...args),
    invokeWithCredentials: (...args: unknown[]) => invokeMock(...args),
    refreshAuth: (...args: unknown[]) => refreshAuthMock(...args),
  },
}));

vi.mock("../resolve-connection", () => ({
  resolveConnections: (...args: unknown[]) => resolveConnectionsMock(...args),
}));

vi.mock("../primary-preference", () => ({
  getPrimaryConnection: (...args: unknown[]) => getPrimaryMock(...args),
  setPrimaryConnection: vi.fn(),
  clearPrimaryConnection: vi.fn(),
}));

vi.mock("../id-resolver", () => ({
  harvestIds: (...args: unknown[]) => harvestIdsMock(...args),
}));

vi.mock("../../plugin-runtime/registry", () => ({
  capabilityRegistry: {
    listProviders: (...args: unknown[]) => listProvidersMock(...args),
    all: () => registryAllMock(),
  },
}));

// Stub the DB layer: dispatcher only touches it for status/credentials updates,
// which don't affect the assertions in these tests.
const dbStub = {
  update: () => ({ set: () => ({ where: async () => undefined }) }),
};
vi.mock("../../db/client", () => ({
  getDb: () => dbStub,
}));

vi.mock("../../crypto/vault", () => ({
  encrypt: async (plain: string) => `iv:${plain}`,
}));

vi.mock("../../crypto/hash", () => ({
  sha256: async (s: string) => s.slice(0, 32).padEnd(32, "0"),
}));

// Import after mocks so the module binds to mocked exports.
const { dispatchSingle, dispatchAggregate, dispatchPrimary, invalidateUserCache } =
  await import("../dispatcher");
const { PluginCallError } = await import("../errors");
const { getCacheProvider } = await import("../cache");

interface UserConn {
  kind: "user";
  pluginId: string;
  connectionId: string;
  isDefault: boolean;
  credentials: unknown;
  userConfig: unknown;
}

function userConn(pluginId: string, connectionId = `${pluginId}-conn`): UserConn {
  return {
    kind: "user",
    pluginId,
    connectionId,
    isDefault: true,
    credentials: { token: "t" },
    userConfig: {},
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  refreshAuthMock.mockReset();
  resolveConnectionsMock.mockReset();
  getPrimaryMock.mockReset();
  harvestIdsMock.mockReset();
  listProvidersMock.mockReset();
  registryAllMock.mockReset();
  registryAllMock.mockReturnValue([]);
  getPrimaryMock.mockResolvedValue(null);
  setCacheProviderForTest(new MemoryCache());
});

describe("dispatchSingle", () => {
  it("returns data from the only provider and caches it", async () => {
    listProvidersMock.mockReturnValue(["seerr"]);
    resolveConnectionsMock.mockResolvedValue([userConn("seerr")]);
    invokeMock.mockResolvedValueOnce([{ id: "r1" }]);

    const first = await dispatchSingle<unknown[]>({
      userId: "u1",
      capability: "mediaRequest",
      version: "v1",
      method: "listRequests",
      input: {},
    });
    expect(first).toEqual([{ id: "r1" }]);

    // Second call should hit cache, so runtime is not re-invoked.
    const second = await dispatchSingle<unknown[]>({
      userId: "u1",
      capability: "mediaRequest",
      version: "v1",
      method: "listRequests",
      input: {},
    });
    expect(second).toEqual([{ id: "r1" }]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("negative-caches not_found as null", async () => {
    listProvidersMock.mockReturnValue(["seerr"]);
    resolveConnectionsMock.mockResolvedValue([userConn("seerr")]);
    invokeMock.mockRejectedValueOnce(new PluginError("plugin.item_not_found", "nope"));

    const result = await dispatchSingle({
      userId: "u1",
      capability: "mediaRequest",
      version: "v1",
      method: "listRequests",
      input: {},
    });
    expect(result).toBeNull();

    // Subsequent call should also return null from cache.
    const again = await dispatchSingle({
      userId: "u1",
      capability: "mediaRequest",
      version: "v1",
      method: "listRequests",
      input: {},
    });
    expect(again).toBeNull();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("throws PluginCallError on non-not_found failures", async () => {
    listProvidersMock.mockReturnValue(["seerr"]);
    resolveConnectionsMock.mockResolvedValue([userConn("seerr")]);
    invokeMock.mockRejectedValueOnce(new PluginError("plugin.input_invalid", "bad"));

    await expect(
      dispatchSingle({
        userId: "u1",
        capability: "mediaRequest",
        version: "v1",
        method: "listRequests",
        input: {},
      }),
    ).rejects.toBeInstanceOf(PluginCallError);
  });

  it("throws when no provider is installed", async () => {
    listProvidersMock.mockReturnValue([]);
    await expect(
      dispatchSingle({
        userId: "u1",
        capability: "mediaRequest",
        version: "v1",
        method: "listRequests",
        input: {},
      }),
    ).rejects.toBeInstanceOf(PluginCallError);
  });

  it("retries once on rate_limited, then returns data", async () => {
    listProvidersMock.mockReturnValue(["seerr"]);
    resolveConnectionsMock.mockResolvedValue([userConn("seerr")]);
    invokeMock
      .mockRejectedValueOnce(new PluginError("plugin.rate_limited", "slow"))
      .mockResolvedValueOnce({ ok: true });
    vi.useFakeTimers();
    const promise = dispatchSingle({
      userId: "u1",
      capability: "mediaRequest",
      version: "v1",
      method: "checkAvailability",
      input: { tmdbId: "1", type: "movie" },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;
    vi.useRealTimers();
    expect(result).toEqual({ ok: true });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes credentials on token_expired and retries once", async () => {
    listProvidersMock.mockReturnValue(["seerr"]);
    resolveConnectionsMock.mockResolvedValue([userConn("seerr")]);
    invokeMock
      .mockRejectedValueOnce(new PluginError("plugin.token_expired", "stale"))
      .mockResolvedValueOnce([{ id: "r1" }]);
    refreshAuthMock.mockResolvedValueOnce({ token: "fresh" });

    const result = await dispatchSingle({
      userId: "u1",
      capability: "mediaRequest",
      version: "v1",
      method: "listRequests",
      input: {},
    });
    expect(result).toEqual([{ id: "r1" }]);
    expect(refreshAuthMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});

describe("dispatchAggregate", () => {
  it("unions results across providers", async () => {
    listProvidersMock.mockReturnValue(["trakt", "other"]);
    resolveConnectionsMock.mockImplementation(async (_userId: string, pluginId: string) => [
      userConn(pluginId),
    ]);
    invokeMock
      .mockResolvedValueOnce([{ item: { id: "1" } }])
      .mockResolvedValueOnce([{ item: { id: "2" } }]);

    const result = await dispatchAggregate<unknown[]>({
      userId: "u1",
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      input: {},
    });
    expect(result.data).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it("collects per-provider errors while returning successful data", async () => {
    listProvidersMock.mockReturnValue(["trakt", "other"]);
    resolveConnectionsMock.mockImplementation(async (_userId: string, pluginId: string) => [
      userConn(pluginId),
    ]);
    invokeMock
      .mockResolvedValueOnce([{ item: { id: "1" } }])
      .mockRejectedValueOnce(new PluginError("plugin.input_invalid", "no good"));

    const result = await dispatchAggregate<unknown[]>({
      userId: "u1",
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      input: {},
    });
    expect(result.data).toHaveLength(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ pluginId: "other", code: "plugin.input_invalid" }),
    ]);
  });

  it("ignores not_found without surfacing it as an error", async () => {
    listProvidersMock.mockReturnValue(["trakt"]);
    resolveConnectionsMock.mockResolvedValue([userConn("trakt")]);
    invokeMock.mockRejectedValueOnce(new PluginError("plugin.item_not_found", "missing"));

    const result = await dispatchAggregate<unknown[]>({
      userId: "u1",
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      input: {},
    });
    expect(result.data).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

describe("dispatchPrimary", () => {
  it("picks the user's stored primary connection first and enriches gaps", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    resolveConnectionsMock.mockImplementation(async (_userId: string, pluginId: string) => [
      userConn(pluginId),
    ]);
    getPrimaryMock.mockResolvedValue({ pluginId: "trakt", connectionId: "trakt-conn" });

    invokeMock
      .mockResolvedValueOnce({
        // primary (trakt) result — missing overview
        title: "Matrix",
        overview: "",
        ids: { trakt_id: "42" },
      })
      .mockResolvedValueOnce({
        // enrichment (tmdb) — fills overview and adds tmdb_id
        title: "Other title",
        overview: "A classic",
        ids: { tmdb_id: "603" },
      });

    const result = await dispatchPrimary<{
      title: string;
      overview: string;
      ids: Record<string, string>;
    }>({
      userId: "u1",
      capability: "metadata",
      version: "v1",
      method: "getDetails",
      input: { id: "603", type: "movie" },
      mediaType: "movie",
    });

    expect(result.data.title).toBe("Matrix");
    expect(result.data.overview).toBe("A classic");
    expect(result.data.ids).toEqual({ trakt_id: "42", tmdb_id: "603" });
  });

  it("defaults to first provider when no primary is set", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    resolveConnectionsMock.mockImplementation(async (_userId: string, pluginId: string) => [
      userConn(pluginId),
    ]);
    getPrimaryMock.mockResolvedValue(null);

    invokeMock
      .mockResolvedValueOnce({ title: "From TMDB", ids: {} })
      .mockResolvedValueOnce({ title: "From Trakt", ids: {} });

    const result = await dispatchPrimary<{ title: string }>({
      userId: "u1",
      capability: "metadata",
      version: "v1",
      method: "getDetails",
      input: { id: "1", type: "movie" },
      mediaType: "movie",
    });
    expect(result.data.title).toBe("From TMDB");
  });

  it("returns data:null and collected errors when every provider fails", async () => {
    listProvidersMock.mockReturnValue(["tmdb"]);
    resolveConnectionsMock.mockResolvedValue([userConn("tmdb")]);
    getPrimaryMock.mockResolvedValue(null);
    invokeMock
      .mockRejectedValueOnce(new PluginError("plugin.upstream_error", "down"))
      .mockRejectedValueOnce(new PluginError("plugin.upstream_error", "still down"));

    // Fake timers to skip the 1s transient-network backoff.
    vi.useFakeTimers();
    const promise = dispatchPrimary({
      userId: "u1",
      capability: "metadata",
      version: "v1",
      method: "getDetails",
      input: { id: "1", type: "movie" },
      mediaType: "movie",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;
    vi.useRealTimers();
    expect(result.data).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe("plugin.upstream_error");
  });
});

describe("id harvest", () => {
  it("calls harvestIds on successful aggregate outcomes", async () => {
    listProvidersMock.mockReturnValue(["trakt"]);
    resolveConnectionsMock.mockResolvedValue([userConn("trakt")]);
    registryAllMock.mockReturnValue([{ pluginId: "trakt" }, { pluginId: "tmdb" }]);
    invokeMock.mockResolvedValueOnce([{ item: { id: "1" } }]);

    await dispatchAggregate({
      userId: "u1",
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      input: {},
    });

    expect(harvestIdsMock).toHaveBeenCalledTimes(1);
    const [payload, ctx] = harvestIdsMock.mock.calls[0]!;
    expect(payload).toEqual([{ item: { id: "1" } }]);
    expect(ctx.pluginId).toBe("trakt");
    expect(ctx.installedPlugins).toEqual(new Set(["trakt", "tmdb"]));
  });
});

describe("invalidateUserCache", () => {
  it("clears the mv: namespace", async () => {
    const provider = getCacheProvider();
    await provider.set("mv:metadata:v1:search:global:abc", { hit: true }, 60_000);
    await provider.set("other:key", { keep: true }, 60_000);

    await invalidateUserCache("any-user");

    expect(await provider.get("mv:metadata:v1:search:global:abc")).toBeNull();
    expect(await provider.get("other:key")).toEqual({ keep: true });
  });
});
