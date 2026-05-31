import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { PluginError } from "@ent-mcp/plugin-sdk";

// Regression for the recurring "Trakt keeps expiring" report. Trakt (and any
// OAuth provider that rotates refresh tokens) invalidates the previous refresh
// token the instant a new one is issued. A home-feed load fans capability calls
// out in parallel, so when the access token has expired every concurrent call
// observes `token_expired` and tries to refresh at once. Before coalescing, the
// first refresh consumed the shared token and every loser presented an
// already-dead one — Trakt answered 4xx (`plugin.token_expired`), which flipped
// a healthy connection to "expired" and emitted an auth-expired notification.

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const { MemoryCache } = await import("../../cache/memory");
const { setCacheProviderForTest } = await import("../service/cache");

const invokeMock = vi.fn();
const refreshAuthMock = vi.fn();
const resolveConnectionsMock = vi.fn();
const listProvidersMock = vi.fn();
const registryAllMock = vi.fn();
const emitMock = vi.fn<(name: string, schema: unknown, payload: unknown) => Promise<void>>(
  async () => undefined,
);
// Backs the `readConnectionCredentials` DB lookup so each test controls what the
// stored (post-rotation) credentials look like.
const getRowMock = vi.fn<() => Promise<unknown>>(async () => undefined);
const decryptMock = vi.fn<() => Promise<string>>(async () => JSON.stringify({ token: "t" }));

vi.mock("../../plugin-runtime/service/runtime", () => ({
  pluginRuntime: {
    invoke: (...args: unknown[]) => invokeMock(...args),
    invokeWithCredentials: (...args: unknown[]) => invokeMock(...args),
    refreshAuth: (...args: unknown[]) => refreshAuthMock(...args),
  },
}));

vi.mock("../internal/resolve-connection", () => ({
  resolveConnections: (...args: unknown[]) => resolveConnectionsMock(...args),
}));

vi.mock("../service/primary-preference", () => ({
  getPrimaryConnection: async () => null,
  setPrimaryConnection: vi.fn(),
  clearPrimaryConnection: vi.fn(),
}));

vi.mock("../service/id-resolver", () => ({
  harvestIds: async () => undefined,
}));

vi.mock("../../plugin-runtime/internal/registry", () => ({
  capabilityRegistry: {
    listProviders: (...args: unknown[]) => listProvidersMock(...args),
    all: () => registryAllMock(),
  },
}));

vi.mock("../../db/client", () => ({
  getDb: () => ({
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    select: () => ({ from: () => ({ where: () => ({ get: () => getRowMock() }) }) }),
  }),
}));

vi.mock("../../crypto/vault", () => ({
  encrypt: async (plain: string) => `iv:${plain}`,
  decrypt: () => decryptMock(),
}));

vi.mock("../../crypto/hash", () => ({
  sha256: async (s: string) => s.slice(0, 32).padEnd(32, "0"),
}));

vi.mock("../../jobs/events", () => ({
  emit: emitMock,
}));

const { dispatchSingle } = await import("../service/dispatch");

interface UserConn {
  kind: "user";
  pluginId: string;
  connectionId: string;
  isDefault: boolean;
  credentials: unknown;
  userConfig: unknown;
}

function traktConn(connectionId = "trakt-conn"): UserConn {
  return {
    kind: "user",
    pluginId: "trakt",
    connectionId,
    isDefault: true,
    credentials: { accessToken: "stale", refreshToken: "r0" },
    userConfig: {},
  };
}

function listRequests() {
  return dispatchSingle({
    userId: "user-1",
    capability: "mediaRequest",
    version: "v1",
    method: "listRequests",
    input: {},
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  refreshAuthMock.mockReset();
  resolveConnectionsMock.mockReset();
  listProvidersMock.mockReset();
  registryAllMock.mockReset();
  registryAllMock.mockReturnValue([]);
  emitMock.mockClear();
  getRowMock.mockReset();
  getRowMock.mockResolvedValue(undefined);
  decryptMock.mockReset();
  decryptMock.mockResolvedValue(JSON.stringify({ token: "t" }));
  setCacheProviderForTest(new MemoryCache());
});

describe("concurrent refresh coalescing", () => {
  it("collapses a parallel token_expired burst to one upstream refresh", async () => {
    listProvidersMock.mockReturnValue(["trakt"]);
    resolveConnectionsMock.mockResolvedValue([traktConn("conn-burst")]);

    // First two invocations (one per parallel call) report the expired access
    // token; their retries — after the shared refresh lands — succeed.
    let invocations = 0;
    invokeMock.mockImplementation(async () => {
      invocations += 1;
      if (invocations <= 2) throw new PluginError("plugin.token_expired", "stale");
      return [{ id: "ok" }];
    });

    // The winning refresh rotates the token. A second upstream refresh (the bug)
    // would present the now-consumed r0 and come back 4xx — model that so the
    // test fails loudly if coalescing regresses.
    refreshAuthMock
      .mockResolvedValueOnce({ accessToken: "fresh", refreshToken: "r1" })
      .mockRejectedValueOnce(new PluginError("plugin.token_expired", "r0 already used"));

    await expect(Promise.all([listRequests(), listRequests()])).resolves.toHaveLength(2);

    expect(refreshAuthMock).toHaveBeenCalledTimes(1);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("adopts a token another refresher already rotated in instead of re-refreshing", async () => {
    listProvidersMock.mockReturnValue(["trakt"]);
    resolveConnectionsMock.mockResolvedValue([traktConn("conn-rotated")]);

    invokeMock
      .mockRejectedValueOnce(new PluginError("plugin.token_expired", "stale"))
      .mockResolvedValueOnce([{ id: "ok" }]);

    // The scheduled job (or an earlier burst) already persisted a rotated token.
    // The stored credentials differ from the r0 this call tried, so the refresh
    // path must adopt them rather than call refreshAuth with the consumed token.
    getRowMock.mockResolvedValue({ encryptedCredentials: "data", credentialsIv: "iv" });
    decryptMock.mockResolvedValue(JSON.stringify({ accessToken: "fresh", refreshToken: "r1" }));

    await expect(listRequests()).resolves.toEqual([{ id: "ok" }]);

    expect(refreshAuthMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });
});
